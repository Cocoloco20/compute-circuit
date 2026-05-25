/**
 * EIA series catalog — every single-value time series we track across the
 * energy/compute supply chain.
 *
 * Adding a new series is a row in this catalog; the cron iterator picks it up
 * automatically. Each entry encodes the EIA endpoint + facet filters + how to
 * extract the latest value. Snapshots land in eia_commodity_snapshots
 * (single-series rows, see migration 0016).
 *
 * The catalog is organized by supply-chain layer because the UI's
 * Supply-Chain panel maps each layer to a tightness indicator:
 *
 *   FUEL → POWER → GRID → DC → SILICON → MODELS
 *
 * Series at the FUEL layer (gas / coal / nuclear feedstock) tighten when
 * inventory falls or price spikes. Series at POWER tighten when capacity
 * goes offline or generation mix shifts toward expensive fuels. Series at
 * GRID tighten when regional demand approaches transmission limits. Etc.
 */

export type ChainLayer = 'fuel' | 'power' | 'grid' | 'dc' | 'silicon' | 'models'

export interface EiaSeriesSpec {
  /** Our slug used as series_id in eia_commodity_snapshots. Stable across renames. */
  id: string
  /** Human label for the UI. */
  label: string
  /** Supply-chain layer this series belongs to. */
  layer: ChainLayer
  /** Full EIA v2 endpoint path under https://api.eia.gov (no leading slash, no trailing). */
  endpoint: string
  /** Query frequency (matches EIA's `frequency` param). */
  frequency: 'hourly' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual'
  /** Facet filters to apply (EIA's `facets[X][]=Y` params). */
  facets?: Record<string, string[]>
  /** Which data column(s) to ask EIA for. */
  data: string[]
  /** Which response column has the numeric value we care about. */
  valueColumn: string
  /** Unit string used in the UI ($/MMBtu, MW, %, etc.) — overrides EIA's `units` if set. */
  unit?: string
  /** Description of what tightens / what direction = trouble. */
  tightnessRule?: {
    direction: 'high-is-tight' | 'low-is-tight'
    /** Threshold beyond which the chain is "tight" (rendered yellow/red). */
    warnAt: number
    alertAt: number
  }
  /** Whether to multiply the value (e.g. EIA returns BCF, we want TCF → 0.001). */
  scale?: number
}

/**
 * Catalog of EIA series we ingest daily.
 *
 * Volumes: ~25 series × 1 EIA call each × ~300ms = ~8s wall-clock in the cron.
 * Comfortably under the 60s Vercel Hobby cap with room for fuel-mix loops.
 */
export const EIA_SERIES_CATALOG: EiaSeriesSpec[] = [
  // ============ FUEL LAYER ============
  // Natural gas — Henry Hub spot + storage levels
  {
    id: 'NG.HENRY_HUB.D',
    label: 'Henry Hub gas spot',
    layer: 'fuel',
    endpoint: 'natural-gas/pri/fut/data',
    frequency: 'daily',
    facets: { series: ['RNGWHHD'] },
    data: ['value'],
    valueColumn: 'value',
    unit: 'USD/MMBtu',
    tightnessRule: { direction: 'high-is-tight', warnAt: 4.0, alertAt: 6.0 },
  },
  {
    id: 'NG.STORAGE.WKLY',
    label: 'US natural-gas storage',
    layer: 'fuel',
    endpoint: 'natural-gas/stor/wkly/data',
    frequency: 'weekly',
    facets: { series: ['NW2_EPG0_SWO_R48_BCF'] },        // Lower-48 working gas
    data: ['value'],
    valueColumn: 'value',
    unit: 'Bcf',
    tightnessRule: { direction: 'low-is-tight', warnAt: 2400, alertAt: 1800 },
  },

  // Coal — stocks at electric power plants + spot price
  {
    id: 'COAL.STOCKS.EPP.M',
    label: 'US coal stocks (power plants)',
    layer: 'fuel',
    endpoint: 'coal/consumption-and-quality/data',
    frequency: 'monthly',
    facets: { aggregation: ['receipts'] },
    data: ['receipts'],
    valueColumn: 'receipts',
    unit: 'tons',
    tightnessRule: { direction: 'low-is-tight', warnAt: 80_000_000, alertAt: 60_000_000 },
  },

  // Nuclear feedstock — uranium spot is not on EIA's API, skip for now.
  // Outage % captured via dedicated /nuclear-outages route, not catalog.

  // ============ POWER LAYER ============
  // National generation totals and price
  {
    id: 'ELEC.RETAIL_PRICE.US.M',
    label: 'US avg retail electricity price',
    layer: 'power',
    endpoint: 'electricity/retail-sales/data',
    frequency: 'monthly',
    facets: { sectorid: ['ALL'], stateid: ['US'] },
    data: ['price'],
    valueColumn: 'price',
    unit: 'cents/kWh',
    tightnessRule: { direction: 'high-is-tight', warnAt: 14.0, alertAt: 16.0 },
  },
  {
    id: 'ELEC.GEN_TOTAL.US.M',
    label: 'US total electricity generation',
    layer: 'power',
    endpoint: 'electricity/electric-power-operational-data/data',
    frequency: 'monthly',
    facets: { fueltypeid: ['ALL'], sectorid: ['99'], location: ['US'] },
    data: ['generation'],
    valueColumn: 'generation',
    unit: 'thousand MWh',
  },

  // ============ GRID LAYER ============
  // Regional demand handled separately by fetchGridDemand (per-co loop) —
  // not in this catalog because it requires the company.eia_region join.

  // ============ EMISSIONS ============
  // National CO2 emissions from electricity sector
  {
    id: 'CO2.ELEC.US.A',
    label: 'US power-sector CO2',
    layer: 'power',
    endpoint: 'co2-emissions/co2-emissions-aggregates/data',
    frequency: 'annual',
    facets: { sectorId: ['EC'], fuelId: ['TO'], stateId: ['US'] },
    data: ['value'],
    valueColumn: 'value',
    unit: 'MMT CO2',
  },
]

/**
 * International electricity stats — different EIA endpoint shape (no respondent
 * facet, uses countryRegionId). Used by /api/cron/eia-international to track
 * fab-country grid stress: Taiwan (TSMC), Korea (Samsung/SK Hynix), Japan
 * (Sony / Renesas), Netherlands (ASML), Singapore (AWS / GovTech / Google).
 *
 * Country IDs from EIA's IEA-aligned mapping:
 *   TWN  Taiwan        KOR  South Korea
 *   JPN  Japan         NLD  Netherlands
 *   SGP  Singapore     IRL  Ireland (AWS/MSFT EU region)
 */
export interface EiaCountrySpec {
  id: string                  // 'INTL.ELEC.TWN.A'
  countryId: string           // 'TWN'
  countryLabel: string        // 'Taiwan'
  fabExposure: string         // 'TSMC fabs'
}

export const EIA_FAB_COUNTRIES: EiaCountrySpec[] = [
  { id: 'INTL.ELEC.TWN.A', countryId: 'TWN', countryLabel: 'Taiwan',      fabExposure: 'TSMC' },
  { id: 'INTL.ELEC.KOR.A', countryId: 'KOR', countryLabel: 'South Korea', fabExposure: 'Samsung / SK Hynix' },
  { id: 'INTL.ELEC.JPN.A', countryId: 'JPN', countryLabel: 'Japan',       fabExposure: 'Sony / Renesas / Toyo Tanso' },
  { id: 'INTL.ELEC.NLD.A', countryId: 'NLD', countryLabel: 'Netherlands', fabExposure: 'ASML HQ' },
  { id: 'INTL.ELEC.SGP.A', countryId: 'SGP', countryLabel: 'Singapore',   fabExposure: 'AWS / Google APAC' },
  { id: 'INTL.ELEC.IRL.A', countryId: 'IRL', countryLabel: 'Ireland',     fabExposure: 'AWS / MSFT EU' },
]

/**
 * EIA Open Data API client — regional electricity demand.
 *
 * Endpoint: https://api.eia.gov/v2/electricity/rto/region-data/data/
 *   - Free, requires API key from https://www.eia.gov/opendata/register.php
 *   - Documented rate limit: 5,000 requests per hour per key
 *   - JSON response cap: 5,000 rows per request (we ask for ~400 hours = ~17 days)
 *   - Source: EIA Form 930 "Hourly Electric Grid Monitor"
 *   - Data lags ~1-2 hours behind real-time
 *
 * Region (`respondent`) IDs we use:
 *   - PJM  — PJM Interconnection (Mid-Atlantic; covers CEG's TMI, TLN's Susquehanna)
 *   - ERCO — Electric Reliability Council of Texas (VST's Comanche Peak + gas fleet)
 *   - FLA  — Florida (NEE's FPL service territory)
 *   - US48 — United States Lower 48 (proxy for VRT/EQIX/DLR national exposure)
 *
 * Metric type filter: `type=D` selects "Demand" (vs. DF=Demand Forecast,
 * NG=Net Generation, TI=Interchange). Units are megawatthours per hour
 * (i.e. average MW over that hour).
 *
 * Snapshot we compute per region:
 *   - last 7-day rolling avg of hourly demand (MWh/h)
 *   - YoY change pct vs. the same calendar week 365 days ago
 *   - most recent hour's value + ISO timestamp
 *
 * The function returns null on any error rather than throwing — the cron
 * loop treats null as "skip this region this run" and moves on.
 */

const EIA_API_KEY = process.env.EIA_API_KEY ?? ''
const EIA_BASE = 'https://api.eia.gov/v2/electricity/rto/region-data/data/'
const EIA_NG_HUB_BASE = 'https://api.eia.gov/v2/natural-gas/pri/fut/data/'
const EIA_FUELMIX_BASE = 'https://api.eia.gov/v2/electricity/rto/fuel-type-data/data/'
const EIA_NUC_OUTAGE_BASE = 'https://api.eia.gov/v2/nuclear-outages/us-nuclear-outages/data/'
const UA = 'compute-circuit (research tool) luigui.h2002@gmail.com'

// CO2 intensity (g/kWh) per fuel-type — used to weight fuel mix into a single
// carbon-intensity number per region. Source: EIA fuel-emissions factors,
// rounded. Renewables zeroed for operational intensity (lifecycle is non-zero
// but the day-to-day signal we want is the dispatched mix).
const CARBON_INTENSITY_G_PER_KWH: Record<string, number> = {
  coal: 950,           // lignite + bituminous blended
  natural_gas: 410,    // CCGT + peaker blended
  oil: 760,            // residual + distillate
  nuclear: 0,
  hydro: 0,
  wind: 0,
  solar: 0,
  other: 250,          // catch-all for misc biomass, geothermal etc.
}

export interface GridDemandSnapshot {
  region: string                // 'PJM' | 'ERCO' | 'FLA' | 'US48' | ...
  current_7d_avg_mwh: number
  yoy_change_pct: number
  last_hourly_mwh: number
  last_hour: string             // ISO timestamp (UTC, hour-precision)
}

interface EiaRow {
  period: string                // 'YYYY-MM-DDTHH'
  respondent: string
  type: string
  value: string | number
}

interface EiaResponse {
  response?: {
    data?: EiaRow[]
    total?: string
  }
  error?: string
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** EIA wants UTC hour-precision strings like '2026-05-24T18'. */
function eiaHour(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}`
}

/** Subtract `days` calendar days from `d` (returns a new Date). */
function daysAgo(d: Date, days: number): Date {
  const out = new Date(d.getTime())
  out.setUTCDate(out.getUTCDate() - days)
  return out
}

async function fetchHourly(region: string, start: Date, end: Date): Promise<EiaRow[] | null> {
  if (!EIA_API_KEY) return null
  const params = new URLSearchParams()
  params.set('api_key', EIA_API_KEY)
  params.set('frequency', 'hourly')
  params.append('data[0]', 'value')
  params.append('facets[respondent][]', region)
  params.append('facets[type][]', 'D')
  params.set('start', eiaHour(start))
  params.set('end', eiaHour(end))
  params.append('sort[0][column]', 'period')
  params.append('sort[0][direction]', 'desc')
  params.set('length', '5000')

  try {
    const r = await fetch(`${EIA_BASE}?${params.toString()}`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    })
    if (!r.ok) return null
    const data = (await r.json()) as EiaResponse
    return data?.response?.data ?? null
  } catch {
    return null
  }
}

/** Mean of an array of numbers; returns NaN for empty input. */
function mean(xs: number[]): number {
  if (xs.length === 0) return NaN
  let s = 0
  for (const x of xs) s += x
  return s / xs.length
}

export async function fetchGridDemand(region: string): Promise<GridDemandSnapshot | null> {
  if (!EIA_API_KEY) return null

  const now = new Date()

  // Window 1: most recent ~8 days. We ask 8 to be safe; the API lags 1-2h
  // so the most-recent row will be ~2h old, and we'll still have ≥168 hours.
  const recentStart = daysAgo(now, 8)
  const recent = await fetchHourly(region, recentStart, now)
  if (!recent || recent.length === 0) return null

  // Coerce + sort desc by period (API returns desc already, but be defensive)
  const recentRows = recent
    .map(r => ({ period: r.period, value: Number(r.value) }))
    .filter(r => Number.isFinite(r.value))
    .sort((a, b) => b.period.localeCompare(a.period))
  if (recentRows.length === 0) return null

  const last = recentRows[0]
  // Trailing 7 days = most recent 168 hours
  const last7d = recentRows.slice(0, 24 * 7).map(r => r.value)
  const current_7d_avg_mwh = mean(last7d)

  // Window 2: same 7-day window 365 days ago for YoY comparison
  const yoyEnd = daysAgo(now, 365)
  const yoyStart = daysAgo(yoyEnd, 7)
  const yoy = await fetchHourly(region, yoyStart, yoyEnd)
  // YoY is best-effort — older data sometimes has gaps in Form-930 backfills
  let yoy_change_pct = 0
  if (yoy && yoy.length > 0) {
    const yoyVals = yoy
      .map(r => Number(r.value))
      .filter(v => Number.isFinite(v))
      .slice(0, 24 * 7)
    const yoyAvg = mean(yoyVals)
    if (Number.isFinite(yoyAvg) && yoyAvg > 0) {
      yoy_change_pct = ((current_7d_avg_mwh - yoyAvg) / yoyAvg) * 100
    }
  }

  return {
    region,
    current_7d_avg_mwh: Math.round(current_7d_avg_mwh * 10) / 10,
    yoy_change_pct: Math.round(yoy_change_pct * 100) / 100,
    last_hourly_mwh: last.value,
    last_hour: `${last.period}:00:00Z`,
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Sequential fetcher — EIA has plenty of rate-limit headroom but be polite. */
export async function fetchAllGridDemand(
  regions: Array<{ companyId: string; region: string }>,
): Promise<Array<{ companyId: string; snap: GridDemandSnapshot | null }>> {
  const out: Array<{ companyId: string; snap: GridDemandSnapshot | null }> = []
  for (const r of regions) {
    const snap = await fetchGridDemand(r.region)
    out.push({ companyId: r.companyId, snap })
    await sleep(150) // 2 calls per region × 7 regions × 150ms < 3s total
  }
  return out
}

// ----- Henry Hub natural gas spot ($/MMBtu, daily) -----
//
// Series shape from /v2/natural-gas/pri/fut/data/:
//   { response: { data: [{ period, series, value, units, ... }, ...] } }
// We pin to series 'RNGWHHD' (Henry Hub Natural Gas Spot Price, Daily).

export interface CommoditySnapshot {
  series_id: string         // our slug, e.g. 'NG.HENRY_HUB.D'
  source_series: string     // raw EIA id for debugging
  value: number
  unit: string
  label: string
  snapshot_date: string     // YYYY-MM-DD
}

interface EiaCommodityRow {
  period: string
  series?: string
  value: string | number
  units?: string
  'series-description'?: string
}

interface EiaCommodityResponse {
  response?: { data?: EiaCommodityRow[] }
  error?: string
}

export async function fetchHenryHubSpot(): Promise<CommoditySnapshot | null> {
  if (!EIA_API_KEY) return null
  const params = new URLSearchParams()
  params.set('api_key', EIA_API_KEY)
  params.set('frequency', 'daily')
  params.append('data[0]', 'value')
  params.append('facets[series][]', 'RNGWHHD')
  params.append('sort[0][column]', 'period')
  params.append('sort[0][direction]', 'desc')
  params.set('length', '5')
  try {
    const r = await fetch(`${EIA_NG_HUB_BASE}?${params.toString()}`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    })
    if (!r.ok) return null
    const body = (await r.json()) as EiaCommodityResponse
    const rows = body?.response?.data ?? []
    const latest = rows
      .map(x => ({ period: x.period, value: Number(x.value), units: x.units, label: x['series-description'] }))
      .filter(x => Number.isFinite(x.value))
      .sort((a, b) => b.period.localeCompare(a.period))[0]
    if (!latest) return null
    return {
      series_id: 'NG.HENRY_HUB.D',
      source_series: 'RNGWHHD',
      value: Math.round(latest.value * 100) / 100,
      unit: latest.units ?? 'USD/MMBtu',
      label: 'Henry Hub spot',
      snapshot_date: latest.period.slice(0, 10),
    }
  } catch {
    return null
  }
}

// ----- US nuclear capacity offline (MW, daily) -----
//
// /v2/nuclear-outages/us-nuclear-outages returns daily aggregate:
//   { period, outage, percentOutage, capacity, ... }

interface EiaNucRow {
  period: string
  outage?: string | number
  percentOutage?: string | number
  capacity?: string | number
}
interface EiaNucResponse {
  response?: { data?: EiaNucRow[] }
}

export async function fetchUsNuclearOutage(): Promise<CommoditySnapshot | null> {
  if (!EIA_API_KEY) return null
  const params = new URLSearchParams()
  params.set('api_key', EIA_API_KEY)
  params.set('frequency', 'daily')
  params.append('data[0]', 'outage')
  params.append('data[1]', 'percentOutage')
  params.append('data[2]', 'capacity')
  params.append('sort[0][column]', 'period')
  params.append('sort[0][direction]', 'desc')
  params.set('length', '5')
  try {
    const r = await fetch(`${EIA_NUC_OUTAGE_BASE}?${params.toString()}`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    })
    if (!r.ok) return null
    const body = (await r.json()) as EiaNucResponse
    const rows = body?.response?.data ?? []
    const latest = rows
      .map(x => ({
        period: x.period,
        outage: Number(x.outage),
        pct: Number(x.percentOutage),
      }))
      .filter(x => Number.isFinite(x.outage))
      .sort((a, b) => b.period.localeCompare(a.period))[0]
    if (!latest) return null
    return {
      series_id: 'NUC.OUTAGE_US.D',
      source_series: 'nuclear-outages.us-nuclear-outages',
      value: Math.round(latest.outage),
      unit: 'MW',
      label: `US nuclear offline (${Number.isFinite(latest.pct) ? latest.pct.toFixed(1) : '?'}%)`,
      snapshot_date: latest.period.slice(0, 10),
    }
  } catch {
    return null
  }
}

// ----- Regional fuel-type mix (% generation by fuel, last 24h) -----
//
// /v2/electricity/rto/fuel-type-data returns per-respondent per-fueltype hourly
// generation. We aggregate the trailing 24h, normalize to %, and derive a
// weighted carbon-intensity.
//
// EIA fueltype codes we map:
//   COL → coal      NG  → natural_gas   OIL → oil
//   NUC → nuclear   WAT → hydro         WND → wind
//   SUN → solar     OTH → other         (BAT, GEO, etc.) → other

const FUEL_CODE_MAP: Record<string, string> = {
  COL: 'coal', NG: 'natural_gas', OIL: 'oil',
  NUC: 'nuclear', WAT: 'hydro', WND: 'wind', SUN: 'solar',
}

export interface FuelMixSnapshot {
  region: string
  fuel_mix: Record<string, number>
  total_mwh: number
  carbon_g_per_kwh: number
  snapshot_date: string
}

interface EiaFuelRow {
  period: string
  respondent: string
  fueltype: string
  type?: string
  value: string | number
}
interface EiaFuelResponse {
  response?: { data?: EiaFuelRow[] }
}

export async function fetchFuelMix(region: string): Promise<FuelMixSnapshot | null> {
  if (!EIA_API_KEY) return null
  const now = new Date()
  // Last ~30 hours window — EIA lags 1-2h, this gives us 24 clean hours.
  const start = new Date(now.getTime() - 30 * 3600 * 1000)
  const params = new URLSearchParams()
  params.set('api_key', EIA_API_KEY)
  params.set('frequency', 'hourly')
  params.append('data[0]', 'value')
  params.append('facets[respondent][]', region)
  params.set('start', eiaHour(start))
  params.set('end', eiaHour(now))
  params.append('sort[0][column]', 'period')
  params.append('sort[0][direction]', 'desc')
  params.set('length', '5000')
  try {
    const r = await fetch(`${EIA_FUELMIX_BASE}?${params.toString()}`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    })
    if (!r.ok) return null
    const body = (await r.json()) as EiaFuelResponse
    const rows = body?.response?.data ?? []
    if (rows.length === 0) return null

    // Sum MWh by fuel-type over the trailing 24h
    const byFuel = new Map<string, number>()
    for (const row of rows) {
      const v = Number(row.value)
      if (!Number.isFinite(v) || v < 0) continue
      const fuelKey = FUEL_CODE_MAP[row.fueltype] ?? 'other'
      byFuel.set(fuelKey, (byFuel.get(fuelKey) ?? 0) + v)
    }
    let total = 0
    for (const v of byFuel.values()) total += v
    if (total <= 0) return null

    const pct: Record<string, number> = {}
    let carbon = 0
    for (const [fuel, mwh] of byFuel) {
      const p = (mwh / total) * 100
      pct[fuel] = Math.round(p * 10) / 10
      const intensity = CARBON_INTENSITY_G_PER_KWH[fuel] ?? 250
      carbon += (mwh / total) * intensity
    }

    const latestPeriod = rows
      .map(r => r.period)
      .sort()
      .at(-1) ?? new Date().toISOString().slice(0, 10)

    return {
      region,
      fuel_mix: pct,
      total_mwh: Math.round(total),
      carbon_g_per_kwh: Math.round(carbon),
      snapshot_date: latestPeriod.slice(0, 10),
    }
  } catch {
    return null
  }
}

/** Fetch fuel mix for many regions sequentially. */
export async function fetchAllFuelMix(
  regions: string[],
): Promise<Array<{ region: string; snap: FuelMixSnapshot | null }>> {
  const out: Array<{ region: string; snap: FuelMixSnapshot | null }> = []
  for (const region of regions) {
    const snap = await fetchFuelMix(region)
    out.push({ region, snap })
    await sleep(150)
  }
  return out
}

// ----- Generic catalog-driven series fetcher -----
//
// Implements the EiaSeriesSpec contract from eia-catalog.ts. Builds the URL
// from endpoint + facets + data columns, asks for the most recent 5 periods,
// returns the latest with finite numeric value.
//
// Returns null on any error so the cron iterator can skip a series without
// blocking the others.

import type { EiaSeriesSpec, EiaCountrySpec } from './eia-catalog'

interface GenericEiaRow {
  period: string
  [k: string]: unknown
}
interface GenericEiaResponse {
  response?: { data?: GenericEiaRow[] }
  error?: string
}

export async function fetchCatalogSeries(spec: EiaSeriesSpec): Promise<CommoditySnapshot | null> {
  if (!EIA_API_KEY) return null
  const params = new URLSearchParams()
  params.set('api_key', EIA_API_KEY)
  params.set('frequency', spec.frequency)
  spec.data.forEach((d, i) => params.append(`data[${i}]`, d))
  for (const [facetKey, vals] of Object.entries(spec.facets ?? {})) {
    for (const v of vals) params.append(`facets[${facetKey}][]`, v)
  }
  params.append('sort[0][column]', 'period')
  params.append('sort[0][direction]', 'desc')
  params.set('length', '5')

  const url = `https://api.eia.gov/v2/${spec.endpoint}/?${params.toString()}`
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
    if (!r.ok) return null
    const body = (await r.json()) as GenericEiaResponse
    const rows = body?.response?.data ?? []
    const candidates = rows
      .map(row => ({
        period: row.period,
        rawValue: Number(row[spec.valueColumn]),
        units: typeof row.units === 'string' ? row.units : undefined,
      }))
      .filter(x => Number.isFinite(x.rawValue))
      .sort((a, b) => b.period.localeCompare(a.period))
    if (candidates.length === 0) return null
    const latest = candidates[0]
    const scaled = latest.rawValue * (spec.scale ?? 1)
    return {
      series_id: spec.id,
      source_series: spec.endpoint + (spec.facets ? '?' + Object.values(spec.facets).flat().join(',') : ''),
      value: Math.round(scaled * 100) / 100,
      unit: spec.unit ?? latest.units ?? '',
      label: spec.label,
      // EIA returns period at native frequency granularity ('2026-05-22' for
      // daily, '2026-05' for monthly, '2026' for annual). Pad to a real date
      // so the unique index on (series_id, snapshot_date) works.
      snapshot_date: padPeriodToDate(latest.period),
    }
  } catch {
    return null
  }
}

function padPeriodToDate(period: string): string {
  if (period.length >= 10) return period.slice(0, 10)
  if (period.length === 7) return `${period}-01`                  // YYYY-MM → YYYY-MM-01
  if (period.length === 4) return `${period}-01-01`               // YYYY    → YYYY-01-01
  return period
}

// ----- International electricity (per-country annual stats) -----
//
// EIA's international endpoint shape:
//   /v2/international/data/?facets[countryRegionId]=TWN&facets[productId]=2  ← electricity
//   &facets[activityId]=12  ← net generation
// Returns annual GWh values. We grab the latest 3 years and report the
// most recent + YoY delta as a fab-country grid-stress signal.

export interface InternationalElectricitySnap {
  countryId: string
  countryLabel: string
  fabExposure: string
  latestYear: number
  netGenerationTwh: number
  yoyPct: number | null
  snapshot_date: string
}

interface IntlEiaRow {
  period: string
  countryRegionId?: string
  value: string | number
  unit?: string
}

interface IntlEiaResponse {
  response?: { data?: IntlEiaRow[] }
  error?: string
}

export async function fetchCountryElectricity(spec: EiaCountrySpec): Promise<InternationalElectricitySnap | null> {
  if (!EIA_API_KEY) return null
  const params = new URLSearchParams()
  params.set('api_key', EIA_API_KEY)
  params.set('frequency', 'annual')
  params.append('data[0]', 'value')
  params.append('facets[countryRegionId][]', spec.countryId)
  params.append('facets[productId][]', '2')        // electricity
  params.append('facets[activityId][]', '12')      // net generation
  params.append('sort[0][column]', 'period')
  params.append('sort[0][direction]', 'desc')
  params.set('length', '3')

  try {
    const r = await fetch(`https://api.eia.gov/v2/international/data/?${params.toString()}`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    })
    if (!r.ok) return null
    const body = (await r.json()) as IntlEiaResponse
    const rows = (body?.response?.data ?? [])
      .map(x => ({ period: x.period, value: Number(x.value), unit: x.unit }))
      .filter(x => Number.isFinite(x.value))
      .sort((a, b) => b.period.localeCompare(a.period))
    if (rows.length === 0) return null
    const latest = rows[0]
    const prior = rows[1] ?? null
    // EIA reports BkWh (billion kWh) which equals TWh.
    const twh = latest.value
    const yoy = prior && prior.value > 0 ? ((twh - prior.value) / prior.value) * 100 : null
    return {
      countryId: spec.countryId,
      countryLabel: spec.countryLabel,
      fabExposure: spec.fabExposure,
      latestYear: Number(latest.period),
      netGenerationTwh: Math.round(twh * 10) / 10,
      yoyPct: yoy != null ? Math.round(yoy * 100) / 100 : null,
      snapshot_date: padPeriodToDate(latest.period),
    }
  } catch {
    return null
  }
}

export async function fetchAllCountryElectricity(
  specs: EiaCountrySpec[],
): Promise<Array<{ spec: EiaCountrySpec; snap: InternationalElectricitySnap | null }>> {
  const out: Array<{ spec: EiaCountrySpec; snap: InternationalElectricitySnap | null }> = []
  for (const s of specs) {
    const snap = await fetchCountryElectricity(s)
    out.push({ spec: s, snap })
    await sleep(150)
  }
  return out
}

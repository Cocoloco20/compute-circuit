import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/service-role'

import {
  fetchAllGridDemand,
  fetchUsNuclearOutage,
  fetchAllFuelMix,
  fetchCatalogSeries,
  fetchAllCountryElectricity,
} from '@/lib/eia'
import { EIA_SERIES_CATALOG, EIA_FAB_COUNTRIES } from '@/lib/eia-catalog'

/**
 * Daily EIA cron — comprehensive supply-chain ingestion.
 *
 * Five orthogonal slices, each independent (one failing doesn't block the others):
 *
 *   1. grid_demand_snapshots        — per-company regional demand (7d avg + YoY%)
 *   2. eia_commodity_snapshots      — catalog-driven single-series (Henry Hub,
 *                                      coal stocks, gas storage, retail elec
 *                                      price, US gen total, CO2, etc.) plus
 *                                      a dedicated nuclear-outage fetch.
 *   3. eia_fuelmix_snapshots        — per-region fuel mix + carbon intensity
 *   4. eia_international_snapshots  — fab-country electricity (Taiwan, Korea,
 *                                      Japan, NL, Singapore, Ireland)
 *
 * Adding a new series = appending to EIA_SERIES_CATALOG. The cron picks it up
 * automatically with no code changes here.
 *
 * Wall-clock: ~25 series × 200ms + 7 demand × 600ms + 4 fuelmix × 350ms +
 * 6 country × 200ms ≈ 15s on cold cache. Well under the 60s Vercel Hobby cap.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface CoRow { id: string; eia_region: string }

interface DemandRow {
  company_id: string
  snapshot_date: string
  region: string
  current_7d_avg_mwh: number
  yoy_change_pct: number
  last_hourly_mwh: number
  last_hour: string
}

interface CommodityRow {
  series_id: string
  snapshot_date: string
  value: number
  unit: string
  label: string
  source_series: string
}

interface FuelMixRow {
  region: string
  snapshot_date: string
  fuel_mix: Record<string, number>
  total_mwh: number
  carbon_g_per_kwh: number
}

interface IntlRow {
  country_id: string
  country_label: string
  fab_exposure: string
  snapshot_date: string
  latest_year: number
  net_generation_twh: number
  yoy_pct: number | null
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return NextResponse.json({ error: 'supabase env missing' }, { status: 500 })
  if (!process.env.EIA_API_KEY) {
    return NextResponse.json({ ok: false, error: 'EIA_API_KEY not configured' }, { status: 500 })
  }

  const sb = supabaseServiceRole()
  const t0 = Date.now()
  const snapshotDate = new Date().toISOString().slice(0, 10)

  // ----- 1. Per-company regional demand -----
  const cosResp = await sb
    .from('companies')
    .select('id, eia_region')
    .not('eia_region', 'is', null)
  if (cosResp.error) return NextResponse.json({ error: cosResp.error.message }, { status: 500 })
  const cos = ((cosResp.data ?? []) as CoRow[]).filter(c => c.eia_region)

  const demandResults = await fetchAllGridDemand(cos.map(c => ({ companyId: c.id, region: c.eia_region })))
  const demandRows: DemandRow[] = demandResults
    .filter(r => r.snap)
    .map(r => ({
      company_id: r.companyId,
      snapshot_date: snapshotDate,
      region: r.snap!.region,
      current_7d_avg_mwh: r.snap!.current_7d_avg_mwh,
      yoy_change_pct: r.snap!.yoy_change_pct,
      last_hourly_mwh: r.snap!.last_hourly_mwh,
      last_hour: r.snap!.last_hour,
    }))
  if (demandRows.length > 0) {
    const up = await (sb.from('grid_demand_snapshots') as unknown as {
      upsert: (rows: DemandRow[], opts: { onConflict: string }) =>
        Promise<{ error: { message: string } | null }>
    }).upsert(demandRows, { onConflict: 'company_id,snapshot_date' })
    if (up.error) console.warn('[eia] grid_demand upsert:', up.error.message)
  }

  // ----- 2a. Catalog-driven national commodity series -----
  // Run in parallel — each is one HTTP request to EIA.
  const catalogResults = await Promise.all(EIA_SERIES_CATALOG.map(spec => fetchCatalogSeries(spec)))
  const commodityRows: CommodityRow[] = catalogResults
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .map(s => ({
      series_id: s.series_id,
      snapshot_date: s.snapshot_date,
      value: s.value,
      unit: s.unit,
      label: s.label,
      source_series: s.source_series,
    }))

  // ----- 2b. Dedicated nuclear-outage fetch (different endpoint shape) -----
  const nukeOutage = await fetchUsNuclearOutage()
  if (nukeOutage) {
    commodityRows.push({
      series_id: nukeOutage.series_id,
      snapshot_date: nukeOutage.snapshot_date,
      value: nukeOutage.value,
      unit: nukeOutage.unit,
      label: nukeOutage.label,
      source_series: nukeOutage.source_series,
    })
  }

  if (commodityRows.length > 0) {
    const up = await (sb.from('eia_commodity_snapshots') as unknown as {
      upsert: (rows: CommodityRow[], opts: { onConflict: string }) =>
        Promise<{ error: { message: string } | null }>
    }).upsert(commodityRows, { onConflict: 'series_id,snapshot_date' })
    if (up.error) console.warn('[eia] commodity upsert:', up.error.message)
  }

  // ----- 3. Regional fuel mix -----
  const distinctRegions = Array.from(new Set(cos.map(c => c.eia_region)))
  const fuelResults = await fetchAllFuelMix(distinctRegions)
  const fuelRows: FuelMixRow[] = fuelResults
    .filter(f => f.snap)
    .map(f => ({
      region: f.snap!.region,
      snapshot_date: f.snap!.snapshot_date,
      fuel_mix: f.snap!.fuel_mix,
      total_mwh: f.snap!.total_mwh,
      carbon_g_per_kwh: f.snap!.carbon_g_per_kwh,
    }))
  if (fuelRows.length > 0) {
    const up = await (sb.from('eia_fuelmix_snapshots') as unknown as {
      upsert: (rows: FuelMixRow[], opts: { onConflict: string }) =>
        Promise<{ error: { message: string } | null }>
    }).upsert(fuelRows, { onConflict: 'region,snapshot_date' })
    if (up.error) console.warn('[eia] fuelmix upsert:', up.error.message)
  }

  // ----- 4. International fab-country electricity -----
  const intlResults = await fetchAllCountryElectricity(EIA_FAB_COUNTRIES)
  const intlRows: IntlRow[] = intlResults
    .filter(r => r.snap)
    .map(r => ({
      country_id: r.snap!.countryId,
      country_label: r.snap!.countryLabel,
      fab_exposure: r.snap!.fabExposure,
      snapshot_date: r.snap!.snapshot_date,
      latest_year: r.snap!.latestYear,
      net_generation_twh: r.snap!.netGenerationTwh,
      yoy_pct: r.snap!.yoyPct,
    }))
  if (intlRows.length > 0) {
    const up = await (sb.from('eia_international_snapshots') as unknown as {
      upsert: (rows: IntlRow[], opts: { onConflict: string }) =>
        Promise<{ error: { message: string } | null }>
    }).upsert(intlRows, { onConflict: 'country_id,snapshot_date' })
    if (up.error) console.warn('[eia] intl upsert:', up.error.message)
  }

  return NextResponse.json({
    ok: true,
    fetchMs: Date.now() - t0,
    demand: {
      scanned: cos.length,
      fetched: demandRows.length,
    },
    commodities: {
      scanned: EIA_SERIES_CATALOG.length + 1,        // +1 for nuke
      fetched: commodityRows.length,
      sample: commodityRows.slice(0, 10).map(c => ({
        series: c.series_id,
        value: c.value,
        unit: c.unit,
        date: c.snapshot_date,
      })),
    },
    fuelmix: {
      scanned: distinctRegions.length,
      fetched: fuelRows.length,
      sample: fuelRows.map(f => ({ region: f.region, carbon: f.carbon_g_per_kwh })),
    },
    international: {
      scanned: EIA_FAB_COUNTRIES.length,
      fetched: intlRows.length,
      sample: intlRows.map(r => ({
        country: r.country_id,
        twh: r.net_generation_twh,
        yoy: r.yoy_pct,
        fab: r.fab_exposure,
      })),
    },
  })
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

import { fetchAllGridDemand } from '@/lib/eia'
import type { Database } from '@/types/db'

/**
 * Daily EIA grid-demand snapshot.
 *
 * For each company with eia_region set, hit api.eia.gov for the trailing
 * 7-day hourly demand series plus the same week 365d ago for YoY, then
 * upsert a per-day snapshot. ~7 companies × 2 EIA calls × ~300ms = ~5s.
 *
 * Requires EIA_API_KEY env var (free signup at eia.gov/opendata/register).
 * If unset, fetchGridDemand returns null for every region and the run
 * reports `inserted: 0` with a `note` flag — non-fatal.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface CoRow {
  id: string
  eia_region: string
}

interface SnapshotRow {
  company_id: string
  snapshot_date: string
  region: string
  current_7d_avg_mwh: number
  yoy_change_pct: number
  last_hourly_mwh: number
  last_hour: string
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

  const sb = createClient<Database>(url, key, { auth: { persistSession: false } })

  const cosResp = await sb
    .from('companies')
    .select('id, eia_region')
    .not('eia_region', 'is', null)
  if (cosResp.error) return NextResponse.json({ error: cosResp.error.message }, { status: 500 })
  const cos = ((cosResp.data ?? []) as CoRow[]).filter(c => c.eia_region)

  if (cos.length === 0) {
    return NextResponse.json({ ok: true, scanned: 0, inserted: 0, note: 'no eia_region-tagged companies' })
  }

  const startedAt = Date.now()
  const results = await fetchAllGridDemand(cos.map(c => ({ companyId: c.id, region: c.eia_region })))
  const fetchMs = Date.now() - startedAt

  const snapshotDate = new Date().toISOString().slice(0, 10)
  const rows: SnapshotRow[] = []
  for (const r of results) {
    if (!r.snap) continue
    rows.push({
      company_id: r.companyId,
      snapshot_date: snapshotDate,
      region: r.snap.region,
      current_7d_avg_mwh: r.snap.current_7d_avg_mwh,
      yoy_change_pct: r.snap.yoy_change_pct,
      last_hourly_mwh: r.snap.last_hourly_mwh,
      last_hour: r.snap.last_hour,
    })
  }

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, scanned: cos.length, fetched: 0, fetchMs })
  }

  const upResp = await (sb.from('grid_demand_snapshots') as unknown as {
    upsert: (rows: SnapshotRow[], opts: { onConflict: string }) =>
      Promise<{ error: { message: string } | null }>
  }).upsert(rows, { onConflict: 'company_id,snapshot_date' })
  if (upResp.error) return NextResponse.json({ error: upResp.error.message }, { status: 500 })

  return NextResponse.json({
    ok: true,
    scanned: cos.length,
    fetched: rows.length,
    fetchMs,
    snapshots: rows.map(r => ({
      company: r.company_id,
      region: r.region,
      load_gwh: Math.round(r.last_hourly_mwh / 100) / 10,           // MWh → GWh, 1dp
      avg7d_gwh: Math.round(r.current_7d_avg_mwh / 100) / 10,
      yoy_pct: r.yoy_change_pct,
    })),
  })
}

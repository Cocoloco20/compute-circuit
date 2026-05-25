import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/service-role'

import { fetchBtcNetwork } from '@/lib/btc'

/**
 * Daily Bitcoin network snapshot — proxy for global compute spend.
 *
 * Hashrate ↑ = more ASICs being switched on + more grid power being rented.
 * That demand competes for the same fabs (TSMC N5/N4) and the same MW that
 * AI hyperscalers want, so it's a clean "economics" backdrop for the rest
 * of the supply-chain panel.
 *
 * Three rows per run into eia_commodity_snapshots (reusing the single-series
 * table — no new migration needed):
 *
 *   BTC.HASHRATE.D       — exahashes/sec (EH/s)
 *   BTC.DIFFICULTY.D     — raw difficulty target
 *   BTC.NETWORK_POWER.D  — estimated network draw (MW) @ 25 J/TH fleet blend
 *
 * Source: mempool.space free API (no auth, 100 req/hour rate limit).
 * Wall clock: ~1s (two parallel HTTPs + one upsert).
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface CommodityRow {
  series_id: string
  snapshot_date: string
  value: number
  unit: string
  label: string
  source_series: string
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

  const t0 = Date.now()
  const snap = await fetchBtcNetwork()
  if (!snap) {
    return NextResponse.json({ ok: false, error: 'mempool.space fetch failed', fetchMs: Date.now() - t0 }, { status: 502 })
  }

  const rows: CommodityRow[] = [
    {
      series_id: 'BTC.HASHRATE.D',
      snapshot_date: snap.snapshot_date,
      value: snap.hashrate_ehs,
      unit: 'EH/s',
      label: 'BTC network hashrate',
      source_series: 'mempool.space/api/v1/mining/hashrate/3d',
    },
    {
      series_id: 'BTC.DIFFICULTY.D',
      snapshot_date: snap.snapshot_date,
      value: snap.difficulty,
      unit: 'T',
      label: `BTC difficulty (last adj ${snap.last_adj_pct >= 0 ? '+' : ''}${snap.last_adj_pct.toFixed(2)}%)`,
      source_series: 'mempool.space/api/v1/mining/difficulty-adjustments',
    },
    {
      series_id: 'BTC.NETWORK_POWER.D',
      snapshot_date: snap.snapshot_date,
      value: snap.est_network_mw,
      unit: 'MW',
      label: 'BTC network power estimate (25 J/TH)',
      source_series: 'mempool.space/api/v1/mining/hashrate/3d',
    },
  ]

  const sb = supabaseServiceRole()
  const up = await (sb.from('eia_commodity_snapshots') as unknown as {
    upsert: (rows: CommodityRow[], opts: { onConflict: string }) =>
      Promise<{ error: { message: string } | null }>
  }).upsert(rows, { onConflict: 'series_id,snapshot_date' })
  if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 })

  return NextResponse.json({
    ok: true,
    fetchMs: Date.now() - t0,
    snapshot: snap,
    rows: rows.map(r => ({ series: r.series_id, value: r.value, unit: r.unit })),
  })
}

import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/service-role'

import {
  fetchVastAiBundles,
  fetchRunpodGpuTypes,
  aggregateGpuSpot,
  type GpuSpotSnapshot,
} from '@/lib/gpu-spot'

/**
 * Daily GPU spot-price snapshot — median $/GPU-hr across the public rental market.
 *
 * Pulls Vast.ai's verified+rentable order book + RunPod's gpuTypes catalog in
 * parallel, aggregates each provider into per-(model,source) medians, then
 * emits a third 'blended' row per model using the combined order book.
 *
 * Upserts into gpu_spot_prices with unique constraint on
 * (snapshot_date, gpu_model, source) — safe to re-run.
 *
 * Wall clock: ~2-3s (two parallel HTTPs + one batched upsert).
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

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
  const [bundles, runpods] = await Promise.all([
    fetchVastAiBundles(),
    fetchRunpodGpuTypes(),
  ])
  const fetchMs = Date.now() - t0

  if (bundles.length === 0 && runpods.length === 0) {
    return NextResponse.json({
      ok: false,
      error: 'both providers returned empty',
      fetchMs,
    }, { status: 502 })
  }

  const snapshots = aggregateGpuSpot(bundles, runpods)
  if (snapshots.length === 0) {
    return NextResponse.json({
      ok: false,
      error: 'no matching GPU models found in fetched data',
      fetchMs,
      vastCount: bundles.length,
      runpodCount: runpods.length,
    }, { status: 502 })
  }

  const sb = supabaseServiceRole()
  const up = await (sb.from('gpu_spot_prices') as unknown as {
    upsert: (rows: GpuSpotSnapshot[], opts: { onConflict: string }) =>
      Promise<{ error: { message: string } | null }>
  }).upsert(snapshots, { onConflict: 'snapshot_date,gpu_model,source' })
  if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 })

  // Compact summary for the response — caller-friendly view of what got written.
  const byModelBlended = snapshots
    .filter(s => s.source === 'blended')
    .map(s => ({
      model: s.gpu_model,
      median: s.median_usd_per_hour,
      n: s.listing_count,
    }))

  return NextResponse.json({
    ok: true,
    fetchMs,
    totalMs: Date.now() - t0,
    vastCount: bundles.length,
    runpodCount: runpods.length,
    rowsWritten: snapshots.length,
    blended: byModelBlended,
  })
}

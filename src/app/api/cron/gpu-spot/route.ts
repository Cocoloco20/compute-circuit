import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/service-role'

import {
  fetchVastAiBundles,
  fetchRunpodGpuTypes,
  aggregateGpuSpot,
  type GpuSpotSnapshot,
} from '@/lib/gpu-spot'

import {
  fetchAwsSpotPricing,
  fetchAzureSpotPricing,
  sleep,
  type GpuHyperscalerRow,
} from '@/lib/gpu-hyperscaler'

/**
 * Daily GPU spot-price + hyperscaler availability snapshot.
 *
 * Tier 1 (rental market): Vast.ai + RunPod — unchanged, blended median per
 * (model, source). Now also captures listing_count_by_region per Vast.ai row.
 *
 * Tier 2 (hyperscalers): AWS p-series + Azure ND/NC H100 series spot pricing.
 * Results go into gpu_hyperscaler_pricing with 1s politeness gap between
 * providers. Hyperscaler failures are non-fatal: they log a warning and the
 * route still returns ok=true as long as Tier 1 succeeds.
 *
 * Upserts into gpu_spot_prices: unique (snapshot_date, gpu_model, source).
 * Upserts into gpu_hyperscaler_pricing: unique (snapshot_date, gpu_model, provider, region).
 *
 * Wall clock: ~5-8s (two parallel HTTPs + two serial hyperscaler calls + upserts).
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
  const snapshotDate = new Date().toISOString().slice(0, 10)

  // ── Tier 1: Vast.ai + RunPod (parallel) ───────────────────────────────────
  const [bundles, runpods] = await Promise.all([
    fetchVastAiBundles(),
    fetchRunpodGpuTypes(),
  ])
  const fetchMs = Date.now() - t0

  if (bundles.length === 0 && runpods.length === 0) {
    return NextResponse.json({
      ok: true,
      error: 'both providers returned empty',
      fetchMs,
    })
  }

  const snapshots = aggregateGpuSpot(bundles, runpods, snapshotDate)
  if (snapshots.length === 0) {
    return NextResponse.json({
      ok: true,
      error: 'no matching GPU models found in fetched data',
      fetchMs,
      vastCount: bundles.length,
      runpodCount: runpods.length,
    })
  }

  const sb = supabaseServiceRole()
  const retrievedAt = new Date().toISOString()
  // Stamp retrieval provenance on every row (migration 0047): when WE fetched
  // it, as distinct from snapshot_date (the day the data describes).
  const stamped = snapshots.map(r => ({ ...r, retrieved_at: retrievedAt }))
  const up = await (sb.from('gpu_spot_prices') as unknown as {
    upsert: (rows: (GpuSpotSnapshot & { retrieved_at: string })[], opts: { onConflict: string }) =>
      Promise<{ error: { message: string } | null }>
  }).upsert(stamped, { onConflict: 'snapshot_date,gpu_model,source' })
  if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 })

  // ── Tier 2: Hyperscalers (serial with 1s gap for politeness) ─────────────
  const hyperscalerRows: GpuHyperscalerRow[] = []
  const hyperscalerErrors: string[] = []

  try {
    const awsRows = await fetchAwsSpotPricing(snapshotDate)
    hyperscalerRows.push(...awsRows)
  } catch (err) {
    hyperscalerErrors.push(`aws: ${err instanceof Error ? err.message : String(err)}`)
  }

  await sleep(1000)

  try {
    const azureRows = await fetchAzureSpotPricing(snapshotDate)
    hyperscalerRows.push(...azureRows)
  } catch (err) {
    hyperscalerErrors.push(`azure: ${err instanceof Error ? err.message : String(err)}`)
  }

  let hyperscalerWritten = 0
  if (hyperscalerRows.length > 0) {
    const upHs = await (sb.from('gpu_hyperscaler_pricing') as unknown as {
      upsert: (rows: GpuHyperscalerRow[], opts: { onConflict: string }) =>
        Promise<{ error: { message: string } | null }>
    }).upsert(hyperscalerRows, { onConflict: 'snapshot_date,gpu_model,provider,region' })
    if (upHs.error) {
      hyperscalerErrors.push(`upsert: ${upHs.error.message}`)
    } else {
      hyperscalerWritten = hyperscalerRows.length
    }
  }
  if (hyperscalerErrors.length > 0) {
    // eslint-disable-next-line no-console
    console.warn('[gpu-spot] hyperscaler fetch partial failure:', hyperscalerErrors.join('; '))
  }

  // ── Response ──────────────────────────────────────────────────────────────
  const byModelBlended = snapshots
    .filter(s => s.source === 'blended')
    .map(s => ({
      model: s.gpu_model,
      median: s.median_usd_per_hour,
      n: s.listing_count,
    }))

  // Summarize hyperscaler rows by provider
  const hyperscalerSummary = hyperscalerRows.reduce<Record<string, number>>((acc, r) => {
    acc[r.provider] = (acc[r.provider] ?? 0) + 1
    return acc
  }, {})

  return NextResponse.json({
    ok: true,
    fetchMs,
    totalMs: Date.now() - t0,
    vastCount: bundles.length,
    runpodCount: runpods.length,
    rowsWritten: snapshots.length,
    blended: byModelBlended,
    hyperscaler: {
      rowsWritten: hyperscalerWritten,
      byProvider: hyperscalerSummary,
      errors: hyperscalerErrors.length > 0 ? hyperscalerErrors : undefined,
    },
  })
}


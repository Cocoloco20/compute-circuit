import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/service-role'

/**
 * Watchlist write API — Phase 9 investor layer.
 *
 * The page READS the watchlist via the anon role (RLS select-true) inside
 * fetchGraph; this route exists only for WRITES, which need the service
 * role. Auth is the same Bearer CRON_SECRET the cron routes use — for a
 * single-user tool that's the right amount of ceremony. The client caches
 * the key in localStorage after the first unlock, so tracking a company is
 * one click thereafter.
 *
 *   POST   { company_id, shares?, avg_cost_usd?, target_buy_usd?,
 *            target_sell_usd?, thesis_note?, alerts_enabled? }   → upsert
 *   DELETE ?company_id=nvda                                       → remove
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function unauthorized() {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
}

function checkAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  return !!secret && req.headers.get('authorization') === `Bearer ${secret}`
}

interface WatchlistUpsert {
  company_id: string
  shares?: number | null
  avg_cost_usd?: number | null
  target_buy_usd?: number | null
  target_sell_usd?: number | null
  thesis_note?: string | null
  alerts_enabled?: boolean
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return unauthorized()
  let body: WatchlistUpsert
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  if (!body.company_id || typeof body.company_id !== 'string') {
    return NextResponse.json({ error: 'company_id required' }, { status: 400 })
  }
  const sb = supabaseServiceRole()
  const row = {
    company_id: body.company_id,
    shares: body.shares ?? null,
    avg_cost_usd: body.avg_cost_usd ?? null,
    target_buy_usd: body.target_buy_usd ?? null,
    target_sell_usd: body.target_sell_usd ?? null,
    thesis_note: body.thesis_note ?? null,
    alerts_enabled: body.alerts_enabled ?? true,
    updated_at: new Date().toISOString(),
  }
  type Row = typeof row
  const r = await (sb.from('watchlist') as unknown as {
    upsert: (r: Row, opts: { onConflict: string }) =>
      Promise<{ error: { message: string } | null }>
  }).upsert(row, { onConflict: 'company_id' })
  if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 })
  return NextResponse.json({ ok: true, row })
}

export async function DELETE(req: NextRequest) {
  if (!checkAuth(req)) return unauthorized()
  const companyId = req.nextUrl.searchParams.get('company_id')
  if (!companyId) return NextResponse.json({ error: 'company_id required' }, { status: 400 })
  const sb = supabaseServiceRole()
  const r = await sb.from('watchlist').delete().eq('company_id', companyId)
  if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

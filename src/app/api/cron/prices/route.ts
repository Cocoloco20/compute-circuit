import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/service-role'

import { fetchAllYahooQuotes } from '@/lib/market'

/**
 * Daily price refresh.
 *
 * Pulls Yahoo Finance chart-endpoint quotes for every company with a ticker
 * and writes price + prevClose + 52w range back to the companies row.
 * Free, no auth, ~32 requests at 120ms each = under 5s on Hobby.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface TickerRow {
  id: string
  ticker: string
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
  const sb = supabaseServiceRole()

  // Paginate — Supabase select() default cap is 1000 rows. Without this loop
  // the prices cron silently stopped at 1000 ticker-having cos (post Phase-7B
  // that's only ~40% of the table). Each page is one round-trip; 2-3 pages
  // total adds <300ms.
  const PAGE = 1000
  const tickers: TickerRow[] = []
  for (let from = 0; ; from += PAGE) {
    const r = await sb.from('companies').select('id, ticker').not('ticker', 'is', null).range(from, from + PAGE - 1).order('id')
    if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 })
    const batch = ((r.data ?? []) as TickerRow[]).filter(x => x.ticker)
    tickers.push(...batch)
    if (batch.length < PAGE) break
  }

  // BUDGET GUARD — fetchAllYahooQuotes is sequential at ~8 req/sec
  // (yahoo throttles aggressively). 2,400 tickers × 120ms = 288s, way over
  // the 60s Vercel cap. Until we switch to a queue worker, rotate through
  // a sliding window of 350 cos per invocation prioritized by stalest-price.
  // Daily cycle covers every co in ~7 days.
  const CRON_BUDGET = 350
  if (tickers.length > CRON_BUDGET) {
    const { data: oldest } = await sb
      .from('prices')
      .select('company_id')
      .order('updated_at', { ascending: true })
      .limit(CRON_BUDGET)
    const staleIds = new Set((oldest ?? []).map((r) => (r as { company_id: string }).company_id))
    tickers.sort((a, b) => (staleIds.has(b.id) ? 1 : 0) - (staleIds.has(a.id) ? 1 : 0))
    tickers.length = CRON_BUDGET
  }

  const startedAt = Date.now()
  const quotes = await fetchAllYahooQuotes(tickers.map(t => t.ticker))
  const fetchMs = Date.now() - startedAt

  const updates: Array<{ id: string; q: ReturnType<typeof Map.prototype.get> }> = []
  for (const t of tickers) {
    const q = quotes.get(t.ticker)
    if (q) updates.push({ id: t.id, q })
  }

  let updated = 0
  const nowIso = new Date().toISOString()
  // Sequential updates — Supabase doesn't support per-row UPDATE in a single upsert
  // when the rows have different SET clauses. Fast enough for ~32 rows.
  for (const u of updates) {
    const q = u.q as {
      price: number
      prevClose: number
      high52w: number | null
      low52w: number | null
      currency: string
      history: Array<[string, number]>
    }
    // Cap history at last 90 entries (Yahoo's 3mo range tends to give ~63
    // trading days; cap protects future-proofs against a Yahoo range change).
    const history = (q.history ?? []).slice(-90)
    const patch = {
      last_price: q.price,
      prev_close: q.prevClose,
      fifty_two_week_high: q.high52w,
      fifty_two_week_low: q.low52w,
      price_currency: q.currency,
      price_updated_at: nowIso,
      price_history: history,
    }
    const r = await (sb.from('companies') as unknown as {
      update: (p: typeof patch) => { eq: (col: string, val: string) => Promise<{ error: { message: string } | null }> }
    }).update(patch).eq('id', u.id)
    if (!r.error) updated++
  }

  return NextResponse.json({
    ok: true,
    scanned: tickers.length,
    fetched: quotes.size,
    updated,
    fetchMs,
  })
}

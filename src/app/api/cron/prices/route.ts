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

  // ONE query: stalest-priced tickers first, already capped at the budget.
  //
  // This used to page the whole 2,461-row table and then trim to 350, which
  // spent round-trips reading 2,100 rows it was about to throw away — and
  // those round-trips came out of the same 60s budget as the Yahoo calls.
  // Postgres can do the ordering and the limit for us in a single trip.
  //
  // nullsFirst puts never-priced companies at the front, so a newly imported
  // co gets a price on the next run rather than waiting out the rotation.
  const CRON_BUDGET = 250
  const { data: rows, error: rowsErr } = await sb
    .from('companies')
    .select('id, ticker')
    .not('ticker', 'is', null)
    .order('price_updated_at', { ascending: true, nullsFirst: true })
    .limit(CRON_BUDGET)
  if (rowsErr) return NextResponse.json({ error: rowsErr.message }, { status: 500 })
  const tickers = ((rows ?? []) as unknown as TickerRow[]).filter(x => x.ticker)

  // Leave ~15s of the 60s cap for the upserts. Going over doesn't just lose
  // the tail — the platform kills the lambda before ANY write lands, which is
  // how this cron produced zero rows on every run instead of partial ones.
  const FETCH_DEADLINE_MS = 40_000

  const startedAt = Date.now()
  const quotes = await fetchAllYahooQuotes(tickers.map(t => t.ticker), FETCH_DEADLINE_MS)
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
    // fetched===0 with scanned>0 means the upstream is unreachable from this
    // egress, not that the query returned nothing. Worth distinguishing.
    upstreamReachable: quotes.size > 0,
    updated,
    fetchMs,
  })
}

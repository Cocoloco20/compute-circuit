import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/service-role'

import { fetchNewsForMany } from '@/lib/news'

/**
 * Daily news refresh from Google News RSS.
 *
 * For every company:
 *   - Public (has ticker) → query "TICKER stock"
 *   - Private (name only) → query exact name
 * Fetch in parallel chunks of 12. Take the top 8 articles per company,
 * upsert into signals (form_type='news', source='google-news', source_key
 * = "news:{company_id}:{link}" for per-co dedup). Link to the company via
 * signal_companies.
 *
 * ~150 companies × 8 articles = ~1200 signals per run. source_key partial
 * unique index makes re-runs idempotent.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const PER_COMPANY_CAP = 8

interface CoRow {
  id: string
  ticker: string | null
  name: string
}

interface SignalInsert {
  date: string
  source: string
  headline: string
  url: string
  form_type: string
  source_key: string
  impact: string | null
}

interface UpsertResp {
  data: Array<{ id: string; source_key: string | null }> | null
  error: { message: string } | null
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

  // Paginate — Supabase select() default cap is 1000 rows, which silently
  // truncated the news cron for our 2,461-row companies table (Phase 7B
  // added the Forbes Global 2000 + FT 500 EU). Without this loop the cron
  // only processed the first 1000 rows by id-sort order and the rest never
  // got any news. Each page is one DB round-trip; with 2-3 pages total this
  // adds <300ms even before the news fetches.
  const PAGE = 1000
  const companies: CoRow[] = []
  for (let from = 0; ; from += PAGE) {
    const r = await sb.from('companies').select('id, ticker, name').range(from, from + PAGE - 1).order('id')
    if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 })
    const batch = (r.data ?? []) as CoRow[]
    companies.push(...batch)
    if (batch.length < PAGE) break
  }

  // BUDGET GUARD — the cron has 60s. Fetching news for all 2,461 cos at
  // chunkSize=12 takes ~200-400s and times out. Until we batch into multiple
  // cron invocations or move to a queue worker, only run a sliding window:
  // the oldest-news 600 cos per invocation. Daily cycle covers everyone in
  // ~4 days; pulse-board / drawer never see total-zero state for any co.
  const CRON_BUDGET = 600
  const { data: oldestLink } = await sb
    .from('signal_companies')
    .select('company_id, signals!inner(date)')
    .order('signals(date)', { ascending: true })
    .limit(CRON_BUDGET)
  const oldestIds = new Set((oldestLink ?? []).map((r) => (r as { company_id: string }).company_id))
  const prioritized = companies.sort((a, b) => {
    // Cos with old-or-no news first.
    const ao = oldestIds.has(a.id) ? 0 : 1
    const bo = oldestIds.has(b.id) ? 0 : 1
    return ao - bo
  }).slice(0, CRON_BUDGET)

  const queries = prioritized.map(c => ({
    id: c.id,
    query: c.ticker ? `${c.ticker} stock` : c.name,
  }))

  const startedAt = Date.now()
  const byCompany = await fetchNewsForMany(queries, 12)
  const fetchMs = Date.now() - startedAt

  // Shape signal rows + remember the (companyId, source_key) link mapping
  const signalRows: SignalInsert[] = []
  const links: Array<{ companyId: string; sourceKey: string }> = []
  let totalFetched = 0
  for (const co of companies) {
    const items = byCompany.get(co.id) ?? []
    totalFetched += items.length
    for (const n of items.slice(0, PER_COMPANY_CAP)) {
      const sourceKey = `news:${co.id}:${n.link}`
      signalRows.push({
        date: n.pubDate.slice(0, 10),
        source: 'google-news',
        headline: n.title,
        url: n.link,
        form_type: 'news',
        source_key: sourceKey,
        impact: n.source || null,  // publisher (e.g. "Bloomberg")
      })
      links.push({ companyId: co.id, sourceKey })
    }
  }

  if (signalRows.length === 0) {
    return NextResponse.json({ ok: true, scanned: queries.length, fetched: 0, inserted: 0, fetchMs })
  }

  // Upsert signals — duplicates (same source_key) get ignored.
  const insResp = (await (sb.from('signals') as unknown as {
    upsert: (rows: SignalInsert[], opts: { onConflict: string; ignoreDuplicates: boolean }) => {
      select: (cols: string) => Promise<UpsertResp>
    }
  })
    .upsert(signalRows, { onConflict: 'source_key', ignoreDuplicates: true })
    .select('id, source_key'))
  if (insResp.error) return NextResponse.json({ error: insResp.error.message }, { status: 500 })

  // For *all* signalRows we need IDs — newly inserted come back from .select,
  // but already-existing (duplicates ignored) won't. Fetch missing ones.
  const idByKey = new Map<string, string>()
  for (const row of insResp.data ?? []) {
    if (row.source_key) idByKey.set(row.source_key, row.id)
  }
  const missing = links.filter(l => !idByKey.has(l.sourceKey)).map(l => l.sourceKey)
  if (missing.length > 0) {
    // Fetch existing rows in chunks of 200 to keep query manageable
    for (let i = 0; i < missing.length; i += 200) {
      const chunk = missing.slice(i, i + 200)
      const r = await sb.from('signals').select('id, source_key').in('source_key', chunk)
      if (!r.error && r.data) {
        for (const row of r.data as Array<{ id: string; source_key: string | null }>) {
          if (row.source_key) idByKey.set(row.source_key, row.id)
        }
      }
    }
  }

  // Build company_signal links and upsert
  const linkRows = links
    .map(l => ({ signal_id: idByKey.get(l.sourceKey), company_id: l.companyId }))
    .filter((l): l is { signal_id: string; company_id: string } => !!l.signal_id)

  let linksInserted = 0
  if (linkRows.length > 0) {
    const linkResp = await (sb.from('signal_companies') as unknown as {
      upsert: (rows: typeof linkRows, opts: { onConflict: string; ignoreDuplicates: boolean; count: 'exact' }) =>
        Promise<{ error: { message: string } | null; count: number | null }>
    }).upsert(linkRows, { onConflict: 'signal_id,company_id', ignoreDuplicates: true, count: 'exact' })
    if (linkResp.error) return NextResponse.json({ error: linkResp.error.message }, { status: 500 })
    linksInserted = linkResp.count ?? linkRows.length
  }

  return NextResponse.json({
    ok: true,
    scanned: queries.length,
    fetched: totalFetched,
    candidates: signalRows.length,
    insertedOrExisting: insResp.data?.length ?? 0,
    linksInserted,
    fetchMs,
  })
}

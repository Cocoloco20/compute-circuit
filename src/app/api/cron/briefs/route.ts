import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/service-role'
import { fetchBriefWithFallback } from '@/lib/company-brief'

/**
 * Read homepages for the companies that matter, stalest first.
 *
 * PRIORITY IS THE WHOLE DESIGN. There are 10,792 companies with a domain and
 * no reason to read most of them. A company on the board is one you are
 * actually deciding about, so it gets read first and refreshed soonest;
 * everything else fills the remaining budget.
 *
 *   1. anything in pipeline_cards        — you are deciding about these
 *   2. anything you have invested in     — you own these
 *   3. recent, active, small YC names    — the sourcing set
 *   4. companies the tracked funds back  — most backers first
 *
 * Tier 4 exists because tiers 1-3 could never reach the reference layer: after
 * the 2026-09-09 portfolio rebuild, 1,271 companies that GC, GV, Coatue, BCV,
 * Khosla, Craft and Initialized have money in would have sat with no brief
 * forever. Ordering by backer count is the useful signal — four tracked funds
 * in one company is a stronger reason to read its homepage than one.
 *
 * Bounded by wall clock, not by count, and it commits what it has. The pattern
 * every other cron here needed the hard way.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const FETCH_DEADLINE_MS = 40_000
const CONCURRENCY = 6
/** Re-read a good homepage at most this often — copy does not change daily. */
const REFRESH_DAYS = 30
/**
 * A failure is not a settled fact. A 403, a timeout or a dead DNS answer can
 * all be different next week, so a failed read is retried far sooner than a
 * good one is refreshed — without hammering a site that just refused us.
 */
const RETRY_FAILED_DAYS = 7

/**
 * PostgREST caps an unbounded select() at 1000 rows and reports no error. This
 * repo has been bitten by that four times — most recently here, where a silently
 * truncated `fresh` set would make the cron re-read homepages it already had
 * until the budget was gone. Page explicitly; never trust a bare select().
 */
async function allCompanyIds(query: {
  range: (from: number, to: number) => PromiseLike<{ data: unknown[] | null }>
}): Promise<string[]> {
  const PAGE = 1000
  const out: string[] = []
  for (let from = 0; ; from += PAGE) {
    const { data } = await query.range(from, from + PAGE - 1)
    const rows = (data ?? []) as Array<{ company_id: string }>
    out.push(...rows.map(r => r.company_id).filter(Boolean))
    if (rows.length < PAGE) return out
  }
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const sb = supabaseServiceRole()
  const cutoff = new Date(Date.now() - REFRESH_DAYS * 86_400_000).toISOString()

  // Already-fresh briefs are skipped, so the budget goes to new ground.
  const retryCutoff = new Date(Date.now() - RETRY_FAILED_DAYS * 86_400_000).toISOString()
  // Fresh = a good brief inside the refresh window, or a failed one still
  // inside its shorter retry window. Anything else is fair game again.
  const fresh = new Set([
    ...await allCompanyIds(sb.from('company_briefs').select('company_id')
      .eq('fetch_status', 'ok').gte('fetched_at', cutoff)),
    ...await allCompanyIds(sb.from('company_briefs').select('company_id')
      .neq('fetch_status', 'ok').gte('fetched_at', retryCutoff)),
  ])

  const ordered: string[] = []
  const push = (ids: string[]) => {
    for (const id of ids) if (!fresh.has(id) && !ordered.includes(id)) ordered.push(id)
  }

  const { data: cards } = await sb.from('pipeline_cards').select('company_id')
  push(((cards ?? []) as unknown as Array<{ company_id: string }>).map(c => c.company_id))

  const { data: inv } = await sb.from('investments').select('company_id')
  push(((inv ?? []) as unknown as Array<{ company_id: string }>).map(c => c.company_id))

  const { data: yc } = await sb.from('yc_companies')
    .select('company_id').eq('status', 'Active').lte('team_size', 40)
    .order('batch', { ascending: false }).limit(300)
  push(((yc ?? []) as unknown as Array<{ company_id: string }>).map(c => c.company_id))

  // Tier 4: everything a tracked fund backs, most-backed first. company_backers
  // is ~14.8k rows, so this MUST page — an unbounded select() returns 1000 and
  // says nothing about the rest.
  if (ordered.length < 400) {
    const backerCount = new Map<string, number>()
    for (const id of await allCompanyIds(sb.from('company_backers').select('company_id'))) {
      backerCount.set(id, (backerCount.get(id) ?? 0) + 1)
    }
    push([...backerCount.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id))
  }

  if (!ordered.length) {
    return NextResponse.json({ ok: true, considered: 0, fetched: 0, note: 'everything in scope is fresh' })
  }

  const { data: cos } = await sb.from('companies')
    .select('id, domain, name').in('id', ordered.slice(0, 400))
  const byId = new Map(((cos ?? []) as unknown as
    Array<{ id: string; domain: string | null; name: string | null }>).map(c => [c.id, c]))

  const started = Date.now()
  const rows: Array<Record<string, unknown>> = []
  const counts: Record<string, number> = {}
  let attempted = 0

  const targets = ordered.slice(0, 400)
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    if (Date.now() - started > FETCH_DEADLINE_MS) break
    await Promise.all(targets.slice(i, i + CONCURRENCY).map(async id => {
      const c = byId.get(id)
      const b = await fetchBriefWithFallback(c?.domain ?? null, c?.name ?? null)
      attempted++
      const key = b.source === 'wikipedia' ? 'ok_via_wikipedia' : b.fetchStatus
      counts[key] = (counts[key] ?? 0) + 1
      rows.push({
        company_id: id, url: b.url, title: b.title, description: b.description,
        headline: b.headline, extract: b.extract, source: b.source,
        fetch_status: b.fetchStatus, http_status: b.httpStatus,
        fetched_at: new Date().toISOString(),
      })
    }))
  }

  let written = 0
  if (rows.length) {
    const r = await (sb.from('company_briefs') as unknown as {
      upsert: (rows: unknown[], o: { onConflict: string }) => Promise<{ error: { message: string } | null }>
    }).upsert(rows, { onConflict: 'company_id' })
    if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 })
    written = rows.length
  }

  return NextResponse.json({
    ok: true,
    considered: ordered.length,
    attempted,
    written,
    // Left for the next run rather than silently dropped.
    remaining: Math.max(0, ordered.length - attempted),
    byStatus: counts,
    elapsedMs: Date.now() - started,
  })
}

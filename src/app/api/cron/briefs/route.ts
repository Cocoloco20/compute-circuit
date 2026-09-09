import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/service-role'
import { fetchBrief } from '@/lib/company-brief'

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
 *
 * Bounded by wall clock, not by count, and it commits what it has. The pattern
 * every other cron here needed the hard way.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const FETCH_DEADLINE_MS = 40_000
const CONCURRENCY = 6
/** Re-read a homepage at most this often — copy does not change daily. */
const REFRESH_DAYS = 30

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const sb = supabaseServiceRole()
  const cutoff = new Date(Date.now() - REFRESH_DAYS * 86_400_000).toISOString()

  // Already-fresh briefs are skipped, so the budget goes to new ground.
  const { data: freshRows } = await sb.from('company_briefs')
    .select('company_id').gte('fetched_at', cutoff)
  const fresh = new Set(((freshRows ?? []) as unknown as Array<{ company_id: string }>)
    .map(r => r.company_id))

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

  if (!ordered.length) {
    return NextResponse.json({ ok: true, considered: 0, fetched: 0, note: 'everything in scope is fresh' })
  }

  const { data: cos } = await sb.from('companies')
    .select('id, domain').in('id', ordered.slice(0, 400))
  const domainById = new Map(((cos ?? []) as unknown as Array<{ id: string; domain: string | null }>)
    .map(c => [c.id, c.domain]))

  const started = Date.now()
  const rows: Array<Record<string, unknown>> = []
  const counts: Record<string, number> = {}
  let attempted = 0

  const targets = ordered.slice(0, 400)
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    if (Date.now() - started > FETCH_DEADLINE_MS) break
    await Promise.all(targets.slice(i, i + CONCURRENCY).map(async id => {
      const b = await fetchBrief(domainById.get(id) ?? null)
      attempted++
      counts[b.fetchStatus] = (counts[b.fetchStatus] ?? 0) + 1
      rows.push({
        company_id: id, url: b.url, title: b.title, description: b.description,
        headline: b.headline, extract: b.extract,
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

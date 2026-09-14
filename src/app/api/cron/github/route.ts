import { NextRequest, NextResponse } from 'next/server'
import { startBudget, DEFAULT_FETCH_BUDGET_MS } from '@/lib/cron-budget'
import { supabaseServiceRole } from '@/lib/supabase/service-role'

import { fetchAllRepoActivity } from '@/lib/github'

/**
 * Daily GitHub activity snapshot.
 *
 * For each company with github_repo set, hit api.github.com to get stars,
 * 30-day PR velocity, contributor count, and most-recent release. Upsert
 * one row per (company, snapshot_date) — cheap, ~20 cos × ~1.5s each.
 *
 * Mirrors /api/cron/hf-activity/route.ts.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface CoRow {
  id: string
  github_repo: string
}

interface ActivityRow {
  company_id: string
  snapshot_date: string
  repo_full_name: string
  stars: number
  prs_30d_merged: number
  prs_30d_open: number
  contributors_30d: number
  last_release_tag: string | null
  last_release_date: string | null
  commits_7d: number
  commits_30d: number
  distinct_committers_30d: number
  lines_added_30d: number
  lines_removed_30d: number
  commits_weekly_history: Array<{ week_starting: string; count: number }>
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

  const cosResp = await sb.from('companies').select('id, github_repo').not('github_repo', 'is', null)
  if (cosResp.error) return NextResponse.json({ error: cosResp.error.message }, { status: 500 })
  const cos = ((cosResp.data ?? []) as CoRow[]).filter(c => c.github_repo)

  if (cos.length === 0) {
    return NextResponse.json({ ok: true, scanned: 0, inserted: 0, note: 'no github-repo-tagged companies' })
  }

  // Each repo costs 4-6 GitHub calls plus a 350ms pace, so ~7s/repo when the
  // search API is slow. Stop launching new repos once the budget is gone and
  // upsert the ones that finished; the unvisited tail leads tomorrow's walk.
  const budget = startBudget(DEFAULT_FETCH_BUDGET_MS)
  // Rotate the start point once per UTC day so a budget stop doesn't leave
  // the same repos at the tail unvisited every night.
  const start = Math.floor(Date.now() / 86_400_000) % cos.length
  const ordered = [...cos.slice(start), ...cos.slice(0, start)]
  const results = await fetchAllRepoActivity(
    ordered.map(c => ({ companyId: c.id, repo: c.github_repo })),
    budget,
  )
  const fetchMs = budget.elapsed()
  const budgetExhausted = budget.expired()

  const snapshotDate = new Date().toISOString().slice(0, 10)
  const rows: ActivityRow[] = []
  for (const r of results) {
    if (!r.snap) continue
    rows.push({
      company_id: r.companyId,
      snapshot_date: snapshotDate,
      repo_full_name: r.snap.repoFullName,
      stars: r.snap.stars,
      prs_30d_merged: r.snap.prs30dMerged,
      prs_30d_open: r.snap.prs30dOpen,
      contributors_30d: r.snap.contributors30d,
      last_release_tag: r.snap.lastReleaseTag,
      last_release_date: r.snap.lastReleaseDate,
      commits_7d: r.snap.commits_7d,
      commits_30d: r.snap.commits_30d,
      distinct_committers_30d: r.snap.distinct_committers_30d,
      lines_added_30d: r.snap.lines_added_30d,
      lines_removed_30d: r.snap.lines_removed_30d,
      commits_weekly_history: r.snap.commits_weekly_history,
    })
  }

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, scanned: results.length, planned: cos.length, fetched: 0, fetchMs, budgetExhausted })
  }

  const upResp = await (sb.from('github_activity') as unknown as {
    upsert: (rows: ActivityRow[], opts: { onConflict: string }) =>
      Promise<{ error: { message: string } | null }>
  }).upsert(rows, { onConflict: 'company_id,snapshot_date' })
  if (upResp.error) return NextResponse.json({ error: upResp.error.message }, { status: 500 })

  return NextResponse.json({
    ok: true,
    scanned: results.length,
    planned: cos.length,
    fetched: rows.length,
    fetchMs,
    budgetExhausted,
    top: rows
      .slice()
      .sort((a, b) => b.stars - a.stars)
      .slice(0, 5)
      .map(r => ({ repo: r.repo_full_name, stars: r.stars, merged30d: r.prs_30d_merged, lastRel: r.last_release_tag })),
  })
}

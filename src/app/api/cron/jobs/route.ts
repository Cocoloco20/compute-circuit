import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/service-role'

import { fetchAllJobBoards, JOB_BOARDS, type JobBoardConfig } from '@/lib/jobs'

/**
 * Daily "hiring pulse" snapshot.
 *
 * For each company with an entry in JOB_BOARDS (src/lib/jobs.ts) we hit the
 * provider's free public JSON endpoint, count total open reqs, and bucket by
 * department/team. Upsert one row per (company, snapshot_date).
 *
 * Companies on Workday / iCIMS / SuccessFactors are intentionally excluded —
 * those ATSes don't expose a stable slug-based public JSON endpoint.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface SnapshotRow {
  company_id: string
  snapshot_date: string
  total_open: number
  top_categories: Array<{ name: string; count: number }>
  source_provider: string
  source_slug: string
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

  // Filter the static map to companies that actually exist in the db, to
  // protect against drift if a company is deleted but its slug still lives in
  // jobs.ts.
  //
  // Ask only for the ids in the map. This used to select('id') over the whole
  // table, which Supabase silently caps at 1000 rows — so once `companies`
  // grew past 1000 the validity set became an arbitrary slice that contained
  // none of the board companies, and this cron returned "no companies map to
  // a known job board" every night while reporting ok. That is why
  // job_snapshots held 78 rows.
  //
  // Checking 79 known ids is also just the right query: it cannot be capped,
  // and it does not read 11,000 rows to answer a question about 79.
  const boardIds = Object.keys(JOB_BOARDS)
  const cosResp = await sb.from('companies').select('id').in('id', boardIds)
  if (cosResp.error) return NextResponse.json({ error: cosResp.error.message }, { status: 500 })
  const validIds = new Set(((cosResp.data ?? []) as Array<{ id: string }>).map(c => c.id))

  const entries: Array<{ companyId: string; cfg: JobBoardConfig }> = []
  for (const [companyId, cfg] of Object.entries(JOB_BOARDS)) {
    if (validIds.has(companyId)) entries.push({ companyId, cfg })
  }

  if (entries.length === 0) {
    return NextResponse.json({ ok: true, scanned: 0, inserted: 0, note: 'no companies map to a known job board' })
  }

  const startedAt = Date.now()
  const results = await fetchAllJobBoards(entries)
  const fetchMs = Date.now() - startedAt

  const snapshotDate = new Date().toISOString().slice(0, 10)
  const rows: SnapshotRow[] = []
  const failures: Array<{ companyId: string; provider: string; slug: string }> = []
  for (const r of results) {
    if (!r.snap) {
      failures.push({ companyId: r.companyId, provider: r.cfg.provider, slug: r.cfg.slug })
      continue
    }
    const top_categories = Object.entries(r.snap.byCategory)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
    rows.push({
      company_id: r.companyId,
      snapshot_date: snapshotDate,
      total_open: r.snap.totalOpen,
      top_categories,
      source_provider: r.cfg.provider,
      source_slug: r.cfg.slug,
    })
  }

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, scanned: entries.length, fetched: 0, fetchMs, failures })
  }

  const upResp = await (sb.from('job_snapshots') as unknown as {
    upsert: (rows: SnapshotRow[], opts: { onConflict: string }) =>
      Promise<{ error: { message: string } | null }>
  }).upsert(rows, { onConflict: 'company_id,snapshot_date' })
  if (upResp.error) return NextResponse.json({ error: upResp.error.message }, { status: 500 })

  return NextResponse.json({
    ok: true,
    scanned: entries.length,
    fetched: rows.length,
    fetchMs,
    failures,
    top: rows
      .slice()
      .sort((a, b) => b.total_open - a.total_open)
      .slice(0, 5)
      .map(r => ({
        company: r.company_id,
        open: r.total_open,
        topCat: r.top_categories[0]?.name ?? null,
        topCount: r.top_categories[0]?.count ?? 0,
      })),
  })
}

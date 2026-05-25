import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

import { fetchAllPatentSnapshots } from '@/lib/uspto'
import type { Database } from '@/types/db'

/**
 * Daily USPTO patent-snapshot cron.
 *
 * For each company with assignee_name set, hit api.uspto.gov ODP search and
 * compute the TTM filings count + top-3 CPC subclasses + 3 most recent titles.
 * Upsert one row per (company, snapshot_date).
 *
 * Pacing: 200ms sleep between assignees baked into fetchAllPatentSnapshots —
 * with 21 assignees that's ~4.2s of sleep + ~21 × <2s of fetches = comfortably
 * under the 60s Hobby plan cap.
 *
 * Auth: bearer CRON_SECRET (matches /api/cron/* convention).
 * USPTO key: USPTO_API_KEY env, free signup via https://data.uspto.gov/myodp.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface CoRow {
  id: string
  assignee_name: string
}

interface SnapshotRow {
  company_id: string
  snapshot_date: string
  ttm_count: number
  top_subclasses: Array<{ code: string; count: number }>
  recent_titles: Array<{ title: string; filingDate: string }>
  source: string
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (!process.env.USPTO_API_KEY) {
    return NextResponse.json({ error: 'USPTO_API_KEY not configured' }, { status: 500 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return NextResponse.json({ error: 'supabase env missing' }, { status: 500 })
  const sb = createClient<Database>(url, key, { auth: { persistSession: false } })

  const cosResp = await sb
    .from('companies')
    .select('id, assignee_name')
    .not('assignee_name', 'is', null)
  if (cosResp.error) return NextResponse.json({ error: cosResp.error.message }, { status: 500 })
  const cos = ((cosResp.data ?? []) as CoRow[]).filter(c => c.assignee_name)

  if (cos.length === 0) {
    return NextResponse.json({ ok: true, scanned: 0, fetched: 0, note: 'no assignee-tagged companies' })
  }

  const startedAt = Date.now()
  const results = await fetchAllPatentSnapshots(
    cos.map(c => ({ companyId: c.id, name: c.assignee_name }))
  )
  const fetchMs = Date.now() - startedAt

  const snapshotDate = new Date().toISOString().slice(0, 10)
  const rows: SnapshotRow[] = []
  let nullCount = 0
  for (const r of results) {
    if (!r.snap) {
      nullCount += 1
      continue
    }
    rows.push({
      company_id: r.companyId,
      snapshot_date: snapshotDate,
      ttm_count: r.snap.ttmCount,
      top_subclasses: r.snap.topCpcSubclasses,
      recent_titles: r.snap.recentTitles,
      source: 'uspto-odp',
    })
  }

  if (rows.length === 0) {
    return NextResponse.json({
      ok: false,
      scanned: cos.length,
      fetched: 0,
      nullCount,
      fetchMs,
      note: 'all fetches returned null — check USPTO_API_KEY and rate limits',
    }, { status: 502 })
  }

  const upResp = await (sb.from('patent_snapshots') as unknown as {
    upsert: (rows: SnapshotRow[], opts: { onConflict: string }) =>
      Promise<{ error: { message: string } | null }>
  }).upsert(rows, { onConflict: 'company_id,snapshot_date' })
  if (upResp.error) return NextResponse.json({ error: upResp.error.message }, { status: 500 })

  return NextResponse.json({
    ok: true,
    scanned: cos.length,
    fetched: rows.length,
    nullCount,
    fetchMs,
    top: rows
      .slice()
      .sort((a, b) => b.ttm_count - a.ttm_count)
      .slice(0, 5)
      .map(r => ({
        company_id: r.company_id,
        ttm: r.ttm_count,
        areas: r.top_subclasses.map(s => `${s.code}:${s.count}`).join(' '),
      })),
  })
}

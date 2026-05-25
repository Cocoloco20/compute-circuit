import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/service-role'

import { fetchAllHfOrgs } from '@/lib/hf'

/**
 * Daily Hugging Face activity snapshot.
 *
 * For each company with hf_org set, hit huggingface.co/api/models?author=<slug>
 * and aggregate download counts, model count, top model, last release date.
 * Upsert one row per (company, snapshot_date) — cheap, ~20 cos × <1s each.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface CoRow {
  id: string
  hf_org: string
}

interface ActivityRow {
  company_id: string
  snapshot_date: string
  org_slug: string
  model_count: number
  total_downloads_30d: number
  top_model_id: string | null
  top_model_downloads: number | null
  last_release_date: string | null
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

  const cosResp = await sb.from('companies').select('id, hf_org').not('hf_org', 'is', null)
  if (cosResp.error) return NextResponse.json({ error: cosResp.error.message }, { status: 500 })
  const cos = ((cosResp.data ?? []) as CoRow[]).filter(c => c.hf_org)

  if (cos.length === 0) {
    return NextResponse.json({ ok: true, scanned: 0, inserted: 0, note: 'no hf-org-tagged companies' })
  }

  const startedAt = Date.now()
  const results = await fetchAllHfOrgs(cos.map(c => ({ companyId: c.id, org: c.hf_org })))
  const fetchMs = Date.now() - startedAt

  const snapshotDate = new Date().toISOString().slice(0, 10)
  const rows: ActivityRow[] = []
  for (const r of results) {
    if (!r.snap) continue
    rows.push({
      company_id: r.companyId,
      snapshot_date: snapshotDate,
      org_slug: r.snap.org,
      model_count: r.snap.modelCount,
      total_downloads_30d: r.snap.totalDownloads30d,
      top_model_id: r.snap.topModelId,
      top_model_downloads: r.snap.topModelDownloads,
      last_release_date: r.snap.lastReleaseDate,
    })
  }

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, scanned: cos.length, fetched: 0, fetchMs })
  }

  const upResp = await (sb.from('hf_activity') as unknown as {
    upsert: (rows: ActivityRow[], opts: { onConflict: string }) =>
      Promise<{ error: { message: string } | null }>
  }).upsert(rows, { onConflict: 'company_id,snapshot_date' })
  if (upResp.error) return NextResponse.json({ error: upResp.error.message }, { status: 500 })

  return NextResponse.json({
    ok: true,
    scanned: cos.length,
    fetched: rows.length,
    fetchMs,
    top: rows
      .slice()
      .sort((a, b) => b.total_downloads_30d - a.total_downloads_30d)
      .slice(0, 5)
      .map(r => ({ org: r.org_slug, models: r.model_count, dl30d: r.total_downloads_30d })),
  })
}

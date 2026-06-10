import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/service-role'
import { fetchAllArxivSnapshots } from '@/lib/arxiv'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface CompanyRow {
  id: string
  arxiv_affiliation: string
}

interface ArxivPaperInsertRow {
  company_id: string
  arxiv_id: string
  title: string
  summary: string
  authors: string[]
  primary_category: string
  published_date: string
  url: string
}

interface ArxivSnapshotInsertRow {
  company_id: string
  snapshot_date: string
  papers_30d: number
  papers_7d: number
  top_paper_arxiv_id: string | null
  top_paper_title: string | null
  yoy_pct: number | null
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const sb = supabaseServiceRole()

  // Select all companies with an arxiv_affiliation configured
  const cosResp = await sb
    .from('companies')
    .select('id, arxiv_affiliation')
    .not('arxiv_affiliation', 'is', null)

  if (cosResp.error) {
    return NextResponse.json({ error: cosResp.error.message }, { status: 500 })
  }

  const cos = ((cosResp.data ?? []) as CompanyRow[]).filter(c => c.arxiv_affiliation)
  if (cos.length === 0) {
    return NextResponse.json({ ok: true, scanned: 0, snapshotsUpserted: 0, papersUpserted: 0, note: 'no arxiv-tagged companies' })
  }

  const startedAt = Date.now()
  const results = await fetchAllArxivSnapshots(
    cos.map((c) => ({ companyId: c.id, affiliation: c.arxiv_affiliation }))
  )
  const fetchMs = Date.now() - startedAt

  const papersToUpsert: ArxivPaperInsertRow[] = []
  const snapshotsToUpsert: ArxivSnapshotInsertRow[] = []

  for (const r of results) {
    if (r.snap) {
      snapshotsToUpsert.push({
        company_id: r.snap.companyId,
        snapshot_date: r.snap.snapshotDate,
        papers_30d: r.snap.papers30d,
        papers_7d: r.snap.papers7d,
        top_paper_arxiv_id: r.snap.topPaperArxivId,
        top_paper_title: r.snap.topPaperTitle,
        yoy_pct: r.snap.yoyPct,
      })
    }

    for (const p of r.papers) {
      papersToUpsert.push({
        company_id: r.companyId,
        arxiv_id: p.arxivId,
        title: p.title,
        summary: p.summary,
        authors: p.authors,
        primary_category: p.primaryCategory,
        published_date: p.publishedDate.toISOString().slice(0, 10),
        url: p.url,
      })
    }
  }

  // 1. Bulk upsert papers. The same arxiv_id can appear under multiple
  // companies in one run (co-authored papers — e.g. a DeepMind × Meta AI
  // collaboration matches both affiliation queries). Postgres rejects a
  // single ON CONFLICT DO UPDATE statement that touches the same row twice
  // ("cannot affect row a second time"), so dedupe by arxiv_id first —
  // last writer wins, which is fine since the paper fields are identical
  // across duplicates.
  let papersUpserted = 0
  if (papersToUpsert.length > 0) {
    const byArxivId = new Map<string, ArxivPaperInsertRow>()
    for (const p of papersToUpsert) byArxivId.set(p.arxiv_id, p)
    const deduped = Array.from(byArxivId.values())

    const paperResp = await (sb.from('arxiv_papers') as unknown as {
      upsert: (rows: ArxivPaperInsertRow[], opts: { onConflict: string }) =>
        Promise<{ error: { message: string } | null }>
    }).upsert(deduped, { onConflict: 'arxiv_id' })

    if (paperResp.error) {
      return NextResponse.json({ error: `Papers upsert failed: ${paperResp.error.message}` }, { status: 500 })
    }
    papersUpserted = deduped.length
  }

  // 2. Bulk upsert snapshots
  let snapshotsUpserted = 0
  if (snapshotsToUpsert.length > 0) {
    const snapResp = await (sb.from('arxiv_snapshots') as unknown as {
      upsert: (rows: ArxivSnapshotInsertRow[], opts: { onConflict: string }) =>
        Promise<{ error: { message: string } | null }>
    }).upsert(snapshotsToUpsert, { onConflict: 'company_id,snapshot_date' })

    if (snapResp.error) {
      return NextResponse.json({ error: `Snapshots upsert failed: ${snapResp.error.message}` }, { status: 500 })
    }
    snapshotsUpserted = snapshotsToUpsert.length
  }

  return NextResponse.json({
    ok: true,
    scanned: cos.length,
    snapshotsUpserted,
    papersUpserted,
    fetchMs,
  })
}

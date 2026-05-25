import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/service-role'
import { fetchPageViews } from '@/lib/wikipedia'
import { fetchTrendsScore } from '@/lib/google-trends'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface CompanyRow {
  id: string
  name: string
  wikipedia_slug: string | null
  google_trends_term: string | null
}

interface InterestSignalRow {
  company_id: string
  snapshot_date: string
  wikipedia_views_7d: number | null
  wikipedia_views_28d: number | null
  wikipedia_yoy_pct: number | null
  google_trends_score: number | null
  google_trends_7d_delta: number | null
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function processCompany(co: CompanyRow) {
  let wikiResult = null
  let trendsResult = null

  if (co.wikipedia_slug) {
    wikiResult = await fetchPageViews(co.wikipedia_slug)
    await sleep(1500) // Polite sleep after Wikipedia fetch
  }

  if (co.google_trends_term) {
    trendsResult = await fetchTrendsScore(co.google_trends_term)
    await sleep(3000) // Polite sleep after Google Trends fetch
  }

  return {
    companyId: co.id,
    wiki: wikiResult,
    trends: trendsResult,
  }
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const sb = supabaseServiceRole()

  // Select all companies with at least one tag
  const cosResp = await sb
    .from('companies')
    .select('id, name, wikipedia_slug, google_trends_term')
    .or('wikipedia_slug.not.is.null,google_trends_term.not.is.null')

  if (cosResp.error) {
    return NextResponse.json({ error: cosResp.error.message }, { status: 500 })
  }

  const cos = (cosResp.data ?? []) as CompanyRow[]
  if (cos.length === 0) {
    return NextResponse.json({ ok: true, scanned: 0, upserted: 0, note: 'no tagged companies' })
  }

  const startedAt = Date.now()
  const results: Array<{
    companyId: string
    wiki: { views7d: number; views28d: number; yoyPct: number | null } | null
    trends: { score: number | null; delta7d: number | null } | null
  }> = []

  // Process in parallel batches of 5
  const batchSize = 5
  for (let i = 0; i < cos.length; i += batchSize) {
    const batch = cos.slice(i, i + batchSize)
    const batchResults = await Promise.all(batch.map((co) => processCompany(co)))
    results.push(...batchResults)
  }

  const elapsedMs = Date.now() - startedAt
  const snapshotDate = new Date().toISOString().slice(0, 10)
  
  const rows: InterestSignalRow[] = results.map((r) => ({
    company_id: r.companyId,
    snapshot_date: snapshotDate,
    wikipedia_views_7d: r.wiki?.views7d ?? null,
    wikipedia_views_28d: r.wiki?.views28d ?? null,
    wikipedia_yoy_pct: r.wiki?.yoyPct ?? null,
    google_trends_score: r.trends?.score ?? null,
    google_trends_7d_delta: r.trends?.delta7d ?? null,
  }))

  const upResp = await (sb.from('interest_signals') as unknown as {
    upsert: (rows: InterestSignalRow[], opts: { onConflict: string }) =>
      Promise<{ error: { message: string } | null }>
  }).upsert(rows, { onConflict: 'company_id,snapshot_date' })

  if (upResp.error) {
    return NextResponse.json({ error: upResp.error.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    scanned: cos.length,
    upserted: rows.length,
    elapsedMs,
    sample: rows.slice(0, 5),
  })
}

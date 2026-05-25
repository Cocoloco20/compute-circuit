import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/service-role'

import { fetchFormDOfferingForCik } from '@/lib/edgar'

/**
 * Daily Form D funding-round tracker.
 *
 * For each PRIVATE CIKed company:
 *   1) Pull submissions.json (cached on SEC side).
 *   2) Filter to form='D' or 'D/A' filed within the last 90 days.
 *   3) Fetch each primary_doc.xml and parse the offering amounts +
 *      related-person names.
 *   4) Upsert one row per (company_id, accession) into funding_rounds.
 *
 * Why filter to private=true: many of our CIKs belong to PUBLIC cos that
 * raise via S-1 / 10-K / 10-Q, not Form D. Skipping them keeps the cron
 * focused (private cos with CIK = cos discovered via Form D scraper, plus
 * any hand-curated late-stage private with CIK).
 *
 * Hobby plan 60s budget: parallel batches of 5 CIKs, each CIK averages
 * 0-2 Form D filings in a 90d window, so total fetches stay well under
 * the budget even at 100+ private cos.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// 540 days = ~18 months. Most private rounds happen every 12-18 months;
// a 90d window misses too much when this is a one-shot backfill against
// freshly-CIKed cos. The cron is incremental (dedups on accession), so the
// wide window only costs more SEC fetches on first run.
const LOOKBACK_DAYS = 540
const BATCH_SIZE = 5

interface CompanyRow {
  id: string
  cik: string
}

interface FundingRoundInsert {
  company_id: string
  filed_date: string
  accession: string
  total_amount_sold_usd: number | null
  total_offering_amount_usd: number | null
  total_amount_remaining_usd: number | null
  has_amount_indefinite: boolean
  investors_named: string[]
  source_url: string | null
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

  // Only PRIVATE cos with CIK. Public cos file Form D rarely (almost never),
  // and most of our companies.cik values are from public-co 10-K backfill.
  const cosResp = await sb
    .from('companies')
    .select('id, cik')
    .eq('private', true)
    .not('cik', 'is', null)
  if (cosResp.error) return NextResponse.json({ error: cosResp.error.message }, { status: 500 })
  const companies = ((cosResp.data ?? []) as CompanyRow[]).filter(c => c.cik)

  const startedAt = Date.now()
  const rows: FundingRoundInsert[] = []
  const perCo: Record<string, { filings: number; latestRaiseUsd: number | null }> = {}

  // Parallel batches of 5 CIKs. SEC's rate ceiling is 10 req/sec — 5 parallel
  // CIKs × inner 150ms sleep per XML fetch ≈ 33 req/sec aggregate worst case,
  // but in practice each CIK has 0-2 filings in 90d so the burst is brief.
  for (let i = 0; i < companies.length; i += BATCH_SIZE) {
    const batch = companies.slice(i, i + BATCH_SIZE)
    const results = await Promise.all(
      batch.map(async (co) => {
        try {
          const data = await fetchFormDOfferingForCik(co.cik, { lookbackDays: LOOKBACK_DAYS })
          return { co, data }
        } catch {
          return { co, data: [] }
        }
      }),
    )
    for (const { co, data } of results) {
      let latestRaise: number | null = null
      let latestDate = ''
      for (const d of data) {
        rows.push({
          company_id: co.id,
          filed_date: d.filedDate,
          accession: d.accession,
          total_amount_sold_usd: d.totalAmountSoldUsd,
          total_offering_amount_usd: d.totalOfferingAmountUsd,
          total_amount_remaining_usd: d.totalAmountRemainingUsd,
          has_amount_indefinite: d.hasAmountIndefinite,
          investors_named: d.investorsNamed,
          source_url: d.sourceUrl,
        })
        if (d.filedDate > latestDate && d.totalAmountSoldUsd != null) {
          latestDate = d.filedDate
          latestRaise = d.totalAmountSoldUsd
        }
      }
      perCo[co.id] = { filings: data.length, latestRaiseUsd: latestRaise }
    }
  }

  const fetchMs = Date.now() - startedAt

  if (rows.length === 0) {
    return NextResponse.json({
      ok: true,
      scanned: companies.length,
      inserted: 0,
      fetchMs,
    })
  }

  const upResp = await (sb.from('funding_rounds') as unknown as {
    upsert: (rows: FundingRoundInsert[], opts: { onConflict: string; ignoreDuplicates: boolean }) =>
      Promise<{ error: { message: string } | null }>
  }).upsert(rows, {
    onConflict: 'company_id,accession',
    ignoreDuplicates: false,  // update on re-run so amendments overwrite the prior amount
  })
  if (upResp.error) return NextResponse.json({ error: upResp.error.message }, { status: 500 })

  return NextResponse.json({
    ok: true,
    scanned: companies.length,
    rowsUpserted: rows.length,
    fetchMs,
    perCo,
  })
}

import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/service-role'
import { rotatingWindow } from '@/lib/cron-window'

import {
  fetchCompanyFilings,
  fetchForm4,
  form4PrimaryDocUrl,
} from '@/lib/edgar'

/**
 * Daily insider-transaction (Form 4) tracker.
 *
 * For each CIKed company:
 *   1) Fetch submissions.json (already cached on SEC side, cheap)
 *   2) Filter to form='4' or '4/A' AND filingDate within last 60 days
 *   3) For each filing, fetch primary_doc.xml and parse the
 *      nonDerivativeTransaction rows
 *   4) Upsert each transaction (dedup on accession + date + security + shares)
 *
 * Hobby plan 60s budget: capped at ~120 XML fetches per run (32 cos × 4 each
 * avg). Daily runs only see 1-2 new filings per active company.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const LOOKBACK_DAYS = 60
const MAX_XML_FETCHES_PER_RUN = 120
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

interface CompanyRow {
  id: string
  cik: string
}

interface InsiderRow {
  company_id: string
  accession: string
  filing_date: string
  transaction_date: string | null
  reporting_owner: string | null
  reporting_owner_role: string | null
  is_officer: boolean | null
  is_director: boolean | null
  is_ten_percent_owner: boolean | null
  security_title: string | null
  shares: number | null
  price_per_share: number | null
  value_usd: number | null
  transaction_code: string | null
  acquired_or_disposed: string | null
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

  const cosResp = await sb.from('companies').select('id, cik').not('cik', 'is', null)
  if (cosResp.error) return NextResponse.json({ error: cosResp.error.message }, { status: 500 })
  // Rotating daily window — 363 CIKs sequential with 120ms pacing blows the
  // 60s cap. Full coverage every ⌈N/120⌉ days (4 at current N); the 60-day
  // filing lookback means a 4-day visit cadence misses nothing.
  // MAX_XML_FETCHES_PER_RUN still caps the inner loop as a second line of
  // defense.
  const companies = rotatingWindow(
    ((cosResp.data ?? []) as CompanyRow[]).filter(c => c.cik),
    120,
  )

  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 86400_000).toISOString().slice(0, 10)
  const startedAt = Date.now()

  const rows: InsiderRow[] = []
  let xmlFetches = 0
  const perCo: Record<string, { form4s: number; transactions: number }> = {}

  outer: for (const co of companies) {
    perCo[co.id] = { form4s: 0, transactions: 0 }
    let subs
    try {
      subs = await fetchCompanyFilings(co.cik)
    } catch {
      continue
    }
    const recentForm4s = subs.filings.filter(f =>
      (f.form === '4' || f.form === '4/A') && f.filingDate >= cutoff,
    )
    for (const f of recentForm4s) {
      if (xmlFetches >= MAX_XML_FETCHES_PER_RUN) break outer
      const txns = await fetchForm4(co.cik, f.accessionNumber, f.primaryDocument)
      xmlFetches++
      perCo[co.id].form4s++
      for (const t of txns) {
        rows.push({
          company_id: co.id,
          accession: f.accessionNumber,
          filing_date: f.filingDate,
          transaction_date: t.transactionDate,
          reporting_owner: t.reportingOwner || null,
          reporting_owner_role: t.reportingOwnerRole,
          is_officer: t.isOfficer,
          is_director: t.isDirector,
          is_ten_percent_owner: t.isTenPercentOwner,
          security_title: t.securityTitle,
          shares: t.shares,
          price_per_share: t.pricePerShare,
          value_usd: t.valueUsd,
          transaction_code: t.transactionCode,
          acquired_or_disposed: t.acquiredOrDisposed,
          source_url: form4PrimaryDocUrl(co.cik, f.accessionNumber, f.primaryDocument),
        })
        perCo[co.id].transactions++
      }
      await sleep(120)
    }
  }

  const fetchMs = Date.now() - startedAt

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, scanned: companies.length, xmlFetches, inserted: 0, fetchMs })
  }

  const upResp = await (sb.from('insider_transactions') as unknown as {
    upsert: (rows: InsiderRow[], opts: { onConflict: string; ignoreDuplicates: boolean }) =>
      Promise<{ error: { message: string } | null }>
  }).upsert(rows, {
    onConflict: 'accession,transaction_date,security_title,shares',
    ignoreDuplicates: true,
  })
  if (upResp.error) return NextResponse.json({ error: upResp.error.message }, { status: 500 })

  return NextResponse.json({
    ok: true,
    scanned: companies.length,
    xmlFetches,
    candidates: rows.length,
    fetchMs,
    perCo,
  })
}

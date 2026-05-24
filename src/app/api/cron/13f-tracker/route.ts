import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

import {
  fetchCompanyFilings,
  findLatest13F,
  fetch13FHoldings,
  type ParsedHolding,
} from '@/lib/edgar'
import type { Database } from '@/types/db'

/**
 * Weekly 13F poller.
 *
 * For each investor where files_13f=true:
 *   1) Fetch their submissions
 *   2) Find the most recent 13F-HR filing
 *   3) Download + parse its INFORMATION TABLE xml (holdings)
 *   4) For each holding, try to match to a company in our DB:
 *        a. By CUSIP (companies.cusip)
 *        b. By fuzzy name match (issuer name CONTAINS or matches company name)
 *      When (b) matches and the company has no CUSIP yet, backfill it.
 *   5) Upsert into holdings on (investor_id, period, cusip)
 *
 * 13Fs only update quarterly (45 days after Q-end), so a weekly cadence
 * is plenty. Run on Sundays at 23:00 UTC to stagger from the 8-K cron.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

interface Investor13F {
  id: string
  name: string
  cik: string
}
interface CompanyMatch {
  id: string
  name: string
  cusip: string | null
}
interface FilerResult {
  investor: string
  period?: string
  fetched?: number
  matched?: number
  inserted?: number
  error?: string
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

  const sb = createClient<Database>(url, key, { auth: { persistSession: false } })

  // ----- fetch investors flagged as 13F filers -----
  const invResp = await sb.from('investors').select('id, name, cik').eq('files_13f', true).not('cik', 'is', null)
  if (invResp.error) return NextResponse.json({ error: invResp.error.message }, { status: 500 })
  const investors = (invResp.data ?? []) as Investor13F[]
  if (investors.length === 0) {
    return NextResponse.json({ ok: true, scanned: 0, note: 'no 13F-flagged investors' })
  }

  // ----- companies for CUSIP / name matching -----
  const coResp = await sb.from('companies').select('id, name, cusip')
  if (coResp.error) return NextResponse.json({ error: coResp.error.message }, { status: 500 })
  const companies = (coResp.data ?? []) as CompanyMatch[]
  const byCusip = new Map<string, CompanyMatch>()
  for (const c of companies) if (c.cusip) byCusip.set(c.cusip, c)
  // Build name-lookup map — uppercase, strip common corp suffixes for fuzzy matching.
  const normalize = (s: string) =>
    s.toUpperCase().replace(/[^\w\s]/g, ' ').replace(/\b(INC|CORP|CORPORATION|CO|LTD|HOLDINGS|GROUP|N\s*V|SA|AG|PLC)\b/g, '').trim().replace(/\s+/g, ' ')
  const byName = new Map<string, CompanyMatch>()
  for (const c of companies) byName.set(normalize(c.name), c)

  function matchHolding(h: ParsedHolding): CompanyMatch | null {
    return byCusip.get(h.cusip) ?? byName.get(normalize(h.nameOfIssuer)) ?? null
  }

  const results: FilerResult[] = []
  let totalInserted = 0
  const cusipBackfills: Array<{ id: string; cusip: string }> = []

  for (const inv of investors) {
    try {
      const subs = await fetchCompanyFilings(inv.cik)
      const latest = findLatest13F(subs.filings)
      if (!latest) {
        results.push({ investor: inv.id, error: 'no 13F-HR on record' })
        continue
      }
      const { period, holdings } = await fetch13FHoldings(inv.cik, latest)
      if (holdings.length === 0) {
        results.push({ investor: inv.id, period, fetched: 0, matched: 0, inserted: 0 })
        continue
      }

      // Aggregate duplicate CUSIPs — large filers (BlackRock, Coatue) split the
      // same security across multiple sub-accounts (insurance arm, holding co,
      // separately-managed funds). Each appears as its own row in the 13F.
      // Our unique index is (investor, period, cusip), so we must combine
      // them before upserting or Postgres throws "command cannot affect row
      // a second time".
      const byCusipInFiling = new Map<string, ParsedHolding>()
      for (const h of holdings) {
        const existing = byCusipInFiling.get(h.cusip)
        if (existing) {
          existing.shares = (existing.shares ?? 0) + (h.shares ?? 0)
          existing.valueUsd = (existing.valueUsd ?? 0) + (h.valueUsd ?? 0)
        } else {
          byCusipInFiling.set(h.cusip, { ...h })
        }
      }
      const aggregated = Array.from(byCusipInFiling.values())

      // Shape rows and detect CUSIP backfills along the way.
      const rows = aggregated.map((h) => {
        const co = matchHolding(h)
        if (co && !co.cusip) {
          cusipBackfills.push({ id: co.id, cusip: h.cusip })
          co.cusip = h.cusip
          byCusip.set(h.cusip, co)
        }
        return {
          investor_id: inv.id,
          company_id: co?.id ?? null,
          cusip: h.cusip,
          issuer_name: h.nameOfIssuer,
          title_of_class: h.titleOfClass,
          period,
          shares: h.shares,
          value_usd: h.valueUsd,
          accession: latest.accessionNumber,
        }
      })

      const matched = rows.filter(r => r.company_id !== null).length

      // Upsert with dedup on (investor_id, period, cusip)
      // The typed client narrows too aggressively for our compound upsert — cast inputs.
      const upResp = (await (sb.from('holdings') as unknown as {
        upsert: (rows: unknown[], opts: { onConflict: string }) =>
          Promise<{ data: unknown[] | null; error: { message: string } | null }>
      }).upsert(rows, { onConflict: 'investor_id,period,cusip' }))
      if (upResp.error) {
        results.push({ investor: inv.id, period, fetched: holdings.length, matched, error: upResp.error.message })
        continue
      }
      const inserted = upResp.data?.length ?? rows.length
      totalInserted += inserted
      results.push({ investor: inv.id, period, fetched: holdings.length, matched, inserted })
    } catch (err) {
      results.push({ investor: inv.id, error: err instanceof Error ? err.message : String(err) })
    }
  }

  // ----- backfill discovered CUSIPs -----
  let cusipUpdates = 0
  for (const u of cusipBackfills) {
    const r = await (sb.from('companies') as unknown as {
      update: (patch: { cusip: string }) => { eq: (col: string, val: string) => Promise<{ error: { message: string } | null }> }
    }).update({ cusip: u.cusip }).eq('id', u.id)
    if (!r.error) cusipUpdates++
  }

  return NextResponse.json({
    ok: true,
    scanned: investors.length,
    totalInserted,
    cusipBackfills: cusipUpdates,
    results,
  })
}

import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/service-role'
import { rotatingWindow } from '@/lib/cron-window'

import {
  fetchAllCompanyFilings,
  filingIndexUrl,
  headlineFor8K,
} from '@/lib/edgar'

/**
 * Daily 8-K poller.
 *
 * Flow:
 *   1) Auth: require Bearer CRON_SECRET (Vercel injects this on the schedule;
 *      we also accept it on manual curl invocations).
 *   2) Fetch every company with a CIK from Supabase.
 *   3) For each company, hit EDGAR's submissions endpoint (rate-limited
 *      sequential — see edgar.ts).
 *   4) Filter the returned filings to form=='8-K'.
 *   5) Upsert into signals (on accession_number conflict, do nothing).
 *   6) Link the new signals to the company in signal_companies.
 *
 * Why node runtime instead of edge:
 *   The Supabase JS client has occasional fetch/Stream incompat with the Vercel
 *   edge runtime. Node is fine for a once-a-day cron — cold-start latency
 *   doesn't matter when nothing's blocking on the response.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60 // Vercel Hobby plan max — sequential pass for ~30 CIKs at 150ms each ≈ 5s

interface SignalInsertResult {
  id: string
  accession_number: string | null
}

export async function GET(req: NextRequest) {
  // ----- auth -----
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    return NextResponse.json({ error: 'supabase env missing' }, { status: 500 })
  }
  const sb = supabaseServiceRole()

  // ----- fetch CIKed companies -----
  const companiesResp = await sb
    .from('companies')
    .select('id, name, cik')
    .not('cik', 'is', null)
  if (companiesResp.error) {
    return NextResponse.json({ error: companiesResp.error.message }, { status: 500 })
  }
  let companies = (companiesResp.data ?? []) as Array<{ id: string; name: string; cik: string }>
  if (companies.length === 0) {
    return NextResponse.json({ ok: true, scanned: 0, inserted: 0, note: 'no CIKed companies' })
  }
  // 363 CIKs × SEC pacing ≈ 2min — over the 60s cap. Walk a rotating daily
  // window instead; full coverage every ⌈N/120⌉ days (4 at current N). 8-Ks
  // stay visible on EDGAR far longer, so filings are delayed ≤ 3 days, never
  // missed.
  companies = rotatingWindow(companies, 120)

  // Lookup company by padded CIK for linking back after EDGAR fetch
  const cikToCompany = new Map<string, { id: string; name: string }>()
  for (const c of companies) {
    cikToCompany.set(c.cik, { id: c.id, name: c.name })
  }
  const ciks = Array.from(cikToCompany.keys())

  // ----- fetch filings -----
  const startedAt = Date.now()
  const submissions = await fetchAllCompanyFilings(ciks)
  const fetchMs = Date.now() - startedAt

  // ----- shape signals + collect company links -----
  type SignalRow = {
    date: string
    source: string
    headline: string
    url: string
    accession_number: string
    form_type: string
    retrieved_at: string
  }
  const signalsToInsert: SignalRow[] = []
  const signalToCompany = new Map<string, string>() // accession → company.id

  for (const sub of submissions) {
    const company = cikToCompany.get(sub.cik)
    if (!company) continue
    for (const f of sub.filings) {
      if (f.form !== '8-K') continue
      const date = f.reportDate || f.filingDate
      if (!date) continue
      const retrievedAt = new Date().toISOString()
      signalsToInsert.push({
        date,
        source: 'sec-edgar',
        headline: headlineFor8K(company.name, f.items),
        url: filingIndexUrl(sub.cik, f.accessionNumber),
        accession_number: f.accessionNumber,
        form_type: '8-K',
        retrieved_at: retrievedAt,
      })
      signalToCompany.set(f.accessionNumber, company.id)
    }
  }

  if (signalsToInsert.length === 0) {
    return NextResponse.json({
      ok: true,
      scanned: ciks.length,
      candidates: 0,
      inserted: 0,
      links: 0,
      fetchMs,
    })
  }

  // ----- upsert with dedup on accession_number -----
  // The generated Database type isn't narrow enough for chained upsert+select,
  // so we cast the input/output and trust the runtime shape.
  const sigResp = (await (sb.from('signals') as unknown as {
    upsert: (rows: SignalRow[], opts: { onConflict: string; ignoreDuplicates: boolean }) => {
      select: (cols: string) => Promise<{ data: SignalInsertResult[] | null; error: { message: string } | null }>
    }
  })
    .upsert(signalsToInsert, { onConflict: 'accession_number', ignoreDuplicates: true })
    .select('id, accession_number'))
  if (sigResp.error) return NextResponse.json({ error: sigResp.error.message }, { status: 500 })

  const inserted = sigResp.data
  const insertedCount = inserted?.length ?? 0

  // ----- link to companies -----
  let linkedCount = 0
  if (inserted && inserted.length > 0) {
    const links = inserted
      .map((row) => {
        const acc = row.accession_number
        if (!acc) return null
        const companyId = signalToCompany.get(acc)
        if (!companyId) return null
        return { signal_id: row.id, company_id: companyId }
      })
      .filter((x): x is { signal_id: string; company_id: string } => x !== null)
    if (links.length > 0) {
      const linkResp = await (sb.from('signal_companies') as unknown as {
        upsert: (rows: typeof links, opts: { onConflict: string; ignoreDuplicates: boolean; count: 'exact' }) =>
          Promise<{ error: { message: string } | null; count: number | null }>
      }).upsert(links, { onConflict: 'signal_id,company_id', ignoreDuplicates: true, count: 'exact' })
      if (linkResp.error) return NextResponse.json({ error: linkResp.error.message }, { status: 500 })
      linkedCount = linkResp.count ?? links.length
    }
  }

  return NextResponse.json({
    ok: true,
    scanned: ciks.length,
    candidates: signalsToInsert.length,
    inserted: insertedCount,
    links: linkedCount,
    fetchMs,
  })
}

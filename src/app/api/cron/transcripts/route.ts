import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/service-role'

import {
  fetchCompanyFilings,
  filterEarningsResults8Ks,
  fetchEarningsExhibitText,
  filingIndexUrl,
} from '@/lib/edgar'
import { extractTranscriptSignal, totalMentions } from '@/lib/transcripts'

/**
 * Daily earnings-transcript NLP scan.
 *
 * For each PUBLIC CIKed company:
 *   1) Pull submissions.json (cached on SEC side).
 *   2) Filter to 8-K (or 8-K/A) filings whose `items` field contains
 *      "2.02" — that's "Results of Operations" = earnings press release.
 *   3) Skip accessions already processed (idempotency via the unique
 *      index on (company_id, accession)).
 *   4) Fetch the Exhibit 99.1 press-release text (HTML), run it through
 *      extractTranscriptSignal() — a lexicon-based scorer that counts AI /
 *      GPU / capex / data-center / token mentions and pulls key phrases
 *      like "$11.5B in 2026 capex".
 *   5) Upsert one row per (company_id, accession) into transcript_signals.
 *
 * Why public-only filter: private cos don't file 8-K item 2.02 — they
 * report to investors privately. Skipping them keeps the SEC HTTP budget
 * focused on cos that actually produce earnings releases.
 *
 * Hobby plan 60s budget: parallel batches of 5 CIKs, each CIK averages
 * ≤ 4 earnings filings/year and most are already-processed → just an
 * index hit. The HTML fetches are ~50-300 KB each, well within budget.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Look back 1 year of filings = ~4 quarters of earnings 8-Ks per co.
// Anything older won't materially change the AI-compute capex picture and
// is wasted SEC bandwidth.
const LOOKBACK_DAYS = 365
const QUARTERS_PER_CO = 4   // cap per-co earnings 8-Ks pulled per run
const BATCH_SIZE = 5

interface CompanyRow {
  id: string
  cik: string
}

interface TranscriptSignalInsert {
  company_id: string
  filed_date: string
  accession: string
  ai_mentions: number
  gpu_mentions: number
  capex_mentions: number
  data_center_mentions: number
  token_mentions: number
  extracted_phrases: Array<{ phrase: string; context_snippet: string }>
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

  // Only PUBLIC cos with CIK. Private cos don't file earnings 8-Ks.
  const cosResp = await sb
    .from('companies')
    .select('id, cik')
    .eq('private', false)
    .not('cik', 'is', null)
  if (cosResp.error) return NextResponse.json({ error: cosResp.error.message }, { status: 500 })
  const companies = ((cosResp.data ?? []) as CompanyRow[]).filter((c) => c.cik)

  if (companies.length === 0) {
    return NextResponse.json({ ok: true, scanned: 0, inserted: 0, note: 'no public CIKed companies' })
  }

  // Existing accessions per company — skip re-processing. One round-trip
  // for the whole table is cheap (we expect ≤ ~200 rows steady-state).
  const existingResp = await sb
    .from('transcript_signals')
    .select('company_id, accession')
  if (existingResp.error) return NextResponse.json({ error: existingResp.error.message }, { status: 500 })
  const seen = new Set<string>()
  for (const r of (existingResp.data ?? []) as Array<{ company_id: string; accession: string }>) {
    seen.add(`${r.company_id}|${r.accession}`)
  }

  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 86400_000).toISOString().slice(0, 10)
  const startedAt = Date.now()
  const rows: TranscriptSignalInsert[] = []
  const perCo: Record<string, { scanned: number; processed: number; skipped: number }> = {}

  // Parallel batches of 5 CIKs. SEC limit is 10 req/sec; with ≤ 4 inner
  // exhibit fetches per CIK + the 150 ms inner sleep, burst stays safe.
  for (let i = 0; i < companies.length; i += BATCH_SIZE) {
    const batch = companies.slice(i, i + BATCH_SIZE)
    const results = await Promise.all(
      batch.map(async (co) => {
        try {
          const subs = await fetchCompanyFilings(co.cik)
          const earnings = filterEarningsResults8Ks(subs.filings, QUARTERS_PER_CO)
            .filter((f) => (f.reportDate || f.filingDate) >= cutoff)
          const stats = { scanned: earnings.length, processed: 0, skipped: 0 }
          const out: TranscriptSignalInsert[] = []
          for (const f of earnings) {
            const k = `${co.id}|${f.accessionNumber}`
            if (seen.has(k)) { stats.skipped++; continue }
            // Politeness pause between exhibit fetches (~6 req/sec inside batch).
            await sleep(150)
            const exhibit = await fetchEarningsExhibitText(co.cik, f.accessionNumber, f.primaryDocument)
            if (!exhibit) { stats.skipped++; continue }
            const signal = extractTranscriptSignal(exhibit.text)
            // Skip junk: if NONE of the 5 lexicons matched at all, the
            // release is probably non-tech (e.g. a financial-services
            // partner) — wasted DB row.
            if (totalMentions(signal) === 0) { stats.skipped++; continue }
            out.push({
              company_id: co.id,
              filed_date: f.reportDate || f.filingDate,
              accession: f.accessionNumber,
              ai_mentions: signal.ai_mentions,
              gpu_mentions: signal.gpu_mentions,
              capex_mentions: signal.capex_mentions,
              data_center_mentions: signal.data_center_mentions,
              token_mentions: signal.token_mentions,
              extracted_phrases: signal.extracted_phrases,
              source_url: filingIndexUrl(co.cik, f.accessionNumber),
            })
            stats.processed++
          }
          return { co, out, stats }
        } catch (err) {
          return {
            co,
            out: [] as TranscriptSignalInsert[],
            stats: { scanned: 0, processed: 0, skipped: 0, error: err instanceof Error ? err.message : String(err) },
          }
        }
      }),
    )
    for (const { co, out, stats } of results) {
      rows.push(...out)
      perCo[co.id] = stats
    }
  }

  const fetchMs = Date.now() - startedAt

  if (rows.length === 0) {
    return NextResponse.json({
      ok: true,
      scanned: companies.length,
      inserted: 0,
      fetchMs,
      perCo,
    })
  }

  // Upsert with onConflict=(company_id, accession). ignoreDuplicates=false
  // so re-runs with newer extractor logic overwrite the prior row's counts.
  const upResp = await (sb.from('transcript_signals') as unknown as {
    upsert: (rows: TranscriptSignalInsert[], opts: { onConflict: string; ignoreDuplicates: boolean }) =>
      Promise<{ error: { message: string } | null }>
  }).upsert(rows, {
    onConflict: 'company_id,accession',
    ignoreDuplicates: false,
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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

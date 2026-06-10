import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/service-role'
import { rotatingWindow } from '@/lib/cron-window'

import {
  fetchCompanyFilings,
  filterEarningsResults8Ks,
  fetchEarningsExhibitText,
  filingIndexUrl,
} from '@/lib/edgar'
import { extractTranscriptSignal, totalMentions } from '@/lib/transcripts'
import { findEarningsCallVideo, fetchTranscript, separateRemarksFromQna } from '@/lib/youtube-transcripts'

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
  name: string
  youtube_channel: string | null
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
  youtube_video_id: string | null
  qna_ai_mentions: number | null
  qna_gpu_mentions: number | null
  qna_capex_mentions: number | null
  qna_extracted_phrases: Array<{ phrase: string; context_snippet: string }> | null
  total_qna_words: number | null
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
    .select('id, cik, name, youtube_channel')
    .eq('private', false)
    .not('cik', 'is', null)
  if (cosResp.error) return NextResponse.json({ error: cosResp.error.message }, { status: 500 })
  // Rotating daily window — 363 CIKs at batch-of-5 with 150ms inner sleeps
  // (plus the YouTube enrichment path) blows the 60s cap. Full coverage every
  // ⌈N/120⌉ days (4 at current N); earnings 8-Ks only land ~quarterly per co,
  // so nothing is missed.
  const companies = rotatingWindow(
    ((cosResp.data ?? []) as CompanyRow[]).filter((c) => c.cik),
    120,
  )

  if (companies.length === 0) {
    return NextResponse.json({ ok: true, scanned: 0, inserted: 0, note: 'no public CIKed companies' })
  }

  // Existing accessions per company — skip re-processing. One round-trip
  // for the whole table is cheap (we expect ≤ ~200 rows steady-state).
  const existingResp = await sb
    .from('transcript_signals')
    .select('company_id, accession, youtube_video_id')
  if (existingResp.error) return NextResponse.json({ error: existingResp.error.message }, { status: 500 })
  const seen = new Set<string>()
  for (const r of (existingResp.data ?? []) as Array<{ company_id: string; accession: string; youtube_video_id: string | null }>) {
    if (r.youtube_video_id) {
      seen.add(`${r.company_id}|${r.accession}`)
    }
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

            // Extract YouTube transcript Q&A portion
            let youtubeVideoId: string | null = null
            let qnaAiMentions: number | null = null
            let qnaGpuMentions: number | null = null
            let qnaCapexMentions: number | null = null
            let qnaExtractedPhrases: Array<{ phrase: string; context_snippet: string }> | null = null
            let totalQnaWords: number | null = null

            const dateStr = f.reportDate || f.filingDate
            const { quarter, year } = getQuarterAndYear(dateStr)

            try {
              const videoId = await findEarningsCallVideo(co.name, quarter, year, co.youtube_channel)
              if (videoId) {
                youtubeVideoId = videoId
                await sleep(1000) // Politeness pause before fetching transcript
                const ytTranscript = await fetchTranscript(videoId)
                if (ytTranscript) {
                  const { qna } = separateRemarksFromQna(ytTranscript)
                  if (qna) {
                    const qnaSignal = extractTranscriptSignal(qna)
                    qnaAiMentions = qnaSignal.ai_mentions
                    qnaGpuMentions = qnaSignal.gpu_mentions
                    qnaCapexMentions = qnaSignal.capex_mentions
                    qnaExtractedPhrases = qnaSignal.extracted_phrases
                    totalQnaWords = qna.split(/\s+/).filter(Boolean).length
                  }
                }
              }
            } catch (ytErr) {
              // eslint-disable-next-line no-console
              console.warn(`[youtube-cron] Failed to process youtube transcript for ${co.id} accession ${f.accessionNumber}:`, ytErr)
            }

            out.push({
              company_id: co.id,
              filed_date: dateStr,
              accession: f.accessionNumber,
              ai_mentions: signal.ai_mentions,
              gpu_mentions: signal.gpu_mentions,
              capex_mentions: signal.capex_mentions,
              data_center_mentions: signal.data_center_mentions,
              token_mentions: signal.token_mentions,
              extracted_phrases: signal.extracted_phrases,
              source_url: filingIndexUrl(co.cik, f.accessionNumber),
              youtube_video_id: youtubeVideoId,
              qna_ai_mentions: qnaAiMentions,
              qna_gpu_mentions: qnaGpuMentions,
              qna_capex_mentions: qnaCapexMentions,
              qna_extracted_phrases: qnaExtractedPhrases,
              total_qna_words: totalQnaWords,
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

function getQuarterAndYear(dateStr: string): { quarter: number; year: number } {
  const date = new Date(dateStr)
  const month = date.getUTCMonth() + 1
  const year = date.getUTCFullYear()
  
  let quarter = 1
  let qYear = year
  
  if (month >= 1 && month <= 3) {
    quarter = 4
    qYear = year - 1
  } else if (month >= 4 && month <= 6) {
    quarter = 1
    qYear = year
  } else if (month >= 7 && month <= 9) {
    quarter = 2
    qYear = year
  } else {
    quarter = 3
    qYear = year
  }
  
  return { quarter, year: qYear }
}


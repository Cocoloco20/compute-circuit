/**
 * One-shot transcripts backfill.
 *
 * Same logic as /api/cron/transcripts but without the 60s Vercel cap and
 * without the YouTube enrichment side path (which slows the cron and isn't
 * needed for the press-release lexicon counts we want in the entity drawer).
 *
 * Walks every public CIKed company, finds 8-K item 2.02 filings in the last
 * year, fetches the press-release exhibit via the now-fixed
 * pickEarningsExhibit + fetchEarningsExhibitText, runs the lexicon scorer,
 * and upserts to transcript_signals.
 *
 * IDEMPOTENT — the unique index on (company_id, accession) makes re-runs
 * safe; upsert overwrites with the latest extractor logic.
 *
 * Run: npx tsx scripts/backfill-transcripts.ts
 * Optionally: --only nvda,msft,googl  to scope to specific ids
 */
import { createClient } from '@supabase/supabase-js'
import * as path from 'path'
import { config } from 'dotenv'
import {
  fetchCompanyFilings,
  filterEarningsResults8Ks,
  fetchEarningsExhibitText,
  filingIndexUrl,
} from '../src/lib/edgar'
import { extractTranscriptSignal, totalMentions } from '../src/lib/transcripts'

config({ path: path.join(__dirname, '..', '.env.local') })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('Missing env'); process.exit(1) }
const sb = createClient(url, key)

const args = process.argv.slice(2)
const ONLY = (() => {
  const i = args.indexOf('--only')
  return i >= 0 ? args[i + 1].split(',').map(s => s.trim()) : null
})()
const LOOKBACK_DAYS = 365
const QUARTERS_PER_CO = 4
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

interface CompanyRow { id: string; cik: string; name: string }
interface InsertRow {
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

async function main() {
  let q = sb.from('companies').select('id, cik, name').eq('private', false).not('cik', 'is', null)
  if (ONLY) q = q.in('id', ONLY)
  const { data, error } = await q
  if (error) { console.error(error); process.exit(1) }
  const cos = ((data ?? []) as CompanyRow[]).filter(c => c.cik)
  console.log(`Walking ${cos.length} public CIKed cos...`)

  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10)
  const rows: InsertRow[] = []
  const perCo: Record<string, { scanned: number; processed: number; skipped: number }> = {}

  for (const co of cos) {
    const stats = { scanned: 0, processed: 0, skipped: 0 }
    perCo[co.id] = stats
    try {
      const subs = await fetchCompanyFilings(co.cik)
      const earnings = filterEarningsResults8Ks(subs.filings, QUARTERS_PER_CO)
        .filter(f => (f.reportDate || f.filingDate) >= cutoff)
      stats.scanned = earnings.length
      for (const f of earnings) {
        await sleep(150) // SEC rate-limit politeness
        const exhibit = await fetchEarningsExhibitText(co.cik, f.accessionNumber, f.primaryDocument)
        if (!exhibit) { stats.skipped++; continue }
        const signal = extractTranscriptSignal(exhibit.text)
        if (totalMentions(signal) === 0) { stats.skipped++; continue }
        rows.push({
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
    } catch (e) {
      console.log(`  ⨯ ${co.id} (${co.name}): ${e instanceof Error ? e.message : e}`)
      continue
    }
    if (stats.scanned > 0) {
      console.log(`  ${co.id.padEnd(20)} scanned=${stats.scanned} processed=${stats.processed} skipped=${stats.skipped}`)
    }
  }

  if (rows.length === 0) { console.log('\nNothing to upsert.'); return }

  // Chunked upsert to keep the request body sane.
  const CHUNK = 100
  let upserted = 0
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK)
    const { error: upErr } = await (sb.from('transcript_signals') as unknown as {
      upsert: (rows: InsertRow[], opts: { onConflict: string; ignoreDuplicates: boolean }) =>
        Promise<{ error: { message: string } | null }>
    }).upsert(slice, { onConflict: 'company_id,accession', ignoreDuplicates: false })
    if (upErr) { console.error('upsert error:', upErr.message); process.exit(1) }
    upserted += slice.length
  }
  console.log(`\n✓ Upserted ${upserted} transcript_signals rows.`)
}

main().catch(e => { console.error(e); process.exit(1) })

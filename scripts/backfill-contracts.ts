/**
 * Backfill the contract ledger from SEC filings.
 *
 *   npx tsx scripts/backfill-contracts.ts [--since=2024-01-01] [--hosts=crwv,cifr]
 *                                         [--limit=20] [--concurrency=6] [--dry-run] [--rescan]
 *
 * --dry-run     lists candidates and prefilter hits, makes no model calls and
 *               writes nothing. Use it first to see what a run will cost.
 * --rescan      ignore the scan log (re-read filings already looked at).
 * --concurrency how many filings to extract at once (default 6).
 *
 * Runs locally: it needs ANTHROPIC_API_KEY (or an `ant auth login`
 * profile) and the Supabase service-role key from .env.local. The nightly
 * cron covers the last few days; this covers history.
 *
 * Two stages, deliberately not interleaved:
 *   1. Fetch (sequential) -- SEC EDGAR caps requests at 10/sec, and
 *      src/lib/edgar.ts already paces a single stream at ~6-7/sec, leaving
 *      little headroom. Running two fetch streams in parallel risks SEC
 *      throttling the whole site's EDGAR access, not just this job -- so
 *      this stage stays single-threaded, walking every candidate filing in
 *      order and queuing its text.
 *   2. Extract (concurrent) -- the actual model call is what took 10-40+
 *      seconds per filing and dominated wall-clock time, and OpenRouter has
 *      no equivalent per-IP ceiling that concurrency would trip. Once a
 *      filing's text is queued, several can be read by the model at once.
 */
import 'dotenv/config'
import { config } from 'dotenv'
config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import { fetchCompanyFilings } from '../src/lib/edgar'
import { PROVIDER_IDS } from '../src/lib/contracts/universe'
import { isCandidateFiling, fetchFilingDocuments, prefilter, type FilingDocument } from '../src/lib/contracts/filings'
import { extractContractsWithRetry, EXTRACTOR_MODEL, hasQuantityInfo } from '../src/lib/contracts/extract'
import { estimateCost, providerConfigured, resolveProvider } from '../src/lib/llm/structured'
import { shapeRow, upsertDisclosures, logScan, scannedAccessions, type Sb } from '../src/lib/contracts/ledger'

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a)
  return m ? [m[1], m[2] ?? 'true'] : [a, 'true']
}))
const SINCE = args.since ?? '2024-01-01'
const HOSTS = args.hosts ? args.hosts.split(',') : [...PROVIDER_IDS]
const LIMIT = args.limit ? parseInt(args.limit, 10) : Infinity
const CONCURRENCY = args.concurrency ? Math.max(1, parseInt(args.concurrency, 10)) : 6
const DRY = args['dry-run'] === 'true'
const RESCAN = args.rescan === 'true'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

interface QueuedExtraction {
  hostId: string
  cik: string
  filerName: string
  accession: string
  form: string
  filingDate: string
  items: string
  docs: FilingDocument[]
  text: string
  label: string
}

/** Runs `worker` over `items` with at most `limit` in flight at once. Order
 *  of completion is not preserved -- callers accumulate into shared state,
 *  not an ordered result array, since results are logged/written as they
 *  land rather than collected. */
async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  async function runner(): Promise<void> {
    while (next < items.length) {
      const item = items[next++]
      await worker(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner))
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing')
  const { provider, model } = resolveProvider()
  if (!DRY && !providerConfigured()) {
    throw new Error(`LLM provider "${provider}" has no key in the environment (OPENROUTER_API_KEY or ANTHROPIC_API_KEY)`)
  }
  console.log(`extractor: ${provider} / ${model}${DRY ? ' (dry run)' : ''} — concurrency=${DRY ? 'n/a' : CONCURRENCY}`)
  const sb: Sb = createClient(url, key, { auth: { persistSession: false } })

  const cos = await sb.from('companies').select('id, name, cik').in('id', HOSTS)
  if (cos.error) throw new Error(cos.error.message)
  const byId = new Map((cos.data as Array<{ id: string; name: string; cik: string | null }>).map(c => [c.id, c]))

  let totalCandidates = 0, totalHits = 0
  let processed = 0
  const queue: QueuedExtraction[] = []

  // ---------------------------------------------------------------- Stage 1

  for (const hostId of HOSTS) {
    const co = byId.get(hostId)
    if (!co?.cik) { console.log(`[${hostId}] no CIK on companies row — skipped`); continue }
    let subs
    try {
      subs = await fetchCompanyFilings(co.cik)
    } catch (err) {
      console.error(`[${hostId}] ${co.name}: fetchCompanyFilings failed — ${err instanceof Error ? err.message : String(err)}`)
      continue
    }
    const seen = RESCAN ? new Set<string>() : await scannedAccessions(sb, hostId)
    const candidates = subs.filings
      .filter(f => f.filingDate >= SINCE && isCandidateFiling(f) && !seen.has(f.accessionNumber))
      .sort((a, b) => a.filingDate.localeCompare(b.filingDate))
    totalCandidates += candidates.length
    console.log(`[${hostId}] ${co.name}: ${candidates.length} candidate filings since ${SINCE}${seen.size ? ` (${seen.size} already scanned)` : ''}`)

    for (const f of candidates) {
      if (processed >= LIMIT) break
      processed++
      let docs
      try {
        docs = await fetchFilingDocuments(co.cik, f.accessionNumber, f.primaryDocument)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`  ${f.filingDate} ${f.form.padEnd(5)} — fetchFilingDocuments failed — ${msg}`)
        if (!DRY) await logScan(sb, { accession: f.accessionNumber, filer_id: hostId, form: f.form, filing_date: f.filingDate, prefilter_hit: false, documents_read: 0, chars_read: 0, extracted: 0, extractor: null, error: msg.slice(0, 500), scanned_at: new Date().toISOString() })
        await sleep(300)
        continue
      }
      const text = docs.map(d => d.text).join('\n\n')
      const pf = prefilter(text)
      const label = `  ${f.filingDate} ${f.form.padEnd(5)} items=${f.items || '-'} docs=${docs.length} chars=${text.length}`
      if (!pf.hit) {
        console.log(`${label} — skip (vocab=${pf.vocabHits} qty=${pf.hasQuantity})`)
        if (!DRY) await logScan(sb, { accession: f.accessionNumber, filer_id: hostId, form: f.form, filing_date: f.filingDate, prefilter_hit: false, documents_read: docs.length, chars_read: text.length, extracted: 0, extractor: null, error: null, scanned_at: new Date().toISOString() })
        await sleep(200)
        continue
      }
      totalHits++
      if (DRY) { console.log(`${label} — HIT (vocab=${pf.vocabHits})`); await sleep(200); continue }
      queue.push({ hostId, cik: co.cik, filerName: co.name, accession: f.accessionNumber, form: f.form, filingDate: f.filingDate, items: f.items || '-', docs, text, label })
      await sleep(150) // still politeness-paced -- this loop is the only thing hitting EDGAR
    }
    if (processed >= LIMIT) break
  }

  if (DRY) {
    console.log(`\ncandidates=${totalCandidates} prefilter_hits=${totalHits} (dry run: no model calls made)`)
    return
  }

  console.log(`\nfetch stage done: ${queue.length} filing(s) queued for extraction at concurrency=${CONCURRENCY}\n`)

  // ---------------------------------------------------------------- Stage 2

  let totalRows = 0, totalIn = 0, totalOut = 0, totalCacheRead = 0

  await runPool(queue, CONCURRENCY, async (item) => {
    const { hostId, cik, filerName, accession, form, filingDate, docs, text, label } = item
    try {
      const res = await extractContractsWithRetry({ filerName, form, filingDate, documents: docs })
      totalIn += res.inputTokens; totalOut += res.outputTokens; totalCacheRead += res.cacheReadTokens
      const sourceUrl = docs[0]?.url ?? `https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/${accession.replace(/-/g, '')}/`
      const rows = res.output.contracts.filter(hasQuantityInfo).map(c => shapeRow(c, { filerId: hostId, form, accession, filingDate, sourceUrl, extractor: res.model }))
      const up = await upsertDisclosures(sb, rows)
      if (up.error) throw new Error(up.error)
      totalRows += rows.length
      console.log(`${label} — ${rows.length} contract(s)${res.retried ? ' [retried]' : ''}${res.failure ? ` [${res.failure}]` : ''} in=${res.inputTokens} cached=${res.cacheReadTokens} out=${res.outputTokens}${res.output.notes ? ` · ${res.output.notes.slice(0, 120)}` : ''}`)
      for (const r of rows) console.log(`      ${r.status.padEnd(10)} ${r.kind.padEnd(18)} ${(r.provider_name).slice(0, 24).padEnd(24)} -> ${(r.customer_name ?? '(undisclosed)').slice(0, 24).padEnd(24)} ${r.capacity_mw ?? '-'}MW $${r.total_value_usd ? (r.total_value_usd / 1e9).toFixed(2) + 'B' : '-'} ${r.term_months ?? '-'}mo conf=${r.confidence}`)
      await logScan(sb, { accession, filer_id: hostId, form, filing_date: filingDate, prefilter_hit: true, documents_read: docs.length, chars_read: text.length, extracted: rows.length, extractor: res.model, error: rows.length === 0 ? res.failure : null, scanned_at: new Date().toISOString() })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`${label} — ERROR ${msg}`)
      await logScan(sb, { accession, filer_id: hostId, form, filing_date: filingDate, prefilter_hit: true, documents_read: docs.length, chars_read: text.length, extracted: 0, extractor: EXTRACTOR_MODEL, error: msg.slice(0, 500), scanned_at: new Date().toISOString() })
    }
  })

  const cost = estimateCost(model, totalIn, totalOut, totalCacheRead)
  console.log(`\ncandidates=${totalCandidates} prefilter_hits=${totalHits} rows=${totalRows} tokens in=${totalIn} (cached ${totalCacheRead}) out=${totalOut}${cost != null ? ` ≈ $${cost.toFixed(2)}` : ''}`)
}

main().catch(e => { console.error(e); process.exit(1) })

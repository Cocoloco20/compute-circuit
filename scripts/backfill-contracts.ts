/**
 * Backfill the contract ledger from SEC filings.
 *
 *   npx tsx scripts/backfill-contracts.ts [--since=2024-01-01] [--hosts=crwv,cifr]
 *                                         [--limit=20] [--dry-run] [--rescan]
 *
 * --dry-run  lists candidates and prefilter hits, makes no model calls and
 *            writes nothing. Use it first to see what a run will cost.
 * --rescan   ignore the scan log (re-read filings already looked at).
 *
 * Runs locally: it needs ANTHROPIC_API_KEY (or an `ant auth login`
 * profile) and the Supabase service-role key from .env.local. The nightly
 * cron covers the last few days; this covers history.
 */
import 'dotenv/config'
import { config } from 'dotenv'
config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import { fetchCompanyFilings } from '../src/lib/edgar'
import { PROVIDER_IDS } from '../src/lib/contracts/universe'
import { isCandidateFiling, fetchFilingDocuments, prefilter } from '../src/lib/contracts/filings'
import { extractContracts, EXTRACTOR_MODEL } from '../src/lib/contracts/extract'
import { shapeRow, upsertDisclosures, logScan, scannedAccessions } from '../src/lib/contracts/ledger'

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a)
  return m ? [m[1], m[2] ?? 'true'] : [a, 'true']
}))
const SINCE = args.since ?? '2024-01-01'
const HOSTS = args.hosts ? args.hosts.split(',') : [...PROVIDER_IDS]
const LIMIT = args.limit ? parseInt(args.limit, 10) : Infinity
const DRY = args['dry-run'] === 'true'
const RESCAN = args.rescan === 'true'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing')
  if (!DRY && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.warn('No ANTHROPIC_API_KEY in env; relying on an `ant auth login` profile if one exists.')
  }
  const sb = createClient(url, key, { auth: { persistSession: false } })

  const cos = await sb.from('companies').select('id, name, cik').in('id', HOSTS)
  if (cos.error) throw new Error(cos.error.message)
  const byId = new Map((cos.data as Array<{ id: string; name: string; cik: string | null }>).map(c => [c.id, c]))

  let totalCandidates = 0, totalHits = 0, totalRows = 0, totalIn = 0, totalOut = 0, totalCacheRead = 0
  let processed = 0

  for (const hostId of HOSTS) {
    const co = byId.get(hostId)
    if (!co?.cik) { console.log(`[${hostId}] no CIK on companies row — skipped`); continue }
    const subs = await fetchCompanyFilings(co.cik)
    const seen = RESCAN ? new Set<string>() : await scannedAccessions(sb, hostId)
    const candidates = subs.filings
      .filter(f => f.filingDate >= SINCE && isCandidateFiling(f) && !seen.has(f.accessionNumber))
      .sort((a, b) => a.filingDate.localeCompare(b.filingDate))
    totalCandidates += candidates.length
    console.log(`[${hostId}] ${co.name}: ${candidates.length} candidate filings since ${SINCE}${seen.size ? ` (${seen.size} already scanned)` : ''}`)

    for (const f of candidates) {
      if (processed >= LIMIT) break
      processed++
      const docs = await fetchFilingDocuments(co.cik, f.accessionNumber, f.primaryDocument)
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

      try {
        const res = await extractContracts({ filerName: co.name, form: f.form, filingDate: f.filingDate, documents: docs })
        totalIn += res.inputTokens; totalOut += res.outputTokens; totalCacheRead += res.cacheReadTokens
        const sourceUrl = docs[0]?.url ?? `https://www.sec.gov/Archives/edgar/data/${parseInt(co.cik, 10)}/${f.accessionNumber.replace(/-/g, '')}/`
        const rows = res.output.contracts.map(c => shapeRow(c, { filerId: hostId, form: f.form, accession: f.accessionNumber, filingDate: f.filingDate, sourceUrl, extractor: res.model }))
        const up = await upsertDisclosures(sb, rows)
        if (up.error) throw new Error(up.error)
        totalRows += rows.length
        console.log(`${label} — ${rows.length} contract(s)${res.refused ? ' [REFUSED]' : ''} in=${res.inputTokens} cached=${res.cacheReadTokens} out=${res.outputTokens}${res.output.notes ? ` · ${res.output.notes.slice(0, 120)}` : ''}`)
        for (const r of rows) console.log(`      ${r.status.padEnd(10)} ${r.kind.padEnd(18)} ${(r.provider_name).slice(0, 24).padEnd(24)} -> ${(r.customer_name ?? '(undisclosed)').slice(0, 24).padEnd(24)} ${r.capacity_mw ?? '-'}MW $${r.total_value_usd ? (r.total_value_usd / 1e9).toFixed(2) + 'B' : '-'} ${r.term_months ?? '-'}mo conf=${r.confidence}`)
        await logScan(sb, { accession: f.accessionNumber, filer_id: hostId, form: f.form, filing_date: f.filingDate, prefilter_hit: true, documents_read: docs.length, chars_read: text.length, extracted: rows.length, extractor: res.model, error: null, scanned_at: new Date().toISOString() })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`${label} — ERROR ${msg}`)
        await logScan(sb, { accession: f.accessionNumber, filer_id: hostId, form: f.form, filing_date: f.filingDate, prefilter_hit: true, documents_read: docs.length, chars_read: text.length, extracted: 0, extractor: EXTRACTOR_MODEL, error: msg.slice(0, 500), scanned_at: new Date().toISOString() })
      }
      await sleep(300)
    }
    if (processed >= LIMIT) break
  }
  const cost = (totalIn - totalCacheRead) * 5 / 1e6 + totalCacheRead * 0.5 / 1e6 + totalOut * 25 / 1e6
  console.log(`\ncandidates=${totalCandidates} prefilter_hits=${totalHits} rows=${totalRows} tokens in=${totalIn} (cached ${totalCacheRead}) out=${totalOut} ≈ $${cost.toFixed(2)}${DRY ? ' (dry run: no model calls made)' : ''}`)
}

main().catch(e => { console.error(e); process.exit(1) })

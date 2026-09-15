/**
 * Extractor eval: run two models on the same filings, diff the rows.
 *
 *   npx tsx scripts/eval-extractor.ts [--n=25] [--filers=crwv,cifr]
 *
 * Filing selection: filings in contract_filing_scans where extracted > 0 —
 * i.e. the cheap default model already found at least one contract there,
 * so we know there is something to compare against, not just an empty
 * result on both sides. Sampled for filer diversity: round-robins across
 * filers before repeating one, so 25 slots don't all land on the filer
 * with the most candidate filings.
 *
 * Comparison model: DeepSeek V4 Pro, not Claude — no ANTHROPIC_API_KEY is
 * configured in this project, and Pro is materially more capable than
 * Flash while still routing through the same OPENROUTER_API_KEY (roughly
 * 16x Flash's input price, still fractions of a cent per filing). This
 * tests the real question — does the cheap model miss material terms a
 * stronger one would catch — without requiring a second provider.
 *
 * Output: docs/extractor-eval.md — one section per filing, each model's
 * rows side by side, and a per-field agreement summary at the top.
 */
import 'dotenv/config'
import { config } from 'dotenv'
config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import { fetchCompanyFilings } from '../src/lib/edgar'
import { fetchFilingDocuments } from '../src/lib/contracts/filings'
import { extractContracts, type ExtractedContract } from '../src/lib/contracts/extract'
import { estimateCost } from '../src/lib/llm/structured'

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a)
  return m ? [m[1], m[2] ?? 'true'] : [a, 'true']
}))
const N = args.n ? parseInt(args.n, 10) : 25
const FILERS = args.filers ? args.filers.split(',') : null

const CHEAP: { model: string } = { model: 'deepseek/deepseek-v4-flash-0731' }
const STRONG = { provider: 'openrouter' as const, model: 'deepseek/deepseek-v4-pro-0813' }

interface ScanRow { accession: string; filer_id: string; form: string; filing_date: string; extracted: number }

/** Round-robin sample across filers so 25 slots aren't dominated by whoever files the most 8-Ks. */
function sampleDiverse(rows: ScanRow[], n: number): ScanRow[] {
  const byFiler = new Map<string, ScanRow[]>()
  for (const r of rows) byFiler.set(r.filer_id, [...(byFiler.get(r.filer_id) ?? []), r])
  const filers = [...byFiler.keys()].sort()
  const out: ScanRow[] = []
  let round = 0
  while (out.length < n && filers.some(f => (byFiler.get(f)?.length ?? 0) > round)) {
    for (const f of filers) {
      const bucket = byFiler.get(f)!
      if (bucket[round]) out.push(bucket[round])
      if (out.length >= n) break
    }
    round++
  }
  return out
}

/** Field-by-field diff of one filing's two contract lists, matched by array position. */
interface FieldDiff { field: string; cheap: unknown; strong: unknown; agree: boolean }
const COMPARE_FIELDS: Array<keyof ExtractedContract> = [
  'kind', 'status', 'capacity_mw', 'gpu_count', 'term_months', 'total_value_usd',
  'annual_value_usd', 'customer_name',
]

function diffContracts(cheap: ExtractedContract[], strong: ExtractedContract[]): { rows: FieldDiff[][]; countsMatch: boolean } {
  const n = Math.max(cheap.length, strong.length)
  const rows: FieldDiff[][] = []
  for (let i = 0; i < n; i++) {
    const c = cheap[i], s = strong[i]
    rows.push(COMPARE_FIELDS.map(f => {
      const cv = c?.[f], sv = s?.[f]
      const agree = typeof cv === 'number' && typeof sv === 'number'
        ? Math.abs(cv - sv) < Math.max(1, Math.abs(sv) * 0.02) // 2% tolerance for numbers
        : cv === sv
      return { field: f, cheap: cv, strong: sv, agree }
    }))
  }
  return { rows, countsMatch: cheap.length === strong.length }
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing')
  const sb = createClient(url, key, { auth: { persistSession: false } })

  let q = sb.from('contract_filing_scans').select('accession, filer_id, form, filing_date, extracted').gt('extracted', 0)
  if (FILERS) q = q.in('filer_id', FILERS)
  const scans = await q
  if (scans.error) throw new Error(scans.error.message)
  const candidates = (scans.data ?? []) as ScanRow[]
  if (candidates.length === 0) throw new Error('no filings with extracted > 0 yet — run the backfill first')

  const sample = sampleDiverse(candidates, N)
  console.log(`${candidates.length} extracted filings on file across ${new Set(candidates.map(c => c.filer_id)).size} filer(s); evaluating ${sample.length}`)
  if (sample.length < N) console.log(`note: fewer than ${N} available — this is a partial eval; rerun after the full backfill for the target sample size`)

  const cikCache = new Map<string, string>()
  const cos = await sb.from('companies').select('id, name, cik').in('id', [...new Set(sample.map(s => s.filer_id))])
  for (const c of (cos.data ?? []) as Array<{ id: string; name: string; cik: string | null }>) {
    if (c.cik) cikCache.set(c.id, c.cik)
  }

  const sections: string[] = []
  let fieldAgree = 0, fieldTotal = 0, countMismatches = 0
  let cheapIn = 0, cheapOut = 0, strongIn = 0, strongOut = 0

  for (const row of sample) {
    const cik = cikCache.get(row.filer_id)
    if (!cik) { console.log(`skip ${row.filer_id}/${row.accession}: no CIK cached`); continue }
    const subs = await fetchCompanyFilings(cik)
    const f = subs.filings.find(x => x.accessionNumber === row.accession)
    if (!f) { console.log(`skip ${row.filer_id}/${row.accession}: filing not found in current submissions`); continue }

    const docs = await fetchFilingDocuments(cik, f.accessionNumber, f.primaryDocument)
    const ctx = { filerName: row.filer_id, form: f.form, filingDate: f.filingDate, documents: docs }

    const [cheap, strong] = await Promise.all([
      extractContracts(ctx, { provider: 'openrouter', model: CHEAP.model }),
      extractContracts(ctx, STRONG),
    ])
    cheapIn += cheap.inputTokens; cheapOut += cheap.outputTokens
    strongIn += strong.inputTokens; strongOut += strong.outputTokens

    const { rows: diffRows, countsMatch } = diffContracts(cheap.output.contracts, strong.output.contracts)
    if (!countsMatch) countMismatches++
    for (const dr of diffRows) for (const fd of dr) { fieldTotal++; if (fd.agree) fieldAgree++ }

    console.log(`${row.filer_id} ${row.filing_date} ${row.accession} — cheap:${cheap.output.contracts.length} strong:${strong.output.contracts.length} rows${countsMatch ? '' : ' [COUNT MISMATCH]'}`)

    sections.push([
      `### ${row.filer_id} — ${row.filing_date} — ${row.form} — \`${row.accession}\``,
      `[Filing index](https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/${row.accession.replace(/-/g, '')}/)`,
      '',
      `Flash found ${cheap.output.contracts.length} contract(s); Pro found ${strong.output.contracts.length}.${countsMatch ? '' : ' **Count mismatch.**'}`,
      '',
      '| field | Flash (cheap) | Pro (strong) | agree |',
      '|---|---|---|---|',
      ...diffRows.flat().map(fd => `| ${fd.field} | ${fmt(fd.cheap)} | ${fmt(fd.strong)} | ${fd.agree ? '✓' : '✗'} |`),
      '',
    ].join('\n'))

    await new Promise(r => setTimeout(r, 300))
  }

  const pct = fieldTotal ? ((fieldAgree / fieldTotal) * 100).toFixed(1) : 'n/a'
  const cheapCost = estimateCost(CHEAP.model, cheapIn, cheapOut, 0)
  const strongCost = estimateCost(STRONG.model, strongIn, strongOut, 0)
  const header = [
    '# Extractor eval: DeepSeek V4 Flash vs. DeepSeek V4 Pro',
    '',
    `Generated ${new Date().toISOString().slice(0, 10)}. ${sample.length} filing(s) evaluated` +
      (sample.length < N ? ` (target ${N}; fewer were available — rerun after the full backfill).` : '.'),
    '',
    `Field agreement: **${pct}%** (${fieldAgree}/${fieldTotal} compared fields, 2% tolerance on numbers).`,
    `Contract-count mismatches: ${countMismatches}/${sample.length} filing(s).`,
    `Cost: Flash ~$${cheapCost?.toFixed(4) ?? '?'}, Pro ~$${strongCost?.toFixed(4) ?? '?'} for this run.`,
    '',
    'Read every ✗ row below before trusting the percentage — a extraction wrong on `total_value_usd` ' +
      'matters more than one wrong on `escalator_pct`. If Flash is missing or misstating fields that ' +
      'change what a row means, switch `LLM_MODEL` in `.env.example` / the Offtake cloud environment ' +
      'to the Pro id and accept the higher per-filing cost.',
    '',
    '---',
    '',
  ].join('\n')

  const fs = await import('node:fs/promises')
  await fs.mkdir('docs', { recursive: true })
  await fs.writeFile('docs/extractor-eval.md', header + sections.join('\n'))
  console.log(`\nfield agreement ${pct}% (${fieldAgree}/${fieldTotal}); count mismatches ${countMismatches}/${sample.length}`)
  console.log(`cost: flash $${cheapCost?.toFixed(4)} pro $${strongCost?.toFixed(4)}`)
  console.log('wrote docs/extractor-eval.md')
}

function fmt(v: unknown): string {
  if (v == null) return '—'
  return String(v).replace(/\|/g, '\\|').slice(0, 60)
}

main().catch(e => { console.error(e); process.exit(1) })

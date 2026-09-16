import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/service-role'
import { startBudget } from '@/lib/cron-budget'
import { fetchCompanyFilings } from '@/lib/edgar'
import { PROVIDER_IDS } from '@/lib/contracts/universe'
import { isCandidateFiling, fetchFilingDocuments, prefilter } from '@/lib/contracts/filings'
import { extractContractsWithRetry, EXTRACTOR_MODEL, hasQuantityInfo, looksLikeCryptoMining } from '@/lib/contracts/extract'
import { shapeRow, upsertDisclosures, logScan, scannedAccessions, type DisclosureRow } from '@/lib/contracts/ledger'
import { providerConfigured, resolveProvider } from '@/lib/llm/structured'
import { postContractAlert } from '@/lib/contracts/alerts'

/**
 * Nightly incremental scan of the contract-ledger universe.
 *
 * Looks back LOOKBACK_DAYS over every provider's filings, skips anything
 * the scan log already holds, and extracts from the rest under a wall-clock
 * budget. History is the backfill script's job (scripts/backfill-contracts.ts);
 * this route exists so a contract disclosed at 4pm is in the ledger by
 * 10pm without anyone running anything.
 *
 * Needs an LLM key in the deployment environment (OPENROUTER_API_KEY by
 * default, see src/lib/llm/structured.ts). Without one the route reports the
 * gap loudly instead of silently scanning nothing.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const LOOKBACK_DAYS = 10
const FETCH_BUDGET_MS = 40_000
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (!providerConfigured()) {
    const { provider } = resolveProvider()
    return NextResponse.json({ error: `LLM provider "${provider}" has no key configured (OPENROUTER_API_KEY or ANTHROPIC_API_KEY) — contract extraction cannot run` }, { status: 500 })
  }
  const sb = supabaseServiceRole()
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10)

  const cos = await sb.from('companies').select('id, name, cik').in('id', [...PROVIDER_IDS])
  if (cos.error) return NextResponse.json({ error: cos.error.message }, { status: 500 })
  const byId = new Map((cos.data as unknown as Array<{ id: string; name: string; cik: string | null }>).map(c => [c.id, c]))

  // Rotate the start point daily so a budget stop does not starve the same
  // tail of providers every night.
  const start = Math.floor(Date.now() / 86_400_000) % PROVIDER_IDS.length
  const ordered = [...PROVIDER_IDS.slice(start), ...PROVIDER_IDS.slice(0, start)]

  const budget = startBudget(FETCH_BUDGET_MS)
  let providersScanned = 0, candidates = 0, hits = 0, rows = 0, errors = 0
  const newRows: DisclosureRow[] = []

  for (const hostId of ordered) {
    if (budget.expired()) break
    const co = byId.get(hostId)
    if (!co?.cik) continue
    let subs
    try { subs = await fetchCompanyFilings(co.cik) } catch { errors++; continue }
    providersScanned++
    const seen = await scannedAccessions(sb, hostId)
    const cands = subs.filings.filter(f => f.filingDate >= since && isCandidateFiling(f) && !seen.has(f.accessionNumber))
    candidates += cands.length
    for (const f of cands) {
      if (budget.expired()) break
      const docs = await fetchFilingDocuments(co.cik, f.accessionNumber, f.primaryDocument)
      const text = docs.map(d => d.text).join('\n\n')
      const pf = prefilter(text)
      const base = { accession: f.accessionNumber, filer_id: hostId, form: f.form, filing_date: f.filingDate, documents_read: docs.length, chars_read: text.length, scanned_at: new Date().toISOString() }
      if (!pf.hit) {
        await logScan(sb, { ...base, prefilter_hit: false, extracted: 0, extractor: null, error: null })
        continue
      }
      hits++
      // An extraction can take 20-40s on a long exhibit; do not start one
      // the budget cannot absorb.
      if (budget.remaining() < 25_000) break
      try {
        const res = await extractContractsWithRetry({ filerName: co.name, form: f.form, filingDate: f.filingDate, documents: docs })
        const sourceUrl = docs[0]?.url ?? `https://www.sec.gov/Archives/edgar/data/${parseInt(co.cik, 10)}/${f.accessionNumber.replace(/-/g, '')}/`
        const shaped = res.output.contracts.filter(c => hasQuantityInfo(c) && !looksLikeCryptoMining(c)).map(c => shapeRow(c, { filerId: hostId, form: f.form, accession: f.accessionNumber, filingDate: f.filingDate, sourceUrl, extractor: res.model }))
        const up = await upsertDisclosures(sb, shaped)
        if (up.error) throw new Error(up.error)
        rows += shaped.length
        newRows.push(...shaped)
        await logScan(sb, { ...base, prefilter_hit: true, extracted: shaped.length, extractor: res.model, error: shaped.length === 0 ? res.failure : null })
      } catch (err) {
        errors++
        await logScan(sb, { ...base, prefilter_hit: true, extracted: 0, extractor: EXTRACTOR_MODEL, error: (err instanceof Error ? err.message : String(err)).slice(0, 500) })
      }
      await sleep(200)
    }
    await sleep(150)
  }

  await postContractAlert(newRows)

  return NextResponse.json({
    ok: errors === 0,
    since, providersScanned, planned: PROVIDER_IDS.length, candidates, prefilterHits: hits, rows, errors,
    budgetExhausted: budget.expired(), ms: budget.elapsed(),
  })
}

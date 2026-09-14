/**
 * Candidate selection and document fetching for the contract ledger.
 *
 * A host files 30-60 8-Ks over two years; a handful disclose contracts.
 * Two cheap filters run before any model call:
 *   1. Item filter — 8-K items that carry agreements or press releases
 *      (1.01 material agreement, 1.02 termination, 2.01 acquisition, 2.03
 *      obligation, 7.01 Reg FD, 8.01 other events). 6-Ks (foreign filers:
 *      Nebius, IREN, Bitfarms, Bitdeer, HIVE) have no items, so all pass.
 *   2. Text prefilter — the documents must mention capacity or hosting
 *      vocabulary AND a quantity (MW, GW, GPU count or a dollar figure).
 *      A quarterly earnings 8-K mentions "data center" without either.
 */

import { stripHtml } from '@/lib/transcripts'
import { upstreamSignal } from '@/lib/cron-budget'
import type { EdgarFiling } from '@/lib/edgar'

const UA = 'compute-circuit contract-ledger (research tool) luigui.h2002@gmail.com'

export const CANDIDATE_8K_ITEMS = new Set(['1.01', '1.02', '2.01', '2.03', '7.01', '8.01'])
export const CANDIDATE_FORMS = new Set(['8-K', '8-K/A', '6-K', '6-K/A'])

export function isCandidateFiling(f: EdgarFiling): boolean {
  if (!CANDIDATE_FORMS.has(f.form)) return false
  if (f.form.startsWith('6-K')) return true
  const items = f.items.split(',').map(s => s.trim()).filter(Boolean)
  return items.some(i => CANDIDATE_8K_ITEMS.has(i))
}

export interface FilingDocument {
  name: string
  url: string
  text: string
}

const MAX_DOCS = 4
const MAX_DOC_BYTES = 1_500_000
/** Per-filing text ceiling handed to the extractor (~60k tokens). */
export const MAX_TEXT_CHARS = 240_000

/**
 * Fetch the readable documents of one filing: the primary document plus
 * exhibits 99.x (press releases) and 10.x (material contracts), in that
 * order of usefulness. XBRL viewer files and the index are skipped.
 */
export async function fetchFilingDocuments(cik: string, accession: string, primaryDocument: string): Promise<FilingDocument[]> {
  const cikInt = parseInt(cik, 10)
  const acc = accession.replace(/-/g, '')
  const base = `https://www.sec.gov/Archives/edgar/data/${cikInt}/${acc}/`
  let names: string[] = []
  try {
    const r = await fetch(`${base}index.json`, { signal: upstreamSignal(10_000), headers: { 'User-Agent': UA, Accept: 'application/json' } })
    if (r.ok) {
      const data = (await r.json()) as { directory?: { item?: Array<{ name: string; size?: string }> } }
      names = (data.directory?.item ?? []).map(i => i.name)
    }
  } catch { /* fall through to primary only */ }

  const primary = primaryDocument.split('/').pop() ?? primaryDocument
  const readable = names.filter(n => /\.(htm|html|txt)$/i.test(n) && !/^r\d+\.htm$/i.test(n) && !/index/i.test(n) && !n.startsWith('0001'))
  const score = (n: string): number => {
    const l = n.toLowerCase()
    if (l === primary.toLowerCase()) return 0
    if (/ex(?:hibit)?[\s_.-]*99/i.test(l) || /press|release|\bpr\b/i.test(l)) return 1
    if (/ex(?:hibit)?[\s_.-]*10/i.test(l)) return 2
    return 9
  }
  const ordered = [primary, ...readable.filter(n => n.toLowerCase() !== primary.toLowerCase())]
    .filter((n, i, a) => n && a.indexOf(n) === i)
    .sort((a, b) => score(a) - score(b))
    .filter(n => score(n) < 9)
    .slice(0, MAX_DOCS)

  const out: FilingDocument[] = []
  let budget = MAX_TEXT_CHARS
  for (const name of ordered) {
    if (budget <= 0) break
    const url = base + name
    try {
      const r = await fetch(url, { signal: upstreamSignal(15_000), headers: { 'User-Agent': UA, Accept: 'text/html,text/plain' } })
      if (!r.ok) continue
      const len = r.headers.get('content-length')
      if (len && Number(len) > MAX_DOC_BYTES) continue
      const raw = await r.text()
      const text = stripHtml(raw).slice(0, budget)
      budget -= text.length
      if (text.trim().length > 200) out.push({ name, url, text })
    } catch { /* skip this document */ }
    await new Promise(r => setTimeout(r, 150))
  }
  return out
}

const VOCAB = /\b(megawatts?|MW|gigawatts?|GW|GPUs?|colocation|co-location|hosting|lease|take-or-pay|capacity|data\s?cent(?:er|re)s?|power purchase|PPA|HPC|accelerators?|compute|cloud|master services agreement|order form|hyperscaler|tenant|campus)\b/gi
// No leading \b before "$": a word boundary never sits between a space and
// a dollar sign, which silently disabled the money branch on the first cut.
const QUANTITY = /(?:^|[^\w$])(\d[\d,.]*\s?(?:MW|GW|megawatts?|gigawatts?)\b|\$\s?\d[\d,.]*\s?(?:million|billion|bn|mm|m|b)\b|\d[\d,]{2,}\s+(?:GPUs?|accelerators?)\b)/i

export interface PrefilterResult {
  hit: boolean
  vocabHits: number
  hasQuantity: boolean
}

export function prefilter(text: string): PrefilterResult {
  const distinct = new Set<string>()
  for (const m of text.matchAll(VOCAB)) distinct.add(m[1].toLowerCase())
  const hasQuantity = QUANTITY.test(text)
  return { hit: distinct.size >= 2 && hasQuantity, vocabHits: distinct.size, hasQuantity }
}

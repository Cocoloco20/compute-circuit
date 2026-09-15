/**
 * Human review of ledger rows: deterministic sampling and a compact card
 * per row that puts the extracted numbers next to the excerpt they came
 * from, so a reviewer can confirm or reject a row in seconds.
 *
 * Pure module: no DB I/O. `scripts/review-contracts.ts` reads and writes.
 */

import type { DisclosureRow } from './ledger'

export type ReviewableRow = DisclosureRow & { id: string }

/** Small, seeded PRNG (mulberry32) so a sample can be re-run identically. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Fisher–Yates partial shuffle: `n` rows, uniformly, deterministic per seed. */
export function sampleRows<T>(rows: readonly T[], n: number, seed = 1): T[] {
  const a = rows.slice()
  const rnd = seededRandom(seed)
  const k = Math.min(n, a.length)
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rnd() * (a.length - i))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a.slice(0, k)
}

const money = (v: number | null): string => {
  if (v == null) return '—'
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  return `$${v.toLocaleString('en-US')}`
}
const num = (v: number | null, unit = ''): string => (v == null ? '—' : `${v.toLocaleString('en-US')}${unit}`)

/** Wrap text at `width` columns, indenting continuation lines. */
export function wrap(text: string, width = 96, indent = '    '): string {
  const words = text.replace(/\s+/g, ' ').trim().split(' ')
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    if (cur && cur.length + 1 + w.length > width) { lines.push(cur); cur = w }
    else cur = cur ? `${cur} ${w}` : w
  }
  if (cur) lines.push(cur)
  return lines.map(l => indent + l).join('\n')
}

/**
 * One row as a review card. Every number the extractor produced is on the
 * "fields" line; the excerpt is right under it; the source URL is last so
 * a reviewer can open it when the excerpt alone is not enough.
 */
export function formatReviewCard(r: ReviewableRow, index: number): string {
  const head = `#${index}  ${r.id.slice(0, 8)}  ${r.filing_date}  ${r.source_form}  filer=${r.filer_id ?? '?'}  status=${r.review_status}`
  const parties = `    ${r.provider_name}  →  ${r.customer_name ?? '(undisclosed)'}${r.customer_disclosed ? '' : ' [generic]'}${r.guarantor_name ? `   guarantor: ${r.guarantor_name}` : ''}`
  const what = `    ${r.kind} · ${r.status}${r.site ? ` · ${r.site}` : ''}`
  const fields = [
    `MW ${num(r.capacity_mw)}`,
    `GPUs ${num(r.gpu_count)}${r.gpu_model ? ` (${r.gpu_model})` : ''}`,
    `term ${num(r.term_months, 'mo')}`,
    `start ${r.start_date ?? '—'}`,
    `end ${r.end_date ?? '—'}`,
    `total ${money(r.total_value_usd)}`,
    `annual ${money(r.annual_value_usd)}`,
    `prepay ${money(r.prepayment_usd)}`,
    `ext ${r.has_extension_option == null ? '—' : r.has_extension_option ? 'yes' : 'no'}`,
    `esc ${r.escalator_pct == null ? '—' : `${r.escalator_pct}%`}`,
    `conf ${r.confidence ?? '—'}`,
  ].join(' | ')
  const excerpt = r.excerpt ? wrap(`“${r.excerpt}”`) : '    (no excerpt)'
  const src = `    ${r.source_url ?? r.source_note ?? '(no source)'}`
  return [head, parties, what, `    ${fields}`, excerpt, src].join('\n')
}

export type Verdict = 'verified' | 'rejected' | 'auto'

/**
 * Parse `--verified=a1b2c3d4,…` / `--rejected=…` style id lists. Ids may be
 * prefixes; the caller resolves them against the rows it loaded.
 */
export function parseIdList(v: string | undefined): string[] {
  return (v ?? '').split(',').map(s => s.trim()).filter(Boolean)
}

/** Resolve an id or unique prefix against known ids. Throws on ambiguity. */
export function resolveId(prefix: string, ids: readonly string[]): string {
  const hits = ids.filter(id => id === prefix || id.startsWith(prefix))
  if (hits.length === 1) return hits[0]
  if (hits.length === 0) throw new Error(`no row matches id "${prefix}"`)
  throw new Error(`id "${prefix}" is ambiguous (${hits.length} rows); give more characters`)
}

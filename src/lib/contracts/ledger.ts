/**
 * Persistence for the contract ledger: row shaping, dedupe keys, upserts,
 * and the per-filing scan log. Service-role client only.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ExtractedContract } from './extract'
import { resolvePartyId } from './universe'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Sb = SupabaseClient<any>

export interface DisclosureRow {
  provider_id: string | null
  provider_name: string
  customer_id: string | null
  customer_name: string | null
  customer_disclosed: boolean
  guarantor_id: string | null
  guarantor_name: string | null
  kind: string
  site: string | null
  capacity_mw: number | null
  gpu_count: number | null
  gpu_model: string | null
  term_months: number | null
  start_date: string | null
  end_date: string | null
  total_value_usd: number | null
  annual_value_usd: number | null
  prepayment_usd: number | null
  has_extension_option: boolean | null
  extension_note: string | null
  escalator_pct: number | null
  status: string
  source_form: string
  source_accession: string | null
  source_url: string | null
  source_note: string | null
  filing_date: string
  filer_id: string | null
  excerpt: string | null
  extractor: string
  confidence: number | null
  review_status: 'auto' | 'verified' | 'rejected'
  dedupe_key: string
  updated_at: string
}

export interface ScanRow {
  accession: string
  filer_id: string | null
  form: string
  filing_date: string
  prefilter_hit: boolean
  documents_read: number
  chars_read: number
  extracted: number
  extractor: string | null
  error: string | null
  scanned_at: string
}

export function slug(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
}

/** Partial dates ("2026-03", "2026") become the first day of that period. */
export function normalizeDate(s: string | null): string | null {
  if (!s) return null
  const t = s.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t
  if (/^\d{4}-\d{2}$/.test(t)) return `${t}-01`
  if (/^\d{4}$/.test(t)) return `${t}-01-01`
  return null
}

export function buildDedupeKey(filerId: string, accession: string, c: ExtractedContract): string {
  return [filerId, accession, slug(c.customer_name) || 'undisclosed', c.kind, slug(c.site) || 'nosite'].join('|')
}

export interface ShapeInput {
  filerId: string
  form: string
  accession: string
  filingDate: string
  sourceUrl: string
  extractor: string
}

export function shapeRow(c: ExtractedContract, s: ShapeInput): DisclosureRow {
  return {
    provider_id: resolvePartyId(c.provider_name),
    provider_name: c.provider_name,
    customer_id: c.customer_name != null ? resolvePartyId(c.customer_name) : null,
    customer_name: c.customer_name,
    // Derived, not asked of the model: the eval (docs/extractor-eval.md)
    // found the extractor's own customer_disclosed judgment disagreed with
    // itself run to run, in both directions, even on rows where
    // customer_name was filled in correctly. customer_name is null exactly
    // when the customer isn't named (see its schema description), so it's
    // the reliable signal.
    customer_disclosed: c.customer_name != null,
    guarantor_id: resolvePartyId(c.guarantor_name),
    guarantor_name: c.guarantor_name,
    kind: c.kind,
    site: c.site,
    capacity_mw: c.capacity_mw,
    gpu_count: c.gpu_count,
    gpu_model: c.gpu_model,
    term_months: c.term_months,
    start_date: normalizeDate(c.start_date),
    end_date: normalizeDate(c.end_date),
    total_value_usd: c.total_value_usd,
    annual_value_usd: c.annual_value_usd,
    prepayment_usd: c.prepayment_usd,
    has_extension_option: c.has_extension_option,
    extension_note: c.extension_note,
    escalator_pct: c.escalator_pct,
    status: c.status,
    source_form: s.form,
    source_accession: s.accession,
    source_url: s.sourceUrl,
    source_note: null,
    filing_date: s.filingDate,
    filer_id: s.filerId,
    excerpt: c.excerpt.slice(0, 800),
    extractor: s.extractor,
    confidence: c.confidence,
    review_status: 'auto',
    dedupe_key: buildDedupeKey(s.filerId, s.accession, c),
    updated_at: new Date().toISOString(),
  }
}

/** Two contracts from the same filing can land on the same dedupe_key (same
 *  customer, kind and site) even when they're genuinely distinct -- e.g. an
 *  initial agreement and its same-day amendment. A single upsert statement
 *  can't update one conflict target twice ("ON CONFLICT DO UPDATE command
 *  cannot affect row a second time"), which previously failed the whole
 *  filing and lost every row in it, not just the colliding one. Collapsing
 *  same-key rows to the last occurrence before the upsert trades losing one
 *  duplicate-keyed row for keeping the rest. */
export function dedupeByKey(rows: DisclosureRow[]): DisclosureRow[] {
  const byKey = new Map<string, DisclosureRow>()
  for (const row of rows) byKey.set(row.dedupe_key, row)
  return [...byKey.values()]
}

export async function upsertDisclosures(sb: Sb, rows: DisclosureRow[]): Promise<{ error: string | null }> {
  if (!rows.length) return { error: null }
  const r = await sb.from('contract_disclosures').upsert(dedupeByKey(rows), { onConflict: 'dedupe_key' })
  return { error: r.error?.message ?? null }
}

export async function logScan(sb: Sb, row: ScanRow): Promise<void> {
  await sb.from('contract_filing_scans').upsert(row, { onConflict: 'accession' })
}

/** Accessions already scanned without error, for one filer. A filing whose
 *  extraction errored (bad model id, timeout) is retried on the next run. */
export async function scannedAccessions(sb: Sb, filerId: string): Promise<Set<string>> {
  const out = new Set<string>()
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const r = await sb.from('contract_filing_scans').select('accession').eq('filer_id', filerId).is('error', null).range(from, from + PAGE - 1)
    const rows = (r.data ?? []) as Array<{ accession: string }>
    rows.forEach(x => out.add(x.accession))
    if (rows.length < PAGE) break
  }
  return out
}

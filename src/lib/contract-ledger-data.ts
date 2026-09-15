/**
 * Read side of the contract ledger, for /contracts and the CSV export.
 *
 * The ledger is small (hundreds to low thousands of rows), so one paged
 * read of everything not rejected, then filters and aggregates in memory.
 * That keeps every question a URL: the page's filters are query params.
 */

import { supabaseServiceRole } from '@/lib/supabase/service-role'

export interface LedgerRow {
  id: string
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
}

export const KIND_LABEL: Record<string, string> = {
  colocation_lease: 'Colocation lease',
  gpu_cloud_capacity: 'GPU cloud capacity',
  hosting_services: 'Hosting services',
  power_supply: 'Power supply',
  equipment_purchase: 'Equipment purchase',
  financing: 'Financing',
  other: 'Other',
}
export const STATUS_LABEL: Record<string, string> = {
  loi: 'LOI', definitive: 'Definitive', amended: 'Amended', expanded: 'Expanded',
  terminated: 'Terminated', completed: 'Completed',
}

export interface LedgerFilters {
  provider?: string   // provider_id or name fragment
  customer?: string   // customer_id or name fragment
  kind?: string
  status?: string
  since?: string      // YYYY-MM-DD
  q?: string          // any party / site contains
  minConfidence?: number
  includeUndisclosed: boolean
}

type SP = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v) || undefined

export function parseLedgerFilters(sp: SP): LedgerFilters {
  const mc = one(sp.min_conf)
  return {
    provider: one(sp.provider),
    customer: one(sp.customer),
    kind: one(sp.kind),
    status: one(sp.status),
    since: one(sp.since),
    q: one(sp.q),
    minConfidence: mc ? Number(mc) : undefined,
    includeUndisclosed: one(sp.undisclosed) !== '0',
  }
}

/** source_accession IS NOT NULL excludes rows with no filing to check them
 *  against — the ledger's whole premise is that every figure traces back
 *  to a document, so an unsourced row (e.g. a press-reported headline
 *  number entered by hand) can't be shown as if it were. */
export async function fetchAllLedgerRows(): Promise<{ rows: LedgerRow[]; error: string | null }> {
  const sb = supabaseServiceRole()
  const rows: LedgerRow[] = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const r = await sb.from('contract_disclosures').select('*')
      .neq('review_status', 'rejected')
      .not('source_accession', 'is', null)
      .order('filing_date', { ascending: false }).order('created_at', { ascending: false })
      .range(from, from + PAGE - 1)
    if (r.error) return { rows, error: r.error.message }
    const batch = (r.data ?? []) as unknown as LedgerRow[]
    rows.push(...batch)
    if (batch.length < PAGE) break
  }
  return { rows, error: null }
}

function matchParty(id: string | null, name: string | null, needle: string): boolean {
  const n = needle.toLowerCase()
  return id === n || (name ?? '').toLowerCase().includes(n)
}

export function applyLedgerFilters(rows: LedgerRow[], f: LedgerFilters): LedgerRow[] {
  return rows.filter(r => {
    if (f.provider && !matchParty(r.provider_id, r.provider_name, f.provider)) return false
    if (f.customer && !matchParty(r.customer_id, r.customer_name, f.customer)) return false
    if (f.kind && r.kind !== f.kind) return false
    if (f.status && r.status !== f.status) return false
    if (f.since && r.filing_date < f.since) return false
    if (f.minConfidence != null && (r.confidence ?? 0) < f.minConfidence) return false
    if (!f.includeUndisclosed && !r.customer_disclosed) return false
    if (f.q) {
      const q = f.q.toLowerCase()
      const hay = [r.provider_name, r.customer_name, r.guarantor_name, r.site, r.gpu_model].filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

export interface ConcentrationRow {
  customer: string
  customerId: string | null
  valueUsd: number
  mw: number
  contracts: number
  shareOfValue: number | null
  shareOfMw: number | null
}
export interface ProviderConcentration {
  providerId: string | null
  provider: string
  contracts: number
  valueUsd: number
  mw: number
  customers: ConcentrationRow[]
  /** Largest customer's share of disclosed value (or MW when value is absent). */
  topShare: number | null
}

/**
 * Customer concentration per provider, from disclosed totals. The number
 * a lender asks first: how much of this host's book is one counterparty.
 * Computed only from rows that carry a value or MW — undisclosed rows are
 * counted but cannot be weighted.
 */
export function concentrationByProvider(rows: LedgerRow[]): ProviderConcentration[] {
  const byProv = new Map<string, LedgerRow[]>()
  for (const r of rows) {
    if (r.status === 'terminated') continue
    const key = r.provider_id ?? `name:${r.provider_name}`
    byProv.set(key, [...(byProv.get(key) ?? []), r])
  }
  const out: ProviderConcentration[] = []
  for (const [, prs] of byProv) {
    const byCust = new Map<string, ConcentrationRow>()
    let valueUsd = 0, mw = 0
    for (const r of prs) {
      const ck = r.customer_id ?? (r.customer_disclosed && r.customer_name ? `name:${r.customer_name}` : 'undisclosed')
      const cur = byCust.get(ck) ?? { customer: r.customer_disclosed ? (r.customer_name ?? 'Unnamed') : 'Undisclosed', customerId: r.customer_id, valueUsd: 0, mw: 0, contracts: 0, shareOfValue: null, shareOfMw: null }
      cur.contracts++
      cur.valueUsd += r.total_value_usd ?? 0
      cur.mw += r.capacity_mw ?? 0
      valueUsd += r.total_value_usd ?? 0
      mw += r.capacity_mw ?? 0
      byCust.set(ck, cur)
    }
    const customers = [...byCust.values()].map(c => ({
      ...c,
      shareOfValue: valueUsd > 0 ? c.valueUsd / valueUsd : null,
      shareOfMw: mw > 0 ? c.mw / mw : null,
    })).sort((a, b) => (b.valueUsd - a.valueUsd) || (b.mw - a.mw) || (b.contracts - a.contracts))
    const top = customers[0]
    out.push({
      providerId: prs[0].provider_id,
      provider: prs[0].provider_name,
      contracts: prs.length,
      valueUsd, mw, customers,
      topShare: top ? (top.shareOfValue ?? top.shareOfMw) : null,
    })
  }
  return out.sort((a, b) => (b.valueUsd - a.valueUsd) || (b.mw - a.mw) || (b.contracts - a.contracts))
}

export function ledgerTotals(rows: LedgerRow[]) {
  const live = rows.filter(r => r.status !== 'terminated')
  return {
    contracts: rows.length,
    valueUsd: live.reduce((s, r) => s + (r.total_value_usd ?? 0), 0),
    mw: live.reduce((s, r) => s + (r.capacity_mw ?? 0), 0),
    gpus: live.reduce((s, r) => s + (r.gpu_count ?? 0), 0),
    providers: new Set(rows.map(r => r.provider_id ?? r.provider_name)).size,
    latestFiling: rows[0]?.filing_date ?? null,
    fromFilings: rows.filter(r => r.source_form !== 'press').length,
  }
}

// ---------------------------------------------------------------- per company

export interface CompanyLedger {
  asProvider: LedgerRow[]
  asCustomer: LedgerRow[]
  asGuarantor: LedgerRow[]
}

/** Split one company's rows by the role it plays in each. A row where the
 *  company is both provider and customer (a filer disclosing its own
 *  purchase) lands under provider only, so nothing is counted twice. */
export function splitLedgerByRole(rows: LedgerRow[], companyId: string): CompanyLedger {
  const out: CompanyLedger = { asProvider: [], asCustomer: [], asGuarantor: [] }
  for (const r of rows) {
    if (r.provider_id === companyId) out.asProvider.push(r)
    else if (r.customer_id === companyId) out.asCustomer.push(r)
    else if (r.guarantor_id === companyId) out.asGuarantor.push(r)
  }
  return out
}

const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/i

/** Every non-rejected row naming the company as provider, customer or
 *  guarantor, newest filing first. Non-fatal: a read error yields no rows. */
export async function fetchCompanyLedger(companyId: string): Promise<CompanyLedger> {
  const empty: CompanyLedger = { asProvider: [], asCustomer: [], asGuarantor: [] }
  if (!SAFE_ID.test(companyId)) return empty
  try {
    const sb = supabaseServiceRole()
    const r = await sb.from('contract_disclosures').select('*')
      .neq('review_status', 'rejected')
      .not('source_accession', 'is', null)
      .or(`provider_id.eq.${companyId},customer_id.eq.${companyId},guarantor_id.eq.${companyId}`)
      .order('filing_date', { ascending: false }).order('created_at', { ascending: false })
      .limit(500)
    if (r.error) return empty
    return splitLedgerByRole((r.data ?? []) as unknown as LedgerRow[], companyId)
  } catch {
    return empty
  }
}

export const CSV_COLUMNS: Array<keyof LedgerRow> = [
  'filing_date', 'source_form', 'status', 'kind', 'provider_name', 'provider_id', 'customer_name', 'customer_id',
  'customer_disclosed', 'guarantor_name', 'site', 'capacity_mw', 'gpu_count', 'gpu_model', 'term_months',
  'start_date', 'end_date', 'total_value_usd', 'annual_value_usd', 'prepayment_usd', 'has_extension_option',
  'extension_note', 'escalator_pct', 'source_url', 'source_accession', 'filer_id', 'confidence', 'review_status',
  'extractor', 'excerpt',
]

export function toCsv(rows: LedgerRow[]): string {
  const esc = (v: unknown): string => {
    if (v == null) return ''
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [CSV_COLUMNS.join(',')]
  for (const r of rows) lines.push(CSV_COLUMNS.map(c => esc(r[c])).join(','))
  return lines.join('\n') + '\n'
}

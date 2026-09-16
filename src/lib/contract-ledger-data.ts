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

/** One provider's book, reduced to its per-customer breakdown and totals.
 *  Shared by concentrationByProvider (the current book) and
 *  concentrationHistory (the book as of each past filing date) so the two
 *  can never disagree on what "concentration" means.
 *
 *  providerKey excludes self-dealing rows (a provider disclosed as its own
 *  customer, e.g. an internal restructuring between subsidiaries that
 *  resolve to the same company) -- otherwise a provider shows up as its
 *  own "top customer," which is meaningless for the credit-risk question
 *  this view exists to answer. Same class of fix as splitLedgerByRole's
 *  self-dealing dedup, applied to this aggregation instead. */
function reduceConcentration(providerRows: LedgerRow[], providerKey: string): Omit<ProviderConcentration, 'providerId' | 'provider'> {
  const byCust = new Map<string, ConcentrationRow>()
  let valueUsd = 0, mw = 0
  for (const r of providerRows) {
    const ck = r.customer_id ?? (r.customer_disclosed && r.customer_name ? `name:${r.customer_name}` : 'undisclosed')
    if (ck === providerKey) continue
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
  return {
    contracts: providerRows.length,
    valueUsd, mw, customers,
    topShare: top ? (top.shareOfValue ?? top.shareOfMw) : null,
  }
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
  for (const [key, prs] of byProv) {
    out.push({ providerId: prs[0].provider_id, provider: prs[0].provider_name, ...reduceConcentration(prs, key) })
  }
  return out.sort((a, b) => (b.valueUsd - a.valueUsd) || (b.mw - a.mw) || (b.contracts - a.contracts))
}

export interface ConcentrationSnapshot {
  /** The filing date this snapshot reflects — cumulative through this date. */
  asOfDate: string
  contracts: number
  valueUsd: number
  mw: number
  topCustomer: string | null
  topCustomerId: string | null
  topShare: number | null
}

/**
 * How one provider's book changed filing by filing — one snapshot per
 * distinct filing_date it appears on, each cumulative through that date, so
 * a lender can see concentration risk building (or easing) over time rather
 * than only the current-day number concentrationByProvider gives. Takes
 * rows already scoped to one provider (e.g. fetchCompanyLedger's asProvider)
 * — it doesn't filter by provider itself, only by status and date.
 */
export function concentrationHistory(providerRows: LedgerRow[]): ConcentrationSnapshot[] {
  const sorted = [...providerRows]
    .filter(r => r.status !== 'terminated')
    .sort((a, b) => a.filing_date.localeCompare(b.filing_date))
  const dates = [...new Set(sorted.map(r => r.filing_date))]
  const first = sorted[0]
  const providerKey = first ? (first.provider_id ?? `name:${first.provider_name}`) : ''
  return dates.map(asOfDate => {
    const upTo = sorted.filter(r => r.filing_date <= asOfDate)
    const c = reduceConcentration(upTo, providerKey)
    const top = c.customers[0]
    return {
      asOfDate,
      contracts: c.contracts,
      valueUsd: c.valueUsd,
      mw: c.mw,
      topCustomer: top?.customer ?? null,
      topCustomerId: top?.customerId ?? null,
      topShare: c.topShare,
    }
  })
}

/** Rows filed within the last `days` days (inclusive of today), newest
 *  first. Used by the /wire page and its RSS feed — both want the same
 *  "what disclosed this week" slice. `rows` need not already be sorted. */
export function lastNDaysRows(rows: LedgerRow[], days: number, now: Date = new Date()): LedgerRow[] {
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  return rows
    .filter(r => r.filing_date >= cutoff)
    .sort((a, b) => b.filing_date.localeCompare(a.filing_date))
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

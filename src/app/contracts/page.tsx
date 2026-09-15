/**
 * /contracts — the contract ledger.
 *
 * Every disclosed AI compute, colocation, hosting, power and equipment
 * contract, one row per disclosure, each pointing at the filing it came
 * from. Filters are query params so any view is a URL; the CSV export
 * honours the same params.
 */

import Link from 'next/link'
import {
  fetchAllLedgerRows, applyLedgerFilters, parseLedgerFilters, concentrationByProvider,
  ledgerTotals, KIND_LABEL, STATUS_LABEL, type LedgerRow,
} from '@/lib/contract-ledger-data'
import { usd } from '@/lib/format'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Contract Ledger — Offtake',
  description: 'Every disclosed AI compute, colocation, hosting and power contract, extracted from SEC filings with the source excerpt.',
}

type SP = Record<string, string | string[] | undefined>

function fmtDate(d: string | null): string {
  if (!d) return '—'
  return new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
}
function mw(n: number | null): string {
  if (n == null) return '—'
  return n >= 1000 ? `${(n / 1000).toFixed(2)} GW` : `${Math.round(n).toLocaleString('en-US')} MW`
}
function pct(x: number | null): string {
  return x == null ? '—' : `${Math.round(x * 100)}%`
}
function months(n: number | null): string {
  if (n == null) return '—'
  return n % 12 === 0 ? `${n / 12} yr` : `${n} mo`
}

const STATUS_TONE: Record<string, string> = {
  loi: 'text-[#FBBF24] border-[#FBBF24]/40',
  definitive: 'text-[#34D399] border-[#34D399]/40',
  amended: 'text-[#22D3EE] border-[#22D3EE]/40',
  expanded: 'text-[#22D3EE] border-[#22D3EE]/40',
  terminated: 'text-[#F87171] border-[#F87171]/40',
  completed: 'text-[#A5A8B0] border-[#3A3F4B]',
}

export default async function ContractsPage({ searchParams }: { searchParams: SP }) {
  const filters = parseLedgerFilters(searchParams)
  const { rows: all, error } = await fetchAllLedgerRows()
  const rows = applyLedgerFilters(all, filters)
  const totals = ledgerTotals(rows)
  const conc = concentrationByProvider(rows)
  const providers = [...new Map(all.map(r => [r.provider_id ?? r.provider_name, r.provider_name])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
  const qs = new URLSearchParams(Object.entries(searchParams).flatMap(([k, v]) => (v ? [[k, Array.isArray(v) ? v[0]! : v]] : []))).toString()

  return (
    <main className="min-h-screen bg-[#05060a] px-4 py-6 text-[#F2F3F5] sm:px-8 sm:py-8">
      <div className="mx-auto max-w-7xl space-y-6">

        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Contract Ledger</h1>
            <p className="mt-0.5 max-w-2xl text-xs text-[#6B6F7A]">
              Every disclosed AI compute, colocation, hosting, power and equipment contract, one row per
              disclosure, read from the SEC filing it appeared in. Nulls mean the filing did not say.
              Nothing is estimated.
            </p>
          </div>
          <nav className="flex items-center gap-3 text-xs text-[#6B6F7A]">
            <Link href="/graph" className="underline-offset-2 hover:text-[#A5A8B0] hover:underline">Graph</Link>
            <a href={`/api/contracts/export${qs ? `?${qs}` : ''}`} className="rounded border border-[#262A33] bg-[#13151C] px-2.5 py-1 text-[#A5A8B0] hover:border-[#3A3F4B] hover:text-[#F2F3F5]">
              Export CSV
            </a>
          </nav>
        </header>

        {error && (
          <div className="rounded-lg border border-[#F87171]/40 bg-[#13151C] px-4 py-3 text-xs text-[#F87171]">
            Ledger read failed: {error}
          </div>
        )}

        {/* totals for the current filter */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Tile label="Contracts" value={totals.contracts.toLocaleString('en-US')} hint={`${totals.fromFilings} from filings`} />
          <Tile label="Disclosed value" value={usd(totals.valueUsd)} hint="sum of stated totals, live" />
          <Tile label="Capacity" value={mw(totals.mw)} hint="sum of stated MW, live" />
          <Tile label="GPUs" value={totals.gpus ? totals.gpus.toLocaleString('en-US') : '—'} hint="where a count was stated" />
          <Tile label="Providers" value={String(totals.providers)} hint="parties delivering" />
          <Tile label="Latest filing" value={fmtDate(totals.latestFiling)} hint="most recent disclosure" />
        </div>

        {/* filters */}
        <form method="GET" action="/contracts" className="flex flex-wrap items-end gap-2">
          <Control label="Provider">
            <select name="provider" defaultValue={filters.provider ?? ''} className={selectCls}>
              <option value="">any</option>
              {providers.map(([id, name]) => <option key={id} value={id.startsWith('name:') ? name : id}>{name}</option>)}
            </select>
          </Control>
          <Control label="Customer">
            <input name="customer" defaultValue={filters.customer ?? ''} placeholder="name contains…" className={inputCls} />
          </Control>
          <Control label="Kind">
            <select name="kind" defaultValue={filters.kind ?? ''} className={selectCls}>
              <option value="">any</option>
              {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Control>
          <Control label="Status">
            <select name="status" defaultValue={filters.status ?? ''} className={selectCls}>
              <option value="">any</option>
              {Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Control>
          <Control label="Filed since">
            <input name="since" type="date" defaultValue={filters.since ?? ''} className={inputCls} />
          </Control>
          <Control label="Min confidence">
            <select name="min_conf" defaultValue={filters.minConfidence?.toString() ?? ''} className={selectCls}>
              <option value="">any</option>
              <option value="0.5">0.5</option>
              <option value="0.7">0.7</option>
              <option value="0.9">0.9</option>
            </select>
          </Control>
          <label className="flex items-center gap-1.5 pb-1.5 text-xs text-[#A5A8B0]">
            <input type="checkbox" name="undisclosed" value="0" defaultChecked={!filters.includeUndisclosed} className="accent-[#A78BFA]" />
            hide undisclosed customers
          </label>
          <button type="submit" className="rounded border border-[#A78BFA]/60 bg-[#A78BFA]/10 px-3 py-1 text-xs text-[#A78BFA] hover:bg-[#A78BFA]/20">Filter</button>
          <Link href="/contracts" className="px-2 py-1 text-xs text-[#6B6F7A] hover:text-[#A5A8B0]">Reset</Link>
        </form>

        {/* concentration */}
        {conc.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-label uppercase tracking-wider text-[#6B6F7A]">
              Customer concentration · by provider · {filters.provider ? 'filtered' : 'top 8'}
            </h2>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              {(filters.provider ? conc : conc.slice(0, 8)).map(p => (
                <div key={p.providerId ?? p.provider} className="rounded-lg border border-[#1B1E26] bg-[#0D0E13] p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <Link href={`/contracts?provider=${encodeURIComponent(p.providerId ?? p.provider)}`} className="truncate text-sm font-semibold hover:underline">{p.provider}</Link>
                    <span className="shrink-0 text-xs text-[#6B6F7A]">{p.contracts} contract{p.contracts === 1 ? '' : 's'}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-[#A5A8B0]">
                    {p.valueUsd > 0 ? usd(p.valueUsd) : '—'} · {p.mw > 0 ? mw(p.mw) : '—'}
                    {p.topShare != null && (
                      <span className={'ml-2 ' + (p.topShare >= 0.5 ? 'text-[#F87171]' : p.topShare >= 0.3 ? 'text-[#FBBF24]' : 'text-[#34D399]')}>
                        top customer {pct(p.topShare)}
                      </span>
                    )}
                  </div>
                  <ul className="mt-2 space-y-1">
                    {p.customers.slice(0, 4).map(c => (
                      <li key={c.customer} className="flex items-center gap-2 text-xs">
                        <span className="w-28 shrink-0 truncate text-[#F2F3F5]" title={c.customer}>{c.customer}</span>
                        <span className="h-1.5 flex-1 overflow-hidden rounded bg-[#1B1E26]">
                          <span className="block h-full bg-[#A78BFA]" style={{ width: `${Math.round(((c.shareOfValue ?? c.shareOfMw) ?? 0) * 100)}%` }} />
                        </span>
                        <span className="w-24 shrink-0 text-right text-[#A5A8B0]">
                          {c.valueUsd > 0 ? usd(c.valueUsd) : c.mw > 0 ? mw(c.mw) : `${c.contracts}×`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ledger */}
        <section className="space-y-2">
          <h2 className="text-label uppercase tracking-wider text-[#6B6F7A]">Disclosures · {rows.length}</h2>
          <div className="overflow-x-auto rounded-lg border border-[#1B1E26]">
            <table className="w-full min-w-[1100px] text-xs">
              <thead className="bg-[#0D0E13] text-left text-[10px] uppercase tracking-wider text-[#6B6F7A]">
                <tr>
                  <th className="px-3 py-2">Filed</th>
                  <th className="px-3 py-2">Provider</th>
                  <th className="px-3 py-2">Customer</th>
                  <th className="px-3 py-2">Kind</th>
                  <th className="px-3 py-2">Site</th>
                  <th className="px-3 py-2 text-right">MW</th>
                  <th className="px-3 py-2 text-right">GPUs</th>
                  <th className="px-3 py-2 text-right">Term</th>
                  <th className="px-3 py-2 text-right">Total value</th>
                  <th className="px-3 py-2 text-right">Annual</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Source</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={12} className="px-3 py-8 text-center text-[#6B6F7A]">Nothing matches. Widen the filters.</td></tr>
                )}
                {rows.map(r => <Row key={r.id} r={r} />)}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-[#43474F]">
            Rows marked auto were extracted by a model and not yet reviewed; the excerpt under each row is the
            verbatim passage the figures came from. Confidence is the extractor&apos;s own estimate.
          </p>
        </section>
      </div>
    </main>
  )
}

function Row({ r }: { r: LedgerRow }) {
  const custLabel = r.customer_disclosed ? (r.customer_name ?? '—') : `Undisclosed${r.customer_name ? ` (${r.customer_name})` : ''}`
  return (
    <>
      <tr className="border-t border-[#1B1E26] align-top hover:bg-[#0D0E13]">
        <td className="whitespace-nowrap px-3 py-2 text-[#A5A8B0]">{fmtDate(r.filing_date)}</td>
        <td className="px-3 py-2">
          {r.provider_id ? <Link href={`/company/${r.provider_id}`} className="hover:underline">{r.provider_name}</Link> : r.provider_name}
        </td>
        <td className="px-3 py-2">
          {r.customer_id ? <Link href={`/company/${r.customer_id}`} className="hover:underline">{custLabel}</Link> : <span className={r.customer_disclosed ? '' : 'text-[#6B6F7A]'}>{custLabel}</span>}
          {r.guarantor_name && <div className="text-[10px] text-[#6B6F7A]">backstop: {r.guarantor_name}</div>}
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-[#A5A8B0]">{KIND_LABEL[r.kind] ?? r.kind}</td>
        <td className="max-w-[160px] truncate px-3 py-2 text-[#A5A8B0]" title={r.site ?? ''}>{r.site ?? '—'}</td>
        <td className="whitespace-nowrap px-3 py-2 text-right">{mw(r.capacity_mw)}</td>
        <td className="whitespace-nowrap px-3 py-2 text-right" title={r.gpu_model ?? ''}>{r.gpu_count ? r.gpu_count.toLocaleString('en-US') : '—'}</td>
        <td className="whitespace-nowrap px-3 py-2 text-right">{months(r.term_months)}</td>
        <td className="whitespace-nowrap px-3 py-2 text-right font-semibold">{usd(r.total_value_usd)}</td>
        <td className="whitespace-nowrap px-3 py-2 text-right text-[#A5A8B0]">{usd(r.annual_value_usd)}</td>
        <td className="px-3 py-2">
          <span className={'rounded border px-1.5 py-0.5 text-[10px] ' + (STATUS_TONE[r.status] ?? '')}>{STATUS_LABEL[r.status] ?? r.status}</span>
          {r.review_status === 'auto' && <span className="ml-1 text-[10px] text-[#43474F]" title={`confidence ${r.confidence ?? '?'}`}>auto{r.confidence != null ? ` ${r.confidence.toFixed(1)}` : ''}</span>}
          {r.review_status === 'verified' && <span className="ml-1 text-[10px] text-[#34D399]">verified</span>}
        </td>
        <td className="whitespace-nowrap px-3 py-2">
          {r.source_url
            ? <a href={r.source_url} target="_blank" rel="noopener noreferrer" className="text-[#22D3EE] hover:underline">{r.source_form}</a>
            : <span className="text-[#A5A8B0]" title={r.source_note ?? ''}>{r.source_form}</span>}
        </td>
      </tr>
      {r.excerpt && (
        <tr className="bg-[#0A0B0F]">
          <td colSpan={12} className="px-3 pb-2 pt-0">
            <details>
              <summary className="cursor-pointer text-[10px] text-[#43474F] hover:text-[#6B6F7A]">excerpt{r.extension_note ? ' · extension terms' : ''}{r.prepayment_usd ? ` · prepayment ${usd(r.prepayment_usd)}` : ''}</summary>
              <blockquote className="mt-1 max-w-4xl border-l-2 border-[#262A33] pl-3 text-[11px] leading-relaxed text-[#A5A8B0]">{r.excerpt}</blockquote>
              {r.extension_note && <p className="mt-1 text-[11px] text-[#6B6F7A]">Extension: {r.extension_note}</p>}
              {r.source_note && <p className="mt-1 text-[11px] text-[#6B6F7A]">Source: {r.source_note}</p>}
            </details>
          </td>
        </tr>
      )}
    </>
  )
}

const inputCls = 'w-40 rounded border border-[#262A33] bg-[#13151C] px-2 py-1 text-xs text-[#F2F3F5] placeholder:text-[#43474F] focus:border-[#A78BFA] focus:outline-none'
const selectCls = 'rounded border border-[#262A33] bg-[#13151C] px-2 py-1 text-xs text-[#F2F3F5] focus:border-[#A78BFA] focus:outline-none'

function Control({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-[#6B6F7A]">
      {label}
      {children}
    </label>
  )
}

function Tile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-[#1B1E26] bg-[#0D0E13] px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wider text-[#6B6F7A]">{label}</div>
      <div className="mt-0.5 text-base font-semibold tabular-nums">{value}</div>
      <div className="text-[10px] text-[#43474F]">{hint}</div>
    </div>
  )
}

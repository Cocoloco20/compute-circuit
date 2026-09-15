/**
 * /wire — the weekly contract wire.
 *
 * The last 7 days of disclosures, newest first, one line each with the
 * excerpt. Same data as /contracts, just windowed and flattened to a feed
 * rather than a filterable table. See src/app/wire/feed.xml/route.ts for
 * the RSS version of this same slice.
 */

import Link from 'next/link'
import { fetchAllLedgerRows, lastNDaysRows, KIND_LABEL, type LedgerRow } from '@/lib/contract-ledger-data'
import { usd } from '@/lib/format'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Contract Wire — Offtake',
  description: 'The last 7 days of disclosed AI compute, colocation, hosting and power contracts, newest first, with the source excerpt on every row.',
}

const WINDOW_DAYS = 7
const EXCERPT_MAX = 320

function fmtDate(d: string): string {
  return new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
}
function mw(n: number | null): string | null {
  if (n == null) return null
  return n >= 1000 ? `${(n / 1000).toFixed(2)} GW` : `${Math.round(n).toLocaleString('en-US')} MW`
}
function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max).trimEnd() + '…'
}

export default async function WirePage() {
  const { rows: all, error } = await fetchAllLedgerRows()
  const rows = lastNDaysRows(all, WINDOW_DAYS)

  return (
    <main className="min-h-screen bg-[#05060a] px-4 py-6 text-[#F2F3F5] sm:px-8 sm:py-8">
      <div className="mx-auto max-w-4xl space-y-6">

        <header className="space-y-2">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold tracking-tight">Contract Wire</h1>
              <p className="mt-0.5 max-w-2xl text-xs text-[#6B6F7A]">
                Every AI compute, colocation, hosting, power and equipment contract disclosed in the
                last {WINDOW_DAYS} days, newest first, with the source excerpt.
              </p>
            </div>
            <nav className="flex items-center gap-3 text-xs text-[#6B6F7A]">
              <a href="/wire/feed.xml" className="rounded border border-[#262A33] bg-[#13151C] px-2.5 py-1 text-[#A5A8B0] hover:border-[#3A3F4B] hover:text-[#F2F3F5]">
                RSS
              </a>
              <Link href="/contracts" className="underline-offset-2 hover:text-[#A5A8B0] hover:underline">Full ledger</Link>
              <Link href="/" className="underline-offset-2 hover:text-[#A5A8B0] hover:underline">Home</Link>
            </nav>
          </div>
        </header>

        {error && (
          <div className="rounded-lg border border-[#F87171]/40 bg-[#13151C] px-4 py-3 text-xs text-[#F87171]">
            Ledger read failed: {error}
          </div>
        )}

        {!error && rows.length === 0 && (
          <div className="rounded-lg border border-[#1B1E26] bg-[#0D0E13] px-4 py-8 text-center text-xs text-[#6B6F7A]">
            No contracts disclosed in the last {WINDOW_DAYS} days.
          </div>
        )}

        {rows.length > 0 && (
          <ul className="space-y-2">
            {rows.map(r => <WireRow key={r.id} r={r} />)}
          </ul>
        )}
      </div>
    </main>
  )
}

function WireRow({ r }: { r: LedgerRow }) {
  const customer = r.customer_disclosed ? (r.customer_name ?? '—') : 'undisclosed'
  const figure = r.total_value_usd != null ? usd(r.total_value_usd) : mw(r.capacity_mw)
  return (
    <li className="rounded-lg border border-[#1B1E26] bg-[#0D0E13] px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
        <span className="text-[#A5A8B0]">{fmtDate(r.filing_date)}</span>
        <span className="font-medium">
          {r.provider_id ? <Link href={`/company/${r.provider_id}`} className="hover:underline">{r.provider_name}</Link> : r.provider_name}
        </span>
        <span className="text-[#6B6F7A]">→</span>
        <span className={r.customer_disclosed ? '' : 'text-[#6B6F7A]'}>
          {r.customer_id ? <Link href={`/company/${r.customer_id}`} className="hover:underline">{customer}</Link> : customer}
        </span>
        <span className="text-[#6B6F7A]">·</span>
        <span className="text-[#A5A8B0]">{KIND_LABEL[r.kind] ?? r.kind}</span>
        {figure && (
          <>
            <span className="text-[#6B6F7A]">·</span>
            <span className="font-mono text-[#A5A8B0]">{figure}</span>
          </>
        )}
        {r.source_url && (
          <a href={r.source_url} target="_blank" rel="noopener noreferrer" className="ml-auto shrink-0 text-[#22D3EE] hover:underline">
            {r.source_form}
          </a>
        )}
      </div>
      {r.excerpt && (
        <p className="mt-1.5 max-w-3xl text-[11px] leading-relaxed text-[#6B6F7A]">
          {truncate(r.excerpt, EXCERPT_MAX)}
        </p>
      )}
    </li>
  )
}

/**
 * Landing page. The ledger is the product; this is what a visitor with no
 * context should see before the data table, not after.
 *
 * Server-rendered, reads the same ledger the /contracts page reads (one
 * call, no client fetch), so the numbers on this page are never stale
 * relative to the table someone clicks through to.
 */

import Link from 'next/link'
import { fetchAllLedgerRows, ledgerTotals, concentrationByProvider } from '@/lib/contract-ledger-data'
import { usd } from '@/lib/format'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Offtake',
  description: 'The ledger of disclosed AI compute contracts — every colocation lease, GPU cloud deal, hosting agreement and power contract a public company has disclosed, read from the SEC filing it appeared in.',
}

function mw(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)} GW` : `${Math.round(n).toLocaleString('en-US')} MW`
}

export default async function LandingPage() {
  const { rows, error } = await fetchAllLedgerRows()
  const live = rows.filter(r => r.review_status !== 'rejected')
  const totals = ledgerTotals(live)
  const topProviders = concentrationByProvider(live).slice(0, 6)
  const recent = live.slice(0, 5)

  return (
    <main className="min-h-screen bg-[#05060a] text-[#F2F3F5]">
      <div className="mx-auto max-w-4xl px-4 py-16 sm:px-8 sm:py-24">

        <header className="space-y-5">
          <div className="font-mono text-xs uppercase tracking-[0.2em] text-[#6B6F7A]">Offtake</div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            The ledger of disclosed AI compute contracts.
          </h1>
          <p className="max-w-2xl text-base leading-relaxed text-[#A5A8B0]">
            Every colocation lease, GPU cloud capacity deal, hosting agreement, power contract and
            equipment purchase that a public company has disclosed — one row per disclosure, read
            from the SEC filing it appeared in, with the verbatim excerpt the numbers came from.
            Nulls mean the filing didn&apos;t say. Nothing here is estimated.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Link
              href="/contracts"
              className="rounded-md bg-[#F2F3F5] px-4 py-2 text-sm font-medium text-[#05060a] hover:bg-white"
            >
              Open the ledger
            </Link>
            <a
              href="/api/contracts/export"
              className="rounded-md border border-[#262A33] bg-[#13151C] px-4 py-2 text-sm text-[#A5A8B0] hover:border-[#3A3F4B] hover:text-[#F2F3F5]"
            >
              Export CSV
            </a>
            <Link
              href="/graph"
              className="px-2 py-2 text-sm text-[#6B6F7A] hover:text-[#A5A8B0]"
            >
              Explore the supply-chain graph →
            </Link>
          </div>
        </header>

        {error ? (
          <div className="mt-12 rounded-lg border border-[#F87171]/40 bg-[#13151C] px-4 py-3 text-xs text-[#F87171]">
            Ledger read failed: {error}
          </div>
        ) : (
          <>
            <section className="mt-14 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Contracts" value={totals.contracts.toLocaleString('en-US')} />
              <Stat label="Disclosed value" value={usd(totals.valueUsd)} />
              <Stat label="Capacity" value={mw(totals.mw)} />
              <Stat label="Providers" value={String(totals.providers)} />
            </section>

            {topProviders.length > 0 && (
              <section className="mt-14 space-y-3">
                <h2 className="text-label uppercase tracking-wider text-[#6B6F7A]">
                  By provider
                </h2>
                <div className="grid gap-2 sm:grid-cols-2">
                  {topProviders.map(p => (
                    <Link
                      key={p.providerId ?? p.provider}
                      href={`/contracts?provider=${encodeURIComponent(p.providerId ?? p.provider)}`}
                      className="flex items-baseline justify-between gap-2 rounded-lg border border-[#1B1E26] bg-[#0D0E13] px-4 py-3 hover:border-[#262A33]"
                    >
                      <span className="min-w-0 truncate font-medium">{p.provider}</span>
                      <span className="shrink-0 font-mono text-sm text-[#A5A8B0]">
                        {p.valueUsd > 0 ? usd(p.valueUsd) : mw(p.mw)}
                      </span>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {recent.length > 0 && (
              <section className="mt-14 space-y-3">
                <h2 className="text-label uppercase tracking-wider text-[#6B6F7A]">
                  Latest disclosures
                </h2>
                <div className="divide-y divide-[#1B1E26] rounded-lg border border-[#1B1E26] bg-[#0D0E13]">
                  {recent.map(r => (
                    <div key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm">
                      <span className="text-[#A5A8B0]">
                        {new Date(r.filing_date + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-medium">{r.provider_name}</span>
                        <span className="text-[#6B6F7A]"> → </span>
                        <span>{r.customer_disclosed ? (r.customer_name ?? '—') : 'undisclosed'}</span>
                      </span>
                      <span className="font-mono text-[#A5A8B0]">{usd(r.total_value_usd)}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        <section className="mt-14 space-y-3 border-t border-[#1B1E26] pt-10 text-sm leading-relaxed text-[#6B6F7A]">
          <h2 className="text-label uppercase tracking-wider text-[#6B6F7A]">How this is built</h2>
          <p>
            Neoclouds and powered-shell hosts run on multi-year take-or-pay contracts — the terms
            are disclosed in 8-Ks, 6-Ks, and earnings exhibits, and nobody sells the structured
            table. Every row here came from a model reading one filing against a fixed schema:
            parties, megawatts, GPU count, term, dollar value, status. When the filing doesn&apos;t
            state a field, the row leaves it null rather than guessing. Every row links back to the
            filing and carries the exact excerpt the numbers were read from, so any figure is
            checkable in the time it takes to open one link.
          </p>
          <p>
            Free and open source —{' '}
            <a href="https://github.com/Cocoloco20/compute-circuit" className="underline decoration-[#3A3F4B] underline-offset-2 hover:text-[#A5A8B0]">
              source and pipelines on GitHub
            </a>.
          </p>
        </section>
      </div>
    </main>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#1B1E26] bg-[#0D0E13] px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-[#6B6F7A]">{label}</div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  )
}

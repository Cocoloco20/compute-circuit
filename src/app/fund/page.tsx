/**
 * /fund — what went out, what it is worth, what is left.
 *
 * Deliberately small. A solo GP writing his own cheques needs four numbers
 * he can trust, not a fund-admin suite: how much is committed, how much has
 * been deployed, what the positions are marked at, and what he can still
 * write a first cheque against.
 */

import Link from 'next/link'
import { fetchFund, usd } from '@/lib/fund-data'
import type { PositionRow } from '@/lib/fund-data'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Fund — Offtake' }

function fmtDate(d: string): string {
  return new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { year: 'numeric', month: 'short' })
}

export default async function FundPage() {
  const { fund, positions, totals, error } = await fetchFund()

  return (
    <main className="min-h-screen bg-[#05060a] px-4 py-6 text-[#F2F3F5] sm:px-8 sm:py-8">
      <div className="mx-auto max-w-5xl space-y-6">

        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{fund?.name ?? 'Fund'}</h1>
            <p className="mt-0.5 text-xs text-[#6B6F7A]">
              {fund
                ? <>Vintage {fund.vintage_year ?? '—'} · reserve ratio{' '}
                    <span className="tabular-nums">{(Number(fund.reserve_ratio) * 100).toFixed(0)}%</span></>
                : 'Not set up yet.'}
            </p>
          </div>
          <nav className="flex items-center gap-3 text-xs text-[#6B6F7A]">
            <Link href="/terminal" className="underline-offset-2 hover:text-[#A5A8B0] hover:underline">Terminal</Link>
            <Link href="/screen" className="underline-offset-2 hover:text-[#A5A8B0] hover:underline">Screen</Link>
            <Link href="/pipeline" className="underline-offset-2 hover:text-[#A5A8B0] hover:underline">Pipeline</Link>
            <Link href="/decisions" className="underline-offset-2 hover:text-[#A5A8B0] hover:underline">Decisions</Link>
          </nav>
        </header>

        {error ? (
          <Panel className="border-[#F87171]/30">
            <p className="text-sm text-[#F87171]">Fund data unavailable.</p>
            <p className="mt-1 font-mono text-[11px] text-[#6B6F7A]">{error}</p>
          </Panel>
        ) : !fund ? (
          <Panel>
            <p className="text-sm text-[#A5A8B0]">No fund configured.</p>
            <p className="mt-2 max-w-2xl text-xs leading-relaxed text-[#6B6F7A]">
              Set committed capital and a reserve ratio and every other number on this page —
              and the dry powder figure on the terminal — starts computing. One call:
            </p>
            <pre className="mt-2 overflow-x-auto rounded border border-[#262A33] bg-[#0A0B0F] p-3 text-[11px] text-[#A5A8B0]">{`curl -X POST https://compute-circuit.vercel.app/api/fund \\
  -H "Authorization: Bearer $CRON_SECRET" \\
  -H 'Content-Type: application/json' \\
  -d '{"name":"Fund I","vintage_year":2026,
       "committed_usd":1000000,"reserve_ratio":0.5,
       "target_check_usd":50000}'`}</pre>
          </Panel>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Tile label="Dry powder" value={usd(totals.dryPowder)} tone="accent"
                    hint="committed − deployed − reserve pool" />
              <Tile label="Deployed" value={usd(totals.deployed)}
                    hint={`${positions.length} position${positions.length === 1 ? '' : 's'}`} />
              <Tile label="Fair value" value={usd(totals.fairValue)}
                    hint={totals.unrealized >= 0
                      ? `+${usd(totals.unrealized)} unrealised`
                      : `${usd(totals.unrealized)} unrealised`} />
              <Tile label="TVPI" value={totals.deployed > 0 ? `${totals.tvpi.toFixed(2)}x` : '—'}
                    hint={totals.deployed > 0 ? `DPI ${totals.dpi.toFixed(2)}x` : 'no capital out'} />
            </div>

            <div className="flex flex-wrap gap-x-5 gap-y-1 rounded-lg border border-[#1B1E26] bg-[#0D0E13] px-4 py-2.5 text-xs text-[#6B6F7A]">
              <span>Committed <span className="tabular-nums text-[#A5A8B0]">{usd(totals.committed)}</span></span>
              <span>Called <span className="tabular-nums text-[#A5A8B0]">{usd(totals.called)}</span></span>
              <span>Reserve pool <span className="tabular-nums text-[#A5A8B0]">{usd(totals.reservePool)}</span></span>
              <span>Earmarked <span className="tabular-nums text-[#A5A8B0]">{usd(totals.earmarked)}</span></span>
              {fund.target_check_usd != null && (
                <span>Target cheque <span className="tabular-nums text-[#A5A8B0]">{usd(Number(fund.target_check_usd))}</span></span>
              )}
            </div>

            {positions.length === 0 ? (
              <Panel>
                <p className="text-sm text-[#A5A8B0]">No positions yet.</p>
                <p className="mt-1 text-xs text-[#6B6F7A]">
                  Every cheque recorded here reduces dry powder and appears on the terminal&apos;s
                  portfolio strip. Unmarked positions are held at cost — writing them up on a
                  hunch is how a paper portfolio flatters itself.
                </p>
              </Panel>
            ) : (
              <Positions rows={positions} />
            )}
          </>
        )}
      </div>
    </main>
  )
}

function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-[#1B1E26] bg-[#0D0E13] px-4 py-4 ${className}`}>{children}</div>
}

function Tile({ label, value, hint, tone }: {
  label: string; value: string; hint?: string; tone?: 'accent'
}) {
  return (
    <div className="rounded-lg border border-[#1B1E26] bg-[#0D0E13] px-4 py-3">
      <p className="text-[10px] uppercase tracking-wider text-[#6B6F7A]">{label}</p>
      <p className={`mt-1 text-xl tabular-nums ${tone === 'accent' ? 'text-[#A78BFA]' : 'text-[#F2F3F5]'}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[10px] text-[#43474F]">{hint}</p>}
    </div>
  )
}

function Positions({ rows }: { rows: PositionRow[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-[#1B1E26] bg-[#0D0E13]">
      <table className="w-full min-w-[52rem] text-sm">
        <thead>
          <tr className="border-b border-[#1B1E26] text-left text-[10px] uppercase tracking-wider text-[#6B6F7A]">
            <th className="px-4 py-2 font-medium">Company</th>
            <th className="px-4 py-2 font-medium">Invested</th>
            <th className="px-4 py-2 text-right font-medium">Cost</th>
            <th className="px-4 py-2 text-right font-medium">Mark</th>
            <th className="px-4 py-2 text-right font-medium">MOIC</th>
            <th className="px-4 py-2 text-right font-medium">Reserved</th>
            <th className="px-4 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#131519]">
          {rows.map(r => (
            <tr key={r.investmentId} className="hover:bg-[#13151C]">
              <td className="px-4 py-2.5">
                <Link href={`/company/${encodeURIComponent(r.companyId)}`}
                  className="font-medium underline-offset-2 hover:text-[#A78BFA] hover:underline">
                  {r.company}
                </Link>
                <span className="ml-2 text-[11px] text-[#6B6F7A]">
                  {r.instrument}{r.round ? ` · ${r.round}` : ''}
                </span>
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-[#A5A8B0]">{fmtDate(r.investedAt)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-[#A5A8B0]">{usd(r.amountUsd)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">
                {r.markUsd == null
                  ? <span className="text-[#43474F]" title="never marked — held at cost">at cost</span>
                  : <span className="text-[#F2F3F5]">{usd(r.markUsd)}</span>}
                {r.markSource && <span className="ml-1 text-[10px] text-[#43474F]">{r.markSource}</span>}
              </td>
              <td className={`px-4 py-2.5 text-right tabular-nums ${
                r.moic > 1 ? 'text-[#34D399]' : r.moic < 1 ? 'text-[#F87171]' : 'text-[#6B6F7A]'
              }`}>{r.moic.toFixed(2)}x</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-[#6B6F7A]">
                {r.reservedUsd > 0 ? usd(r.reservedUsd) : '—'}
              </td>
              <td className="px-4 py-2.5">
                <span className={
                  r.status === 'Exited' ? 'text-[#34D399]'
                  : r.status === 'Written Off' ? 'text-[#F87171]' : 'text-[#A5A8B0]'
                }>{r.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

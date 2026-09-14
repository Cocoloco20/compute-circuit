/**
 * /decisions — the query layer over the decision log.
 *
 * Every filter is a query param, so every question you ask is a URL you can
 * bookmark and re-run. That is the point: "am I overconfident on passes?" has
 * to be a link you revisit, not a thing you try to remember.
 *
 * Server-rendered under the service role, like /terminal and /pipeline.
 */

import Link from 'next/link'
import {
  parseFilters, searchDecisions, withParam, PAGE_SIZE, VERDICTS,
} from '@/lib/decision-search'
import { FACTORS, OUTCOMES } from '@/lib/decisions'
import type { DecisionRow } from '@/lib/decision-search'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Decisions — Offtake' }

type SP = Record<string, string | string[] | undefined>

/** The questions worth having as one click. */
const SAVED = [
  { label: 'Anti-portfolio', href: '/decisions?verdict=No',
    hint: 'passes the world later proved wrong' },
  { label: 'Calibration set', href: '/decisions?outcome=Pass&confidence=5',
    hint: 'passes you were certain about' },
  { label: 'Market timing passes', href: '/decisions?outcome=Pass&factor=Market%20Timing',
    hint: 'the most common reason to be early and wrong' },
  { label: 'Team disagreed', href: '/decisions?dissent=true',
    hint: 'decisions made over an objection' },
  { label: 'Awaiting a verdict', href: '/decisions?verdict=unreviewed',
    hint: 'resurfaced, not yet judged' },
  { label: 'Everything invested', href: '/decisions?outcome=Invest',
    hint: 'the portfolio, with its reasoning' },
]

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

export default async function DecisionsPage({ searchParams }: { searchParams: SP }) {
  const filters = parseFilters(searchParams)
  const res = await searchDecisions(filters)
  const active = Object.entries(searchParams)
    .filter(([k, v]) => v && k !== 'page')
    .map(([k, v]) => [k, Array.isArray(v) ? v[0]! : v!] as [string, string])

  return (
    <main className="min-h-screen bg-[#05060a] px-4 py-6 text-[#F2F3F5] sm:px-8 sm:py-8">
      <div className="mx-auto max-w-6xl space-y-6">

        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Decisions</h1>
            <p className="mt-0.5 text-xs text-[#6B6F7A]">
              What you decided, why, and whether it held.
            </p>
          </div>
          <nav className="flex items-center gap-3 text-xs text-[#6B6F7A]">
            <Link href="/terminal" className="underline-offset-2 hover:text-[#A5A8B0] hover:underline">Terminal</Link>
            <Link href="/fund" className="underline-offset-2 hover:text-[#A5A8B0] hover:underline">Fund</Link>
            <Link href="/screen" className="underline-offset-2 hover:text-[#A5A8B0] hover:underline">Screen</Link>
            <Link href="/pipeline" className="underline-offset-2 hover:text-[#A5A8B0] hover:underline">Pipeline</Link>
          </nav>
        </header>

        {/* whole-log context — deliberately does not move when you filter */}
        {res.totals.all > 0 && (
          <div className="flex flex-wrap gap-x-5 gap-y-1 rounded-lg border border-[#1B1E26] bg-[#0D0E13] px-4 py-2.5 text-xs">
            <Stat label="decisions" value={res.totals.all} />
            {OUTCOMES.map(o => <Stat key={o} label={o.toLowerCase()} value={res.totals.byOutcome[o] ?? 0} />)}
            <Stat label="certain passes" value={res.totals.highConfidencePasses} tone="warn" />
            <Stat label="proven wrong" value={res.totals.provenWrong} tone="alert" />
          </div>
        )}

        {/* saved queries */}
        <div className="flex flex-wrap gap-2">
          {SAVED.map(s => (
            <Link
              key={s.href}
              href={s.href}
              title={s.hint}
              className="rounded-full border border-[#262A33] bg-[#13151C] px-3 py-1 text-xs text-[#A5A8B0] transition-colors hover:bg-[#1B1E26] hover:text-[#F2F3F5]"
            >{s.label}</Link>
          ))}
        </div>

        {/* filters */}
        <form method="GET" action="/decisions" className="flex flex-wrap items-end gap-2">
          <Control label="Company">
            <input
              name="company" defaultValue={filters.company ?? ''} placeholder="name contains…"
              className="w-40 rounded border border-[#262A33] bg-[#13151C] px-2 py-1 text-xs text-[#F2F3F5] placeholder:text-[#43474F] focus:border-[#A78BFA] focus:outline-none"
            />
          </Control>
          <Control label="Outcome">
            <Select name="outcome" value={filters.outcome} options={OUTCOMES} />
          </Control>
          <Control label="Factor">
            <Select name="factor" value={filters.factor} options={FACTORS} />
          </Control>
          <Control label="Confidence">
            <Select name="confidence" value={filters.confidence?.toString()} options={['1', '2', '3', '4', '5']} />
          </Control>
          <Control label="Verdict">
            <Select name="verdict" value={filters.verdict} options={[...VERDICTS, 'unreviewed']} />
          </Control>
          <Control label="From">
            <input type="date" name="from" defaultValue={filters.from ?? ''}
              className="rounded border border-[#262A33] bg-[#13151C] px-2 py-1 text-xs text-[#F2F3F5] focus:border-[#A78BFA] focus:outline-none" />
          </Control>
          <Control label="To">
            <input type="date" name="to" defaultValue={filters.to ?? ''}
              className="rounded border border-[#262A33] bg-[#13151C] px-2 py-1 text-xs text-[#F2F3F5] focus:border-[#A78BFA] focus:outline-none" />
          </Control>
          <Control label="Reasoning contains">
            <input name="q" defaultValue={filters.q ?? ''} placeholder="free text…"
              className="w-44 rounded border border-[#262A33] bg-[#13151C] px-2 py-1 text-xs text-[#F2F3F5] placeholder:text-[#43474F] focus:border-[#A78BFA] focus:outline-none" />
          </Control>
          <button className="rounded bg-[#A78BFA] px-3 py-1.5 text-xs font-medium text-[#0A0B0F]">Search</button>
          {active.length > 0 && (
            <Link href="/decisions" className="px-2 py-1.5 text-xs text-[#6B6F7A] underline hover:text-[#A5A8B0]">Clear</Link>
          )}
        </form>

        {active.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-[#43474F]">Filtered by</span>
            {active.map(([k, v]) => (
              <Link
                key={k} href={withParam(searchParams, k, null)}
                className="group rounded border border-[#A78BFA]/40 bg-[#A78BFA]/10 px-2 py-0.5 text-[#F2F3F5]"
                title="remove"
              >{k}: {v} <span className="text-[#6B6F7A] group-hover:text-[#F87171]">×</span></Link>
            ))}
          </div>
        )}

        {/* results */}
        {res.error ? (
          <Panel className="border-[#F87171]/30">
            <p className="text-sm text-[#F87171]">Search unavailable.</p>
            <p className="mt-1 font-mono text-[11px] text-[#6B6F7A]">{res.error}</p>
          </Panel>
        ) : res.totals.all === 0 ? (
          <Panel>
            <p className="text-sm text-[#A5A8B0]">No decisions recorded yet.</p>
            <p className="mt-2 max-w-2xl text-xs leading-relaxed text-[#6B6F7A]">
              Every pass, advance and invest lands here the moment it is captured — from the
              pipeline when you move a card to Passed, Term Sheet or Closed, or with{' '}
              <kbd className="rounded border border-[#262A33] px-1">d</kbd> from anywhere. Once
              there are a few dozen, the saved queries above stop being empty and start being
              the calibration record: which factors you pass on, how often certainty was
              misplaced, and which passes the world later answered.
            </p>
            <Link href="/pipeline" className="mt-3 inline-block text-xs text-[#22D3EE] hover:underline">
              Start from the pipeline →
            </Link>
          </Panel>
        ) : res.rows.length === 0 ? (
          <Panel><p className="text-sm text-[#6B6F7A]">No decisions match these filters.</p></Panel>
        ) : (
          <>
            <div className="flex items-baseline justify-between text-xs text-[#6B6F7A]">
              <span>
                <span className="tabular-nums text-[#A5A8B0]">{res.total}</span>{' '}
                {res.total === 1 ? 'decision' : 'decisions'}
                {res.pages > 1 && <> · page <span className="tabular-nums">{res.page}</span> of <span className="tabular-nums">{res.pages}</span></>}
              </span>
              <a
                href={`/api/decisions/export${buildQS(searchParams)}`}
                className="text-[#22D3EE] hover:underline"
              >Export CSV</a>
            </div>
            <Results rows={res.rows} />
            {res.pages > 1 && <Pager sp={searchParams} page={res.page} pages={res.pages} />}
          </>
        )}
      </div>
    </main>
  )
}

function buildQS(sp: SP): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) {
    const s = Array.isArray(v) ? v[0] : v
    if (s && k !== 'page') p.set(k, s)
  }
  const s = p.toString()
  return s ? `?${s}` : ''
}

function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-[#1B1E26] bg-[#0D0E13] px-4 py-4 ${className}`}>{children}</div>
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'warn' | 'alert' }) {
  const color = value === 0 ? 'text-[#43474F]'
    : tone === 'alert' ? 'text-[#F87171]'
    : tone === 'warn' ? 'text-[#FBBF24]' : 'text-[#F2F3F5]'
  return (
    <span className="text-[#6B6F7A]">
      <span className={`tabular-nums ${color}`}>{value}</span> {label}
    </span>
  )
}

function Control({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-[#6B6F7A]">{label}</span>
      {children}
    </label>
  )
}

function Select({ name, value, options }: { name: string; value?: string; options: readonly string[] }) {
  return (
    <select
      name={name} defaultValue={value ?? ''}
      className="rounded border border-[#262A33] bg-[#13151C] px-2 py-1 text-xs text-[#F2F3F5] focus:border-[#A78BFA] focus:outline-none"
    >
      <option value="">any</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

function Results({ rows }: { rows: DecisionRow[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-[#1B1E26] bg-[#0D0E13]">
      <table className="w-full min-w-[56rem] text-sm">
        <thead>
          <tr className="border-b border-[#1B1E26] text-left text-[10px] uppercase tracking-wider text-[#6B6F7A]">
            <th className="px-4 py-2 font-medium">Company</th>
            <th className="px-4 py-2 font-medium">Decided</th>
            <th className="px-4 py-2 font-medium">Outcome</th>
            <th className="px-4 py-2 font-medium">Factor</th>
            <th className="px-4 py-2 text-right font-medium">Conf.</th>
            <th className="px-4 py-2 font-medium">Verdict</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#131519]">
          {rows.map(r => (
            <tr key={r.id} className="align-top hover:bg-[#13151C]">
              <td className="px-4 py-2.5">
                <Link
                  href={`/company/${encodeURIComponent(r.companyId)}`}
                  className="font-medium underline-offset-2 hover:text-[#A78BFA] hover:underline"
                >{r.company}</Link>
                {/* The reasoning is the row's real content — the rest is metadata. */}
                <p className="mt-1 max-w-xl text-xs leading-relaxed text-[#6B6F7A]">{r.reasoning}</p>
                {r.whatWouldChangeMind && (
                  <p className="mt-1 max-w-xl text-xs text-[#43474F]">
                    Would change my mind: {r.whatWouldChangeMind}
                  </p>
                )}
                {r.dissent && (
                  <span className="mt-1 inline-block rounded bg-[#FBBF24]/10 px-1.5 py-0.5 text-[10px] text-[#FBBF24]">
                    team disagreed
                  </span>
                )}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-[#A5A8B0]">{fmtDate(r.decidedAt)}</td>
              <td className="px-4 py-2.5">
                <span className={
                  r.outcome === 'Invest' ? 'text-[#34D399]'
                  : r.outcome === 'Pass' ? 'text-[#A5A8B0]' : 'text-[#22D3EE]'
                }>{r.outcome}</span>
              </td>
              <td className="px-4 py-2.5 text-[#A5A8B0]">{r.primaryFactor}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-[#A5A8B0]">{r.confidence}/5</td>
              <td className="px-4 py-2.5">
                {r.verdict ? (
                  <span className={
                    r.verdict === 'No' ? 'text-[#F87171]'
                    : r.verdict === 'Partially' ? 'text-[#FBBF24]' : 'text-[#34D399]'
                  }>
                    {r.verdict === 'No' ? 'reasoning wrong'
                     : r.verdict === 'Partially' ? 'partly right' : 'held up'}
                  </span>
                ) : r.resurfacedCount > 0 ? (
                  <span className="text-[#FBBF24]">awaiting verdict</span>
                ) : (
                  <span className="text-[#43474F]">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Pager({ sp, page, pages }: { sp: SP; page: number; pages: number }) {
  const to = (p: number) => {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(sp)) {
      const s = Array.isArray(v) ? v[0] : v
      if (s && k !== 'page') q.set(k, s)
    }
    if (p > 1) q.set('page', String(p))
    const s = q.toString()
    return s ? `/decisions?${s}` : '/decisions'
  }
  return (
    <div className="flex items-center justify-between text-xs">
      {page > 1
        ? <Link href={to(page - 1)} className="text-[#22D3EE] hover:underline">← Newer</Link>
        : <span className="text-[#43474F]">← Newer</span>}
      <span className="tabular-nums text-[#6B6F7A]">{PAGE_SIZE} per page</span>
      {page < pages
        ? <Link href={to(page + 1)} className="text-[#22D3EE] hover:underline">Older →</Link>
        : <span className="text-[#43474F]">Older →</span>}
    </div>
  )
}

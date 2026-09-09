/**
 * /screen — the mouth of the funnel.
 *
 * 11,000 tracked companies were unreachable: /pipeline only shows what you
 * already added, and adding one meant typing a name you already knew. This
 * turns the reference layer into deal flow — filter to what is actually
 * fundable, then pull it onto the board in one click.
 */

import Link from 'next/link'
import { parseScreenFilters, screenCompanies, PAGE_SIZE } from '@/lib/screen-data'
import type { ScreenRow } from '@/lib/screen-data'
import AddToPipeline from '@/components/terminal/add-to-pipeline'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Screen — Compute Circuit' }

type SP = Record<string, string | string[] | undefined>

/** The shapes worth one click. */
const PRESETS = [
  { label: 'Fundable now', href: '/screen?status=Active&maxTeam=15&batch=Summer%202026',
    hint: 'newest YC batch, still small, still alive' },
  { label: 'Small & active', href: '/screen?status=Active&maxTeam=10',
    hint: 'under 10 people across every batch' },
  { label: 'Acquired', href: '/screen?status=Acquired',
    hint: 'outcomes — what a good one looked like early' },
  { label: 'Died', href: '/screen?status=Inactive',
    hint: 'the base rate nobody studies' },
]

export default async function ScreenPage({ searchParams }: { searchParams: SP }) {
  const f = parseScreenFilters(searchParams)
  const res = await screenCompanies(f)

  return (
    <main className="min-h-screen bg-[#05060a] px-4 py-6 text-[#F2F3F5] sm:px-8 sm:py-8">
      <div className="mx-auto max-w-6xl space-y-5">

        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Screen</h1>
            <p className="mt-0.5 text-xs text-[#6B6F7A]">
              Every tracked company. Filter to what you could actually fund, then pull it onto the board.
            </p>
          </div>
          <nav className="flex items-center gap-3 text-xs text-[#6B6F7A]">
            <Link href="/terminal" className="underline-offset-2 hover:text-[#A5A8B0] hover:underline">Terminal</Link>
            <Link href="/fund" className="underline-offset-2 hover:text-[#A5A8B0] hover:underline">Fund</Link>
            <Link href="/pipeline" className="underline-offset-2 hover:text-[#A5A8B0] hover:underline">Pipeline</Link>
            <Link href="/decisions" className="underline-offset-2 hover:text-[#A5A8B0] hover:underline">Decisions</Link>
          </nav>
        </header>

        <div className="flex flex-wrap gap-2">
          {PRESETS.map(p => (
            <Link key={p.href} href={p.href} title={p.hint}
              className="rounded-full border border-[#262A33] bg-[#13151C] px-3 py-1 text-xs text-[#A5A8B0] transition-colors hover:bg-[#1B1E26] hover:text-[#F2F3F5]">
              {p.label}
            </Link>
          ))}
        </div>

        <form method="GET" action="/screen" className="flex flex-wrap items-end gap-2">
          <Field label="Backed by">
            <select name="backer" defaultValue={f.backer ?? ''} className={SEL}>
              <option value="">any fund</option>
              {res.facets.investors.map(i => (
                <option key={i.id} value={i.id}>{i.name} ({i.n})</option>
              ))}
            </select>
          </Field>
          <Field label="YC batch">
            <select name="batch" defaultValue={f.batch ?? ''} className={SEL}>
              <option value="">any</option>
              {res.facets.batches.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select name="status" defaultValue={f.status ?? ''} className={SEL}>
              <option value="">any</option>
              {['Active', 'Acquired', 'Inactive', 'Public'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Max team">
            <input name="maxTeam" type="number" min={1} defaultValue={f.maxTeam ?? ''} placeholder="any"
              className={`${SEL} w-20 tabular-nums`} />
          </Field>
          <Field label="Sector">
            <select name="sector" defaultValue={f.sector ?? ''} className={SEL}>
              <option value="">any</option>
              {res.facets.sectors.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Name contains">
            <input name="q" defaultValue={f.q ?? ''} placeholder="search…" className={`${SEL} w-36`} />
          </Field>
          <label className="flex items-center gap-1.5 pb-1 text-[11px] text-[#A5A8B0]">
            <input type="checkbox" name="showAll" value="true" defaultChecked={!f.hideInPipeline}
              className="h-3.5 w-3.5 accent-[#A78BFA]" />
            include pipeline
          </label>
          <button className="rounded bg-[#A78BFA] px-3 py-1.5 text-xs font-medium text-[#0A0B0F]">Filter</button>
          <Link href="/screen" className="px-2 py-1.5 text-xs text-[#6B6F7A] underline hover:text-[#A5A8B0]">Reset</Link>
        </form>

        {res.error ? (
          <Panel className="border-[#F87171]/30">
            <p className="text-sm text-[#F87171]">Screen unavailable.</p>
            <p className="mt-1 font-mono text-[11px] text-[#6B6F7A]">{res.error}</p>
          </Panel>
        ) : res.rows.length === 0 ? (
          <Panel>
            <p className="text-sm text-[#6B6F7A]">
              {res.total === 0
                ? 'No companies match these filters.'
                : 'Every company on this page is already in your pipeline. Tick “include pipeline” to see them.'}
            </p>
          </Panel>
        ) : (
          <>
            <p className="text-xs text-[#6B6F7A]">
              <span className="tabular-nums text-[#A5A8B0]">{res.total.toLocaleString('en-US')}</span> match
              {res.pages > 1 && <> · page <span className="tabular-nums">{res.page}</span> of <span className="tabular-nums">{res.pages.toLocaleString('en-US')}</span></>}
              {f.hideInPipeline && <span className="text-[#43474F]"> · already-sourced names hidden</span>}
            </p>

            <div className="grid gap-2 sm:grid-cols-2">
              {res.rows.map(r => <Card key={r.id} r={r} />)}
            </div>

            {res.pages > 1 && <Pager sp={searchParams} page={res.page} pages={res.pages} />}
          </>
        )}
      </div>
    </main>
  )
}

const SEL = 'rounded border border-[#262A33] bg-[#13151C] px-2 py-1 text-xs text-[#F2F3F5] placeholder:text-[#43474F] focus:border-[#A78BFA] focus:outline-none'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-[#6B6F7A]">{label}</span>
      {children}
    </label>
  )
}

function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-[#1B1E26] bg-[#0D0E13] px-4 py-4 ${className}`}>{children}</div>
}

function Card({ r }: { r: ScreenRow }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-[#1B1E26] bg-[#0D0E13] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/company/${encodeURIComponent(r.id)}`}
            className="font-medium underline-offset-2 hover:text-[#A78BFA] hover:underline">
            {r.name}
          </Link>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[#6B6F7A]">
            {r.yc?.batch && <span>{r.yc.batch}</span>}
            {r.yc?.status && (
              <span className={
                r.yc.status === 'Acquired' ? 'text-[#22D3EE]'
                : r.yc.status === 'Public' ? 'text-[#34D399]'
                : r.yc.status === 'Inactive' ? 'text-[#F87171]' : 'text-[#A5A8B0]'
              }>{r.yc.status}</span>
            )}
            {r.yc?.team_size != null && <span className="tabular-nums">{r.yc.team_size}p</span>}
            {r.sector && <span>{r.sector}</span>}
            {r.fundingRounds > 0 && (
              <span className="text-[#34D399]">
                <span className="tabular-nums">{r.fundingRounds}</span> Form D
              </span>
            )}
          </div>
        </div>
        <AddToPipeline companyId={r.id} name={r.name} already={r.inPipeline} />
      </div>

      {r.yc?.one_liner && (
        <p className="line-clamp-2 text-xs leading-relaxed text-[#A5A8B0]">{r.yc.one_liner}</p>
      )}

      {r.backers.length > 0 && (
        <p className="text-[10px] text-[#43474F]">
          {/* Crowding at a glance: who is already in, before you spend time on it. */}
          {r.backers.slice(0, 4).join(' · ')}
          {r.backers.length > 4 && ` +${r.backers.length - 4}`}
        </p>
      )}
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
    return s ? `/screen?${s}` : '/screen'
  }
  return (
    <div className="flex items-center justify-between text-xs">
      {page > 1 ? <Link href={to(page - 1)} className="text-[#22D3EE] hover:underline">← Previous</Link>
                : <span className="text-[#43474F]">← Previous</span>}
      <span className="tabular-nums text-[#6B6F7A]">{PAGE_SIZE} per page</span>
      {page < pages ? <Link href={to(page + 1)} className="text-[#22D3EE] hover:underline">Next →</Link>
                    : <span className="text-[#43474F]">Next →</span>}
    </div>
  )
}

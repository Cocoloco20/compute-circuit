/**
 * /terminal — the Morning Terminal.
 *
 * The one screen the fund opens first: what changed overnight, what needs a
 * decision today, and what past decision just came due for judgement. Zone
 * order is fixed by the build spec and is not a layout preference — it's the
 * order the morning is actually worked in.
 *
 *   0  stale banner      is what I'm looking at current?
 *   1  alert stripe      what is on fire
 *   1.5 resurfaced       a past pass that the world just answered
 *   2  decision queue    the work, max 5
 *   3  portfolio heat    what I hold and where it sits
 *   4  pipeline snapshot the funnel at a glance
 *   5  commit log        what happened while I slept
 *
 * Additive and independent: this route shares no code path with `/`, which
 * renders the 3D graph through fetchGraph(). Nothing here touches that.
 *
 * Reads run under the SERVICE ROLE (see terminal-data.ts) because the
 * decision tables are RLS-locked with zero policies. The page is a server
 * component, so the key never reaches the browser.
 */

import Link from 'next/link'
import {
  fetchTerminal, zoneFailed, STALE_DATA_HOURS, STALE_STAGE_DAYS, UNREVIEWED_DAYS,
  type Zone, type HeatCell, type ResurfaceCard, type QueueRow,
} from '@/lib/terminal-data'
import type { CommitLogEntry } from '@/types/db'
import DecisionCapture from '@/components/terminal/decision-capture'
import ResurfaceVerdictButtons from '@/components/terminal/resurface-verdict'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Terminal — Compute Circuit' }

// ---------------------------------------------------------------- helpers

function hoursSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 3_600_000
}

function ago(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function stamp(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

function fmtDate(d: string): string {
  return new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ------------------------------------------------------------- primitives

function Section({ id, title, meta, children }: {
  id: string; title: string; meta?: React.ReactNode; children: React.ReactNode
}) {
  return (
    <section id={id} className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6B6F7A]">{title}</h2>
        {meta && <div className="text-[11px] text-[#43474F]">{meta}</div>}
      </div>
      {children}
    </section>
  )
}

function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-[#1B1E26] bg-[#0D0E13] ${className}`}>{children}</div>
  )
}

/** Empty and error states are content, not placeholders — never a skeleton. */
function Empty({ children }: { children: React.ReactNode }) {
  return <Panel className="px-4 py-6 text-sm text-[#6B6F7A]">{children}</Panel>
}

function Failed({ zone }: { zone: { message: string } }) {
  return (
    <Panel className="border-[#F87171]/30 px-4 py-3">
      <p className="text-sm text-[#F87171]">Failed to load — showing nothing rather than something wrong.</p>
      <p className="mt-1 font-mono text-[11px] text-[#6B6F7A]">{zone.message}</p>
    </Panel>
  )
}

// ------------------------------------------------------------------- page

export default async function TerminalPage() {
  const d = await fetchTerminal()
  const stale = d.dataAsOf ? hoursSince(d.dataAsOf) > STALE_DATA_HOURS : false

  return (
    <main className="min-h-screen bg-[#05060a] px-4 py-6 text-[#F2F3F5] sm:px-8 sm:py-8">
      <div className="mx-auto max-w-5xl space-y-7">

        {/* header ------------------------------------------------------- */}
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Terminal</h1>
            <p className="mt-0.5 text-xs text-[#6B6F7A]">
              Dry powder:{' '}
              <span className="tabular-nums text-[#A5A8B0]">
                {d.dryPowderUsd == null
                  ? '—'
                  : `$${(d.dryPowderUsd / 1e6).toFixed(1)}M`}
              </span>
              {d.dryPowderUsd == null && <span className="ml-1 text-[#43474F]">(fund financials land in Milestone 2)</span>}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/screen" className="text-xs text-[#6B6F7A] underline-offset-2 hover:text-[#A5A8B0] hover:underline">
              Screen
            </Link>
            <Link href="/decisions" className="text-xs text-[#6B6F7A] underline-offset-2 hover:text-[#A5A8B0] hover:underline">
              Decisions
            </Link>
            <Link href="/pipeline" className="text-xs text-[#6B6F7A] underline-offset-2 hover:text-[#A5A8B0] hover:underline">
              Pipeline
            </Link>
            <Link href="/" className="text-xs text-[#6B6F7A] underline-offset-2 hover:text-[#A5A8B0] hover:underline">
              Graph
            </Link>
            <DecisionCapture />
          </div>
        </header>

        {/* zone 0 — freshness ------------------------------------------- */}
        {d.dataAsOf ? (
          <p className={`text-[11px] ${stale ? 'text-[#FBBF24]' : 'text-[#43474F]'}`}>
            Data as of <span className="tabular-nums">{stamp(d.dataAsOf)}</span>
            {stale && <> · <span className="tabular-nums">{Math.floor(hoursSince(d.dataAsOf))}h</span> stale</>}
          </p>
        ) : (
          <p className="text-[11px] text-[#43474F]">No ingestion timestamp yet.</p>
        )}

        {/* zone 1 — alert stripe (renders only when count > 0) ----------- */}
        {d.alerts.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {d.alerts.map(a => (
              <Link
                key={a.kind}
                href={a.href}
                className="flex items-center gap-1.5 rounded-full border border-[#FBBF24]/30 bg-[#FBBF24]/10 px-3 py-1 text-xs text-[#FBBF24] transition-colors hover:bg-[#FBBF24]/20"
              >
                <span className="tabular-nums font-medium">{a.count}</span>
                <span>{a.label}</span>
              </Link>
            ))}
          </div>
        )}

        {/* zone 1.5 — resurfaced decisions ------------------------------ */}
        <Section
          id="resurfaced"
          title="Resurfaced"
          meta={<>unjudged past {UNREVIEWED_DAYS}d is an alert</>}
        >
          <ResurfacedZone zone={d.resurfaced} />
        </Section>

        {/* zone 2 — decision queue -------------------------------------- */}
        <Section id="queue" title="Decision queue" meta="max 5 · due today or at term sheet">
          <QueueZone zone={d.queue} />
        </Section>

        {/* zone 3 — portfolio heat -------------------------------------- */}
        <Section id="portfolio" title="Portfolio heat">
          <HeatZone zone={d.heat} />
        </Section>

        {/* zone 4 — pipeline snapshot ----------------------------------- */}
        <Section id="pipeline" title="Pipeline">
          <PipelineZone zone={d.pipeline} />
        </Section>

        {/* zone 5 — commit log ------------------------------------------ */}
        <Section id="log" title="Commit log" meta="last 10 mutations">
          <CommitZone zone={d.commits} />
        </Section>
      </div>
    </main>
  )
}

// ------------------------------------------------------------------ zones

function ResurfacedZone({ zone }: { zone: Zone<ResurfaceCard[]> }) {
  if (zoneFailed(zone)) return <Failed zone={zone} />
  if (!zone.length) {
    return (
      <Empty>
        No resurfaced decisions. Cards appear here when a company you passed on
        raises, gets acquired, files an S-1, or shuts down.
      </Empty>
    )
  }
  return (
    <div className="space-y-2">
      {zone.map(r => (
        <Panel key={r.id} className="p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-medium">
              {r.company} — you {r.outcome === 'Pass' ? 'passed' : r.outcome.toLowerCase()}{' '}
              <span className="text-[#6B6F7A]">
                ({new Date(r.decidedAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })})
              </span>
            </h3>
            {r.daysWaiting > UNREVIEWED_DAYS && (
              <span className="rounded-full bg-[#FBBF24]/10 px-2 py-0.5 text-[10px] text-[#FBBF24]">
                triggered <span className="tabular-nums">{r.daysWaiting}d</span> ago — not yet reviewed
              </span>
            )}
          </div>

          <blockquote className="mt-2 border-l-2 border-[#262A33] pl-3 text-sm leading-relaxed text-[#A5A8B0]">
            {r.reasoning}
          </blockquote>
          <p className="mt-1.5 text-[11px] text-[#6B6F7A]">
            {r.primaryFactor} · confidence <span className="tabular-nums">{r.confidence}</span>/5
          </p>

          <div className="mt-3 border-t border-[#1B1E26] pt-3">
            <p className="text-sm text-[#F2F3F5]">
              <span className="text-[#6B6F7A]">What happened: </span>
              {r.triggerSummary}
              {r.triggerDate && <span className="text-[#6B6F7A]"> ({fmtDate(r.triggerDate)})</span>}
            </p>
            {r.triggerUrl && (
              <a
                href={r.triggerUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block text-[11px] text-[#22D3EE] hover:underline"
              >Source</a>
            )}
          </div>

          <div className="mt-3">
            <ResurfaceVerdictButtons resurfacingId={r.id} />
          </div>
        </Panel>
      ))}
    </div>
  )
}

function QueueZone({ zone }: { zone: Zone<QueueRow[]> }) {
  if (zoneFailed(zone)) return <Failed zone={zone} />
  if (!zone.length) {
    return <Empty>No decisions today. Nothing is past its deadline and nothing sits at term sheet.</Empty>
  }
  return (
    <Panel className="overflow-x-auto">
      <table className="w-full min-w-[42rem] text-sm">
        <thead>
          <tr className="border-b border-[#1B1E26] text-left text-[10px] uppercase tracking-wider text-[#6B6F7A]">
            <th className="px-4 py-2 font-medium">Company</th>
            <th className="px-4 py-2 font-medium">Stage</th>
            <th className="px-4 py-2 font-medium">Action needed</th>
            <th className="px-4 py-2 text-right font-medium">Deadline</th>
            <th className="px-4 py-2 text-right font-medium">In stage</th>
            <th className="px-4 py-2 font-medium">Owner</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#131519]">
          {zone.map(r => (
            <tr key={r.companyId} className="hover:bg-[#13151C]">
              <td className="px-4 py-2.5">
                <span className="font-medium">{r.company}</span>
                {r.sector && <span className="ml-2 text-[11px] text-[#6B6F7A]">{r.sector}</span>}
              </td>
              <td className="px-4 py-2.5 text-[#A5A8B0]">{r.stage}</td>
              <td className="px-4 py-2.5 text-[#A5A8B0]">{r.actionNeeded ?? '—'}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">
                {r.deadline ? (
                  <span className={r.reason === 'overdue' ? 'text-[#F87171]' : 'text-[#A5A8B0]'}>
                    {fmtDate(r.deadline)}
                  </span>
                ) : <span className="text-[#43474F]">—</span>}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums">
                <span className={r.daysInStage > STALE_STAGE_DAYS ? 'text-[#F87171]' : 'text-[#6B6F7A]'}>
                  {r.daysInStage}d
                </span>
              </td>
              <td className="px-4 py-2.5 text-[#6B6F7A]">{r.owner ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  )
}

function HeatZone({ zone }: { zone: Zone<HeatCell[]> }) {
  if (zoneFailed(zone)) return <Failed zone={zone} />
  if (!zone.length) {
    return <Empty>No positions. Marks appear here once a watchlist entry has shares and a cost basis.</Empty>
  }
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {zone.map(c => {
        const up = (c.pctSinceCost ?? 0) >= 0
        const priceStale = c.priceUpdatedAt ? hoursSince(c.priceUpdatedAt) > 24 : true
        return (
          <Panel key={c.companyId} className="px-3 py-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-xs font-medium">{c.name}</span>
              {c.ticker && <span className="text-[10px] text-[#43474F]">{c.ticker.toUpperCase()}</span>}
            </div>
            <p className={`mt-1 text-lg tabular-nums ${
              c.pctSinceCost == null ? 'text-[#43474F]' : up ? 'text-[#34D399]' : 'text-[#F87171]'
            }`}>
              {c.pctSinceCost == null
                ? '—'
                : `${up ? '+' : ''}${c.pctSinceCost.toFixed(1)}%`}
            </p>
            <Spark values={c.history} up={up} />
            <p className="mt-1 text-[10px] text-[#43474F]">
              {c.lastPrice == null ? 'no price' : (
                <>
                  <span className="tabular-nums">{c.lastPrice.toFixed(2)}</span>
                  {c.priceUpdatedAt && (
                    <span className={priceStale ? ' text-[#FBBF24]' : ''}>
                      {' '}· {ago(c.priceUpdatedAt)}
                    </span>
                  )}
                </>
              )}
            </p>
          </Panel>
        )
      })}
    </div>
  )
}

/** 30-day close sparkline. Flat or single-point series renders a baseline. */
function Spark({ values, up }: { values: number[]; up: boolean }) {
  if (values.length < 2) return <div className="mt-1.5 h-6" />
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pts = values.map((v, i) =>
    `${(i / (values.length - 1)) * 100},${24 - ((v - min) / span) * 22}`).join(' ')
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="mt-1.5 h-6 w-full" aria-hidden>
      <polyline
        points={pts}
        fill="none"
        stroke={up ? '#34D399' : '#F87171'}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

function PipelineZone({ zone }: { zone: Zone<Array<{ stage: string; count: number }>> }) {
  if (zoneFailed(zone)) return <Failed zone={zone} />
  const total = zone.reduce((n, s) => n + s.count, 0)
  if (!total) {
    return <Empty>Pipeline is empty. Add a company to Sourcing to start the funnel.</Empty>
  }
  return (
    <Panel className="flex flex-wrap divide-x divide-[#1B1E26]">
      {zone.map(s => (
        <div key={s.stage} className="min-w-[7rem] flex-1 px-4 py-3">
          <p className="text-[10px] uppercase tracking-wider text-[#6B6F7A]">{s.stage}</p>
          <p className={`mt-0.5 text-xl tabular-nums ${s.count ? 'text-[#F2F3F5]' : 'text-[#43474F]'}`}>
            {s.count}
          </p>
        </div>
      ))}
    </Panel>
  )
}

function CommitZone({ zone }: { zone: Zone<CommitLogEntry[]> }) {
  if (zoneFailed(zone)) return <Failed zone={zone} />
  if (!zone.length) {
    return <Empty>No activity yet. Every stage change, decision and note lands here.</Empty>
  }
  return (
    <Panel className="divide-y divide-[#131519]">
      {zone.map(e => (
        <div key={e.id} className="flex items-baseline gap-3 px-4 py-2 text-sm">
          <span className="w-16 shrink-0 tabular-nums text-[11px] text-[#43474F]">{ago(e.created_at)}</span>
          <span className="text-[#A5A8B0]">{e.summary}</span>
        </div>
      ))}
    </Panel>
  )
}

/**
 * /company/[id] — everything known about one company, before you decide.
 *
 * The ordering is the argument: who else is in, what the world has done
 * lately, and what YOU already concluded — with how each conclusion turned
 * out. Your own decision history sits above the signal feed on purpose. The
 * most useful thing before deciding again is what you thought last time and
 * whether it held.
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { fetchCompany, verdictLabel } from '@/lib/company-data'
import type { SignalItem, DecisionWithVerdicts } from '@/lib/company-data'
import DecisionCapture from '@/components/terminal/decision-capture'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: { id: string } }) {
  const c = await fetchCompany(params.id).catch(() => null)
  return { title: c ? `${c.header.name} — Offtake` : 'Company — Offtake' }
}

function fmtDate(d: string): string {
  const iso = d.length === 10 ? `${d}T12:00:00` : d
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

export default async function CompanyPage({ params }: { params: { id: string } }) {
  const data = await fetchCompany(params.id)
  if (!data) notFound()
  const { header: h, backers, yc, card, decisions, signals, notes, brief } = data

  return (
    <main className="min-h-screen bg-[#05060a] px-4 py-6 text-[#F2F3F5] sm:px-8 sm:py-8">
      <div className="mx-auto max-w-4xl space-y-6">

        <nav className="flex items-center gap-3 text-xs text-[#6B6F7A]">
          <Link href="/terminal" className="underline-offset-2 hover:text-[#A5A8B0] hover:underline">Terminal</Link>
          <Link href="/pipeline" className="underline-offset-2 hover:text-[#A5A8B0] hover:underline">Pipeline</Link>
          <Link href="/decisions" className="underline-offset-2 hover:text-[#A5A8B0] hover:underline">Decisions</Link>
        </nav>

        {/* header ------------------------------------------------------- */}
        <header className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div className="flex flex-wrap items-baseline gap-2.5">
              <h1 className="text-xl font-semibold tracking-tight">{h.name}</h1>
              {h.ticker && (
                <span className="rounded border border-[#262A33] px-1.5 py-0.5 text-[11px] tabular-nums text-[#A5A8B0]">
                  {h.ticker.toUpperCase()}
                </span>
              )}
              <span className="text-[11px] text-[#6B6F7A]">{h.isPrivate ? 'private' : 'public'}</span>
            </div>
            <DecisionCapture presetCompany={{ id: h.id, name: h.name }} />
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#6B6F7A]">
            {h.sector && <span>{h.sector}</span>}
            {h.country && <span>{h.country}</span>}
            {h.domain && (
              <a href={`https://${h.domain}`} target="_blank" rel="noreferrer" className="text-[#22D3EE] hover:underline">
                {h.domain}
              </a>
            )}
            {h.lastPrice != null && (
              <span className="tabular-nums text-[#A5A8B0]">${h.lastPrice.toFixed(2)}</span>
            )}
            {card && (
              <span className="rounded bg-[#A78BFA]/15 px-1.5 py-0.5 text-[#F2F3F5]">
                pipeline: {card.stage}
              </span>
            )}
            {h.discoveredVia && (
              <span className="text-[#43474F]">surfaced via {h.discoveredVia}</span>
            )}
          </div>
        </header>

        {/* backers — the reference layer earning its keep ---------------- */}
        <Section title="Backers" meta={backers.length ? `${backers.length} on file` : undefined}>
          {backers.length ? (
            <div className="flex flex-wrap gap-2">
              {backers.map(b => (
                <span key={b.id} className="rounded-full border border-[#262A33] bg-[#13151C] px-3 py-1 text-xs text-[#A5A8B0]">
                  {b.name}
                </span>
              ))}
            </div>
          ) : (
            <Empty>
              No backer on file. That means no tracked fund&apos;s portfolio or Form D names this
              company — not that it is unbacked.
            </Empty>
          )}
        </Section>

        {yc && (
          <Section title="Y Combinator">
            <Panel className="flex flex-wrap items-baseline gap-x-5 gap-y-1 px-4 py-3 text-xs">
              <span className="text-[#F2F3F5]">{yc.batch}</span>
              <span className={
                yc.status === 'Acquired' ? 'text-[#22D3EE]'
                : yc.status === 'Public' ? 'text-[#34D399]'
                : yc.status === 'Inactive' ? 'text-[#F87171]' : 'text-[#A5A8B0]'
              }>{yc.status}</span>
              {yc.industry && <span className="text-[#6B6F7A]">{yc.industry}</span>}
              {yc.team_size != null && (
                <span className="tabular-nums text-[#6B6F7A]">{yc.team_size} people</span>
              )}
              {yc.one_liner && <span className="w-full text-[#A5A8B0]">{yc.one_liner}</span>}
            </Panel>
          </Section>
        )}

        {/* What the company says it does — read from its own homepage. This
            sits above our thesis because it is the primary source and ours is
            the interpretation. */}
        {brief && (brief.description || brief.headline || brief.title) && (
          <Section
            /* The heading is a claim about provenance, so it changes with the
               source. Wikipedia describing a company is not the company
               describing itself, and presenting one as the other would make
               this section quietly dishonest. */
            title={brief.source === 'wikipedia' ? 'What Wikipedia says they do' : 'What they say they do'}
            meta={brief.fetched_at ? `read ${fmtDate(brief.fetched_at)}` : undefined}
          >
            <Panel className="px-4 py-3">
              {brief.headline && (
                <p className="text-sm font-medium leading-relaxed text-[#F2F3F5]">{brief.headline}</p>
              )}
              {brief.description && (
                <p className={`text-sm leading-relaxed text-[#A5A8B0] ${brief.headline ? 'mt-1.5' : ''}`}>
                  {brief.description}
                </p>
              )}
              {!brief.headline && !brief.description && brief.title && (
                <p className="text-sm text-[#A5A8B0]">{brief.title}</p>
              )}
              {brief.url && (
                <a href={brief.url} target="_blank" rel="noreferrer"
                   className="mt-2 inline-block text-[11px] text-[#22D3EE] hover:underline">
                  {brief.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                </a>
              )}
            </Panel>
          </Section>
        )}

        {brief && brief.fetch_status !== 'ok' && (
          <Section title="What they say they do">
            <Empty>
              {/* A dead domain is itself information about a company. */}
              Couldn&apos;t read the homepage ({brief.fetch_status.replace('_', ' ')}
              {brief.http_status ? ` ${brief.http_status}` : ''}), and no Wikipedia entry matched
              this company confidently enough to stand in.
              {brief.fetch_status === 'dns_error' && ' The domain does not resolve — worth knowing on its own.'}
            </Empty>
          </Section>
        )}

        {h.thesis && (
          <Section title="Thesis">
            <Panel className="px-4 py-3">
              <p className="text-sm leading-relaxed text-[#A5A8B0]">{h.thesis}</p>
              {h.thesisRisk && (
                <p className="mt-2 border-t border-[#1B1E26] pt-2 text-xs leading-relaxed text-[#6B6F7A]">
                  <span className="text-[#FBBF24]">Risk: </span>{h.thesisRisk}
                </p>
              )}
            </Panel>
          </Section>
        )}

        {/* your own record, above the news ------------------------------- */}
        <Section
          title="Your decisions"
          meta={decisions.length ? `${decisions.length} recorded` : undefined}
        >
          {decisions.length ? (
            <div className="space-y-2">{decisions.map(d => <DecisionCard key={d.id} d={d} />)}</div>
          ) : (
            <Empty>
              Nothing recorded on {h.name} yet. Capture one with{' '}
              <kbd className="rounded border border-[#262A33] px-1">d</kbd> — the reasoning is
              only worth anything if it is written down before the outcome is known.
            </Empty>
          )}
        </Section>

        <Section title="Signals" meta={signals.length ? `${signals.length} most recent` : undefined}>
          {signals.length ? (
            <Panel className="divide-y divide-[#131519]">
              {signals.map((s, i) => <SignalRow key={`${s.date}-${i}`} s={s} />)}
            </Panel>
          ) : (
            <Empty>No filings, rounds or news on file for this company.</Empty>
          )}
        </Section>

        {notes.length > 0 && (
          <Section title="Notes">
            <Panel className="divide-y divide-[#131519]">
              {notes.map(n => (
                <div key={n.id} className="px-4 py-2.5">
                  <p className="text-sm text-[#A5A8B0]">{n.body}</p>
                  <p className="mt-1 text-[10px] text-[#43474F]">
                    {n.author} · {fmtDate(n.created_at)}
                  </p>
                </div>
              ))}
            </Panel>
          </Section>
        )}
      </div>
    </main>
  )
}

// ---------------------------------------------------------------- pieces

function Section({ title, meta, children }: {
  title: string; meta?: string; children: React.ReactNode
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6B6F7A]">{title}</h2>
        {meta && <span className="text-[11px] tabular-nums text-[#43474F]">{meta}</span>}
      </div>
      {children}
    </section>
  )
}

function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-[#1B1E26] bg-[#0D0E13] ${className}`}>{children}</div>
}

function Empty({ children }: { children: React.ReactNode }) {
  return <Panel className="px-4 py-4 text-xs leading-relaxed text-[#6B6F7A]">{children}</Panel>
}

function DecisionCard({ d }: { d: DecisionWithVerdicts }) {
  return (
    <Panel className="p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className={
          d.outcome === 'Invest' ? 'text-sm font-medium text-[#34D399]'
          : d.outcome === 'Pass' ? 'text-sm font-medium text-[#A5A8B0]'
          : 'text-sm font-medium text-[#22D3EE]'
        }>{d.outcome}</span>
        <span className="text-[11px] tabular-nums text-[#6B6F7A]">{fmtDate(d.decided_at)}</span>
      </div>

      <p className="mt-2 text-sm leading-relaxed text-[#F2F3F5]">{d.reasoning}</p>
      {d.what_would_change_mind && (
        <p className="mt-1.5 text-xs text-[#6B6F7A]">
          <span className="text-[#43474F]">Would change my mind: </span>
          {d.what_would_change_mind}
        </p>
      )}
      <p className="mt-2 text-[11px] text-[#6B6F7A]">
        {d.primary_factor} · confidence <span className="tabular-nums">{d.confidence}</span>/5
        {d.dissent && <span className="ml-2 text-[#FBBF24]">team disagreed</span>}
      </p>

      {d.resurfacings.length > 0 && (
        <div className="mt-3 space-y-1.5 border-t border-[#1B1E26] pt-2.5">
          {d.resurfacings.map(r => (
            <div key={r.id} className="text-xs">
              <span className={
                r.verdict === 'No' ? 'text-[#F87171]'
                : r.verdict === 'Partially' ? 'text-[#FBBF24]'
                : r.verdict === 'Yes' ? 'text-[#34D399]' : 'text-[#6B6F7A]'
              }>{verdictLabel(r.verdict)}</span>
              <span className="text-[#6B6F7A]"> — {r.trigger_summary}</span>
              {r.trigger_date && <span className="text-[#43474F]"> ({fmtDate(r.trigger_date)})</span>}
              {r.trigger_url && (
                <a href={r.trigger_url} target="_blank" rel="noreferrer" className="ml-1.5 text-[#22D3EE] hover:underline">
                  source
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}

function SignalRow({ s }: { s: SignalItem }) {
  const tone = s.kind === 'FundingRound' ? 'text-[#34D399]'
    : s.kind === 'Filing' ? 'text-[#FB923C]' : 'text-[#22D3EE]'
  return (
    <div className="flex items-baseline gap-3 px-4 py-2 text-sm">
      <span className="w-20 shrink-0 tabular-nums text-[11px] text-[#43474F]">{fmtDate(s.date)}</span>
      <span className={`w-24 shrink-0 text-[11px] ${tone}`}>{s.kind}</span>
      <span className="min-w-0 flex-1">
        {s.url ? (
          <a href={s.url} target="_blank" rel="noreferrer" className="text-[#A5A8B0] hover:text-[#F2F3F5] hover:underline">
            {s.title}
          </a>
        ) : <span className="text-[#A5A8B0]">{s.title}</span>}
        {s.detail && <span className="ml-2 text-[11px] text-[#43474F]">{s.detail}</span>}
      </span>
    </div>
  )
}

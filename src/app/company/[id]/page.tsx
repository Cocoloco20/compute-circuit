/**
 * /company/[id] — everything known about one company, in one read.
 *
 * The ordering is the argument: who backs it, what it says it does, what it
 * has contracted (the ledger rows naming it, as provider and as customer),
 * then what the world has done lately. Contracts sit above the signal feed
 * because a signed MW/GPU/$ commitment is a harder fact than a headline.
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { fetchCompany } from '@/lib/company-data'
import type { SignalItem } from '@/lib/company-data'
import { fetchCompanyLedger, ledgerTotals, KIND_LABEL, STATUS_LABEL, type LedgerRow } from '@/lib/contract-ledger-data'
import { usd } from '@/lib/format'

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
  const [data, ledger] = await Promise.all([fetchCompany(params.id), fetchCompanyLedger(params.id)])
  if (!data) notFound()
  const { header: h, backers, yc, signals, brief } = data

  return (
    <main className="min-h-screen bg-[#05060a] px-4 py-6 text-[#F2F3F5] sm:px-8 sm:py-8">
      <div className="mx-auto max-w-4xl space-y-6">

        <nav className="flex items-center gap-3 text-xs text-[#6B6F7A]">
          <Link href="/contracts" className="underline-offset-2 hover:text-[#A5A8B0] hover:underline">Ledger</Link>
          <Link href="/graph" className="underline-offset-2 hover:text-[#A5A8B0] hover:underline">Graph</Link>
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

        {/* contracts — the ledger rows naming this company ------------- */}
        <LedgerSection
          title="Contracts as provider"
          rows={ledger.asProvider}
          counterparty="customer"
          moreHref={`/contracts?provider=${encodeURIComponent(h.id)}`}
          empty={`No filing on file discloses ${h.name} as the party delivering capacity, hosting, power or equipment.`}
        />
        <LedgerSection
          title="Contracts as customer"
          rows={ledger.asCustomer}
          counterparty="provider"
          moreHref={`/contracts?customer=${encodeURIComponent(h.id)}`}
          empty={`No filing on file names ${h.name} as the buyer of disclosed capacity. Undisclosed counterparties ("a hyperscaler") are not attributed.`}
        />
        {ledger.asGuarantor.length > 0 && (
          <LedgerSection
            title="Contracts as guarantor"
            rows={ledger.asGuarantor}
            counterparty="both"
            moreHref={`/contracts?q=${encodeURIComponent(h.name)}`}
            empty=""
          />
        )}

        <Section title="Signals" meta={signals.length ? `${signals.length} most recent` : undefined}>
          {signals.length ? (
            <Panel className="divide-y divide-[#131519]">
              {signals.map((s, i) => <SignalRow key={`${s.date}-${i}`} s={s} />)}
            </Panel>
          ) : (
            <Empty>No filings, rounds or news on file for this company.</Empty>
          )}
        </Section>

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


function fmtIso(d: string | null): string {
  if (!d) return '—'
  return new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
}
function mw(n: number | null): string {
  if (n == null) return '—'
  return n >= 1000 ? `${(n / 1000).toFixed(2)} GW` : `${Math.round(n).toLocaleString('en-US')} MW`
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

function Party({ id, name, muted }: { id: string | null; name: string; muted?: boolean }) {
  if (id) return <Link href={`/company/${id}`} className="hover:underline">{name}</Link>
  return <span className={muted ? 'text-[#6B6F7A]' : ''}>{name}</span>
}

/**
 * The ledger rows that name this company, in one role. Same columns as
 * /contracts minus the ones fixed by context, and the same excerpt-under-
 * the-row pattern so every number can be checked against its sentence.
 */
function LedgerSection({ title, rows, counterparty, moreHref, empty }: {
  title: string; rows: LedgerRow[]; counterparty: 'customer' | 'provider' | 'both'; moreHref: string; empty: string
}) {
  const t = ledgerTotals(rows)
  const meta = rows.length
    ? [`${rows.length} disclosure${rows.length === 1 ? '' : 's'}`, t.mw > 0 ? mw(t.mw) : null, t.valueUsd > 0 ? usd(t.valueUsd) : null]
        .filter(Boolean).join(' · ')
    : undefined
  return (
    <Section title={title} meta={meta}>
      {rows.length ? (
        <Panel className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[10px] uppercase tracking-[0.12em] text-[#43474F]">
              <tr>
                <th className="px-3 py-2 font-medium">Filed</th>
                <th className="px-3 py-2 font-medium">{counterparty === 'customer' ? 'Customer' : counterparty === 'provider' ? 'Provider' : 'Provider → customer'}</th>
                <th className="px-3 py-2 font-medium">Kind</th>
                <th className="px-3 py-2 font-medium">Site</th>
                <th className="px-3 py-2 text-right font-medium">MW</th>
                <th className="px-3 py-2 text-right font-medium">GPUs</th>
                <th className="px-3 py-2 text-right font-medium">Term</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const custLabel = r.customer_disclosed ? (r.customer_name ?? '—') : `Undisclosed${r.customer_name ? ` (${r.customer_name})` : ''}`
                return (
                  <LedgerRowGroup key={r.id} r={r}>
                    <td className="whitespace-nowrap px-3 py-2 text-[#A5A8B0]">{fmtIso(r.filing_date)}</td>
                    <td className="px-3 py-2">
                      {counterparty === 'customer' && <Party id={r.customer_id} name={custLabel} muted={!r.customer_disclosed} />}
                      {counterparty === 'provider' && <Party id={r.provider_id} name={r.provider_name} />}
                      {counterparty === 'both' && <><Party id={r.provider_id} name={r.provider_name} /> → <Party id={r.customer_id} name={custLabel} muted={!r.customer_disclosed} /></>}
                      {r.guarantor_name && counterparty !== 'both' && <div className="text-[10px] text-[#6B6F7A]">backstop: {r.guarantor_name}</div>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-[#A5A8B0]">{KIND_LABEL[r.kind] ?? r.kind}</td>
                    <td className="max-w-[140px] truncate px-3 py-2 text-[#A5A8B0]" title={r.site ?? ''}>{r.site ?? '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{mw(r.capacity_mw)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums" title={r.gpu_model ?? ''}>{r.gpu_count ? r.gpu_count.toLocaleString('en-US') : '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{months(r.term_months)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{usd(r.total_value_usd)}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <span className={'rounded border px-1.5 py-0.5 text-[10px] ' + (STATUS_TONE[r.status] ?? '')}>{STATUS_LABEL[r.status] ?? r.status}</span>
                      {r.review_status === 'auto' && <span className="ml-1 text-[10px] text-[#43474F]" title={`confidence ${r.confidence ?? '?'}`}>auto</span>}
                      {r.review_status === 'verified' && <span className="ml-1 text-[10px] text-[#34D399]">verified</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {r.source_url
                        ? <a href={r.source_url} target="_blank" rel="noopener noreferrer" className="text-[#22D3EE] hover:underline">{r.source_form}</a>
                        : <span className="text-[#A5A8B0]" title={r.source_note ?? ''}>{r.source_form}</span>}
                    </td>
                  </LedgerRowGroup>
                )
              })}
            </tbody>
          </table>
          <div className="border-t border-[#1B1E26] px-3 py-2 text-[11px]">
            <Link href={moreHref} className="text-[#22D3EE] hover:underline">Open on the ledger →</Link>
          </div>
        </Panel>
      ) : (
        <Empty>{empty}</Empty>
      )}
    </Section>
  )
}

function LedgerRowGroup({ r, children }: { r: LedgerRow; children: React.ReactNode }) {
  return (
    <>
      <tr className="border-t border-[#131519] align-top hover:bg-[#13151C]/40">{children}</tr>
      {r.excerpt && (
        <tr>
          <td colSpan={10} className="px-3 pb-2 pt-0">
            <details>
              <summary className="cursor-pointer text-[10px] text-[#43474F] hover:text-[#6B6F7A]">
                excerpt{r.extension_note ? ' · extension terms' : ''}{r.prepayment_usd ? ` · prepayment ${usd(r.prepayment_usd)}` : ''}
              </summary>
              <blockquote className="mt-1 border-l-2 border-[#262A33] pl-3 text-[11px] leading-relaxed text-[#A5A8B0]">{r.excerpt}</blockquote>
              {r.extension_note && <p className="mt-1 text-[11px] text-[#6B6F7A]">Extension: {r.extension_note}</p>}
            </details>
          </td>
        </tr>
      )}
    </>
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

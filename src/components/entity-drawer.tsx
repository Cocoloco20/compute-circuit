'use client'

/**
 * Right-side slide-in drawer showing detail for the selected node.
 * Same component handles companies, investors, and bottlenecks — we branch
 * on `selected.kind` inside the body.
 *
 * All data lookups are pure derivations from the GraphData prop (no fetches).
 */

import type { GraphData } from '@/lib/graph-data'
import type { Flow, Holding } from '@/types/db'
import { getLogoUrl } from '@/lib/logo'
import type { SelectedRef } from './compute-graph'

function formatUsd(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`
  return `$${n.toLocaleString()}`
}
function formatShares(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M sh`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k sh`
  return `${n.toLocaleString()} sh`
}

const FLOW_COLOR_CLASS: Record<string, string> = {
  money: 'text-emerald-400',
  compute: 'text-cyan-400',
  energy: 'text-amber-400',
  equipment: 'text-slate-300',
  intel: 'text-purple-400',
  venture: 'text-pink-400',
}

interface Props {
  selected: SelectedRef
  data: GraphData
  onClose: () => void
}


export default function EntityDrawer({ selected, data, onClose }: Props) {
  const body = renderBody(selected, data)
  return (
    <div className="absolute right-0 top-0 z-30 h-full w-[380px] overflow-y-auto border-l border-zinc-800 bg-zinc-950/95 p-5 text-sm text-zinc-200 backdrop-blur">
      <div className="mb-4 flex items-start justify-between">
        <div className="text-[10px] uppercase tracking-widest text-zinc-500">{selected.kind}</div>
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-zinc-800 px-2 py-0.5 text-xs text-zinc-400 hover:border-zinc-700 hover:text-white"
        >
          esc
        </button>
      </div>
      {body}
    </div>
  )
}

function renderBody(selected: SelectedRef, data: GraphData): React.ReactNode {
  if (selected.kind === 'company') return <CompanyBody id={selected.id} data={data} />
  if (selected.kind === 'investor') return <InvestorBody id={selected.id} data={data} />
  return <BottleneckBody id={selected.id} data={data} />
}

// ---------- Company ----------

function CompanyBody({ id, data }: { id: string; data: GraphData }) {
  const company = data.companies.find(c => c.id === id)
  if (!company) return <Empty msg="Company not found" />
  const layer = data.layers.find(l => l.id === company.layer_id)
  const backerIds = new Set(data.backers.filter(b => b.company_id === id).map(b => b.investor_id))
  const backers = data.investors.filter(i => backerIds.has(i.id))

  // Flows touching this node (in or out)
  const outFlows = data.flows.filter(f => f.from_id === id && f.from_kind === 'company')
  const inFlows  = data.flows.filter(f => f.to_id === id && f.to_kind === 'company')

  // Bottlenecks where this company is a beneficiary
  const beneIds = new Set(data.bottleneckBeneficiaries.filter(b => b.company_id === id).map(b => b.bottleneck_id))
  const beneBottlenecks = data.bottlenecks.filter(b => beneIds.has(b.id))

  return (
    <>
      <Header
        domain={company.domain}
        name={company.name}
        sub={company.ticker || (company.private ? 'private' : null)}
      />
      <div className="mb-4 grid grid-cols-2 gap-2 text-xs">
        <Stat label="Layer" value={layer?.name ?? '—'} />
        <Stat label="Weight" value={String(company.weight)} />
        <Stat label="Conviction" value={company.conviction ?? '—'} />
        <Stat label="Share" value={company.share != null ? `${(company.share * 100).toFixed(0)}%` : '—'} />
      </div>

      {company.position_held && (
        <div className="mb-3 rounded border border-amber-600/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
          ★ Personal position held
        </div>
      )}

      {company.thesis && <Section title="Thesis">{company.thesis}</Section>}
      {company.notes && <Section title="Notes">{company.notes}</Section>}

      {backers.length > 0 && (
        <Section title="Backers">
          <div className="flex flex-wrap gap-1">
            {backers.map(b => (
              <span key={b.id} className="rounded border border-zinc-800 px-1.5 py-0.5 text-[11px] text-purple-300">
                {b.name}
              </span>
            ))}
          </div>
        </Section>
      )}

      {beneBottlenecks.length > 0 && (
        <Section title="Benefits from">
          <ul className="space-y-1">
            {beneBottlenecks.map(b => (
              <li key={b.id} className="text-xs">
                <span className="text-orange-300">▲</span> {b.name}{' '}
                <span className="text-zinc-500">— {b.severity}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <SignalList companyId={id} data={data} />

      <InstitutionalHolders companyId={id} data={data} />

      <FlowList title={`Out (${outFlows.length})`} flows={outFlows} data={data} direction="out" />
      <FlowList title={`In (${inFlows.length})`}  flows={inFlows}  data={data} direction="in"  />
    </>
  )
}

function InstitutionalHolders({ companyId, data }: { companyId: string; data: GraphData }) {
  // Group this company's holdings by investor, take the latest period per pair.
  const matches = data.holdings.filter(h => h.company_id === companyId)
  if (matches.length === 0) return null
  const latestPerInvestor = new Map<string, Holding>()
  for (const h of matches) {
    const cur = latestPerInvestor.get(h.investor_id)
    if (!cur || h.period > cur.period) latestPerInvestor.set(h.investor_id, h)
  }
  const rows = Array.from(latestPerInvestor.values()).sort((a, b) => (b.value_usd ?? 0) - (a.value_usd ?? 0))
  const investorById = new Map(data.investors.map(i => [i.id, i]))
  return (
    <Section title={`Institutional holders (${rows.length})`}>
      <ul className="space-y-1.5">
        {rows.map((h) => {
          const inv = investorById.get(h.investor_id)
          return (
            <li key={h.id} className="text-xs">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-zinc-200">{inv?.name ?? h.investor_id}</span>
                <span className="font-mono text-emerald-400">{formatUsd(h.value_usd)}</span>
              </div>
              <div className="flex items-baseline justify-between gap-2 text-[10px] text-zinc-500">
                <span>{formatShares(h.shares)}</span>
                <span className="font-mono">Q-end {h.period}</span>
              </div>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

function SignalList({ companyId, data }: { companyId: string; data: GraphData }) {
  const signalIds = new Set(
    data.signalCompanies.filter(sc => sc.company_id === companyId).map(sc => sc.signal_id),
  )
  // Signals come back already DESC-sorted by date from graph-data.ts.
  const signals = data.signals.filter(s => signalIds.has(s.id))
  if (signals.length === 0) return null
  return (
    <Section title={`SEC filings (${signals.length})`}>
      <ul className="space-y-1.5">
        {signals.slice(0, 8).map((s) => (
          <li key={s.id} className="text-xs leading-snug">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-[10px] text-zinc-500">{s.date}</span>
              <span className="text-[10px] uppercase text-cyan-400">{s.form_type ?? 'filing'}</span>
              {s.url && (
                <a href={s.url} target="_blank" rel="noreferrer" className="ml-auto text-[10px] text-zinc-500 hover:text-white">↗</a>
              )}
            </div>
            <div className="text-zinc-300">{s.headline}</div>
          </li>
        ))}
        {signals.length > 8 && (
          <li className="text-xs text-zinc-500">+{signals.length - 8} older filings</li>
        )}
      </ul>
    </Section>
  )
}

// ---------- Investor ----------

function InvestorBody({ id, data }: { id: string; data: GraphData }) {
  const inv = data.investors.find(i => i.id === id)
  if (!inv) return <Empty msg="Investor not found" />
  const portfolioIds = new Set(data.backers.filter(b => b.investor_id === id).map(b => b.company_id))
  const portfolio = data.companies.filter(c => portfolioIds.has(c.id))

  // 13F-derived holdings — latest period only, intersected with companies in our graph.
  const myHoldings = data.holdings.filter(h => h.investor_id === id)
  const latestPeriod = myHoldings.reduce<string | null>((acc, h) => (acc && acc > h.period ? acc : h.period), null)
  const currentHoldings = myHoldings.filter(h => h.period === latestPeriod)
  const companyById = new Map(data.companies.map(c => [c.id, c]))
  const sorted = currentHoldings.slice().sort((a, b) => (b.value_usd ?? 0) - (a.value_usd ?? 0))

  return (
    <>
      <Header domain={inv.domain} name={inv.name} sub={inv.files_13f ? '13F filer' : 'private capital'} />
      {inv.thesis && <Section title="Thesis">{inv.thesis}</Section>}

      {inv.files_13f && (
        <Section title={`AI-compute 13F positions${latestPeriod ? ` · ${latestPeriod}` : ''}`}>
          {sorted.length === 0 ? (
            <div className="text-xs text-zinc-500">No matched positions yet — cron may not have run.</div>
          ) : (
            <ul className="space-y-1.5">
              {sorted.map(h => {
                const co = h.company_id ? companyById.get(h.company_id) : null
                return (
                  <li key={h.id} className="text-xs">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-zinc-200">
                        {co?.name ?? h.issuer_name}
                        {co?.ticker && <span className="text-zinc-500"> · {co.ticker}</span>}
                      </span>
                      <span className="font-mono text-emerald-400">{formatUsd(h.value_usd)}</span>
                    </div>
                    <div className="text-[10px] text-zinc-500">{formatShares(h.shares)}</div>
                  </li>
                )
              })}
            </ul>
          )}
        </Section>
      )}

      <Section title={`Private portfolio (${portfolio.length})`}>
        <ul className="space-y-1">
          {portfolio.map(c => (
            <li key={c.id} className="flex items-center justify-between text-xs">
              <span>{c.name}{c.ticker && <span className="text-zinc-500"> · {c.ticker}</span>}</span>
              <span className="text-zinc-600">{c.layer_id}</span>
            </li>
          ))}
          {portfolio.length === 0 && <li className="text-zinc-500">No mapped private holdings.</li>}
        </ul>
      </Section>
    </>
  )
}

// ---------- Bottleneck ----------

function BottleneckBody({ id, data }: { id: string; data: GraphData }) {
  const b = data.bottlenecks.find(x => x.id === id)
  if (!b) return <Empty msg="Bottleneck not found" />
  const benIds = new Set(data.bottleneckBeneficiaries.filter(x => x.bottleneck_id === id).map(x => x.company_id))
  const benefs = data.companies.filter(c => benIds.has(c.id))

  const sevColor =
    b.severity === 'critical' ? 'text-red-400' :
    b.severity === 'high' ? 'text-orange-400' :
    b.severity === 'medium' ? 'text-amber-400' : 'text-zinc-400'

  return (
    <>
      <div className="mb-3">
        <div className="text-xl font-semibold text-white">{b.name}</div>
        <div className="mt-1 flex items-center gap-2 text-xs">
          <span className={sevColor}>● {b.severity ?? 'unknown'}</span>
          <span className="text-zinc-500">{b.status}</span>
        </div>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-2 text-xs">
        <Stat label="Above" value={b.between_above ?? '—'} />
        <Stat label="Below" value={b.between_below ?? '—'} />
      </div>
      {b.timeline && <Section title="Timeline">{b.timeline}</Section>}
      {b.evidence && <Section title="Evidence">{b.evidence}</Section>}

      <Section title={`Beneficiaries (${benefs.length})`}>
        <div className="flex flex-wrap gap-1">
          {benefs.map(c => (
            <span key={c.id} className="rounded border border-zinc-800 px-1.5 py-0.5 text-[11px] text-amber-200">
              {c.ticker ?? c.name}
            </span>
          ))}
        </div>
      </Section>
    </>
  )
}

// ---------- shared bits ----------

function Header({ domain, name, sub }: { domain: string | null; name: string; sub: string | null }) {
  const url = getLogoUrl(domain)
  return (
    <div className="mb-4 flex items-center gap-3">
      {url ? (
        <div className="h-10 w-10 overflow-hidden rounded-md bg-zinc-900 ring-1 ring-zinc-800">
          {/* Using <img> not next/image to avoid build-time validation; Clearbit can 404 silently */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={name} className="h-full w-full object-contain" />
        </div>
      ) : (
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-zinc-900 text-xs text-zinc-500 ring-1 ring-zinc-800">
          {name.slice(0, 2).toUpperCase()}
        </div>
      )}
      <div>
        <div className="text-base font-semibold text-white">{name}</div>
        {sub && <div className="text-xs text-zinc-500">{sub}</div>}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-zinc-900 bg-zinc-900/40 px-2 py-1">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="text-zinc-200">{value}</div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="mb-1 text-[10px] uppercase tracking-widest text-zinc-500">{title}</div>
      <div className="text-zinc-300">{children}</div>
    </div>
  )
}

function FlowList({ title, flows, data, direction }: { title: string; flows: Flow[]; data: GraphData; direction: 'in'|'out' }) {
  if (flows.length === 0) return null
  return (
    <Section title={title}>
      <ul className="space-y-1">
        {flows.slice(0, 12).map((f) => {
          const otherId = direction === 'out' ? f.to_id : f.from_id
          const otherKind = direction === 'out' ? f.to_kind : f.from_kind
          const other =
            otherKind === 'investor'
              ? data.investors.find(i => i.id === otherId)?.name
              : data.companies.find(c => c.id === otherId)?.name
          return (
            <li key={f.id} className="text-xs">
              <span className={FLOW_COLOR_CLASS[f.type] ?? ''}>{f.type}</span>
              <span className="ml-2 text-zinc-300">{other ?? otherId}</span>
              <span className="ml-2 text-zinc-600">m{f.magnitude}</span>
              {f.note && <div className="ml-8 text-[11px] text-zinc-500">{f.note}</div>}
            </li>
          )
        })}
        {flows.length > 12 && <li className="text-xs text-zinc-500">+{flows.length - 12} more</li>}
      </ul>
    </Section>
  )
}

function Empty({ msg }: { msg: string }) {
  return <div className="text-zinc-500">{msg}</div>
}

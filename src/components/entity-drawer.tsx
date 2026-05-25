'use client'

/**
 * Right-side slide-in drawer showing detail for the selected node.
 * Same component handles companies, investors, and bottlenecks — we branch
 * on `selected.kind` inside the body.
 *
 * CompanyBody uses tabs (Overview / Financials / Activity / Holders / OSS)
 * with a sticky "DES"-style header (price + day change + key stats) that
 * never scrolls away. Bloomberg pattern: anchor the most-decision-relevant
 * numbers at the top, push deep data behind tabs vs infinite scroll.
 *
 * All data lookups are pure derivations from the GraphData prop (no fetches).
 */

import { useState } from 'react'
import type { GraphData } from '@/lib/graph-data'
import type { Flow, Holding, Fundamental, HfActivity, GridDemandSnapshot, PatentSnapshotRow, JobSnapshotRow } from '@/types/db'
import { CPC_SUBCLASS_LABELS } from '@/lib/uspto'
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

// ---------- Company (tabbed) ----------

type CompanyTab = 'overview' | 'financials' | 'activity' | 'holders' | 'oss'

function CompanyBody({ id, data }: { id: string; data: GraphData }) {
  const company = data.companies.find(c => c.id === id)
  const [tab, setTab] = useState<CompanyTab>('overview')
  if (!company) return <Empty msg="Company not found" />

  // Pre-compute counts so tab labels can show them
  const signalIdsForCo = new Set(
    data.signalCompanies.filter(sc => sc.company_id === id).map(sc => sc.signal_id),
  )
  const activityCount =
    data.signals.filter(s => signalIdsForCo.has(s.id)).length +
    data.insiders.filter(i => i.company_id === id).length
  const holderCount =
    new Set(data.holdings.filter(h => h.company_id === id).map(h => h.investor_id)).size +
    new Set(data.backers.filter(b => b.company_id === id).map(b => b.investor_id)).size
  const ossActive = data.hfActivity.some(h => h.company_id === id && h.model_count > 0)

  return (
    <>
      <StickyHeader company={company} />
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview',   label: 'Overview' },
          { id: 'financials', label: 'Financials' },
          { id: 'activity',   label: 'Activity', count: activityCount },
          { id: 'holders',    label: 'Holders',  count: holderCount },
          ...(ossActive ? [{ id: 'oss' as const, label: 'OSS' }] : []),
        ]}
      />
      <div className="mt-3">
        {tab === 'overview'   && <CompanyOverview   company={company} data={data} />}
        {tab === 'financials' && <CompanyFinancials companyId={id} data={data} />}
        {tab === 'activity'   && <CompanyActivity   companyId={id} data={data} />}
        {tab === 'holders'    && <CompanyHolders    companyId={id} data={data} />}
        {tab === 'oss'        && <OpenSourceFootprint companyId={id} data={data} />}
      </div>
    </>
  )
}

// ----- Sticky "DES"-style header -----

function StickyHeader({ company }: { company: GraphData['companies'][number] }) {
  const url = getLogoUrl(company.domain)
  const sub = company.ticker || (company.private ? 'private' : null)
  const change = company.last_price != null && company.prev_close != null
    ? company.last_price - company.prev_close
    : null
  const changePct = change != null && company.prev_close
    ? (change / company.prev_close) * 100
    : null
  const positive = change != null && change >= 0
  // 52w-range bar position 0..1
  const rangePos = (company.last_price != null && company.fifty_two_week_low != null && company.fifty_two_week_high != null
    && company.fifty_two_week_high > company.fifty_two_week_low)
    ? Math.max(0, Math.min(1, (company.last_price - company.fifty_two_week_low) / (company.fifty_two_week_high - company.fifty_two_week_low)))
    : null

  return (
    <div className="sticky -top-5 z-10 -mx-5 mb-3 border-b border-zinc-800 bg-zinc-950/95 px-5 pb-3 pt-1 backdrop-blur">
      <div className="mb-2 flex items-center gap-3">
        {url ? (
          <div className="h-10 w-10 overflow-hidden rounded-md bg-zinc-900 ring-1 ring-zinc-800">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={company.name} className="h-full w-full object-contain" />
          </div>
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-zinc-900 text-xs text-zinc-500 ring-1 ring-zinc-800">
            {company.name.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="flex-1">
          <div className="text-base font-semibold text-white">{company.name}</div>
          <div className="text-xs text-zinc-500">
            {sub} · {company.layer_id ?? 'unplaced'}
            {company.conviction && <> · <span className="text-zinc-400">{company.conviction}</span></>}
          </div>
        </div>
        {company.position_held && (
          <span className="rounded border border-amber-600/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">
            ★ HELD
          </span>
        )}
      </div>
      {company.last_price != null && (
        <div className="space-y-1">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-2xl text-white">
              {company.price_currency === 'USD' ? '$' : ''}{company.last_price.toFixed(2)}
            </span>
            {change != null && (
              <span className={'font-mono text-sm ' + (positive ? 'text-emerald-400' : 'text-red-400')}>
                {positive ? '+' : ''}{change.toFixed(2)}
                {changePct != null && <> ({positive ? '+' : ''}{changePct.toFixed(2)}%)</>}
              </span>
            )}
          </div>
          {rangePos != null && (
            <div>
              <div className="relative h-1 rounded-full bg-zinc-800">
                <div
                  className="absolute top-1/2 h-2 w-0.5 -translate-y-1/2 bg-zinc-300"
                  style={{ left: `${rangePos * 100}%` }}
                />
              </div>
              <div className="mt-0.5 flex justify-between font-mono text-[10px] text-zinc-500">
                <span>${company.fifty_two_week_low?.toFixed(2)}</span>
                <span>52w</span>
                <span>${company.fifty_two_week_high?.toFixed(2)}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ----- Tabs -----

interface TabDef<T extends string> { id: T; label: string; count?: number }

function Tabs<T extends string>({
  active, onChange, tabs,
}: {
  active: T
  onChange: (id: T) => void
  tabs: Array<TabDef<T>>
}) {
  return (
    <div className="-mx-5 flex gap-0 border-b border-zinc-800 px-5 text-[11px] font-mono uppercase tracking-wider">
      {tabs.map((t) => {
        const isActive = t.id === active
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={
              'border-b-2 py-2 transition-colors first:pl-0 ' +
              (isActive
                ? 'border-cyan-400 text-white'
                : 'border-transparent text-zinc-500 hover:text-zinc-200')
            }
            style={{ paddingLeft: '0.5rem', paddingRight: '0.75rem' }}
          >
            {t.label}
            {t.count != null && (
              <span className={'ml-1 ' + (isActive ? 'text-cyan-400' : 'text-zinc-600')}>
                {t.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// ----- Tab content -----

function CompanyOverview({ company, data }: { company: GraphData['companies'][number]; data: GraphData }) {
  const layer = data.layers.find(l => l.id === company.layer_id)
  const backerIds = new Set(data.backers.filter(b => b.company_id === company.id).map(b => b.investor_id))
  const backers = data.investors.filter(i => backerIds.has(i.id))
  const beneIds = new Set(data.bottleneckBeneficiaries.filter(b => b.company_id === company.id).map(b => b.bottleneck_id))
  const beneBottlenecks = data.bottlenecks.filter(b => beneIds.has(b.id))

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-2 text-xs">
        <Stat label="Layer" value={layer?.name ?? '—'} />
        <Stat label="Weight" value={String(company.weight)} />
        <Stat label="Conviction" value={company.conviction ?? '—'} />
        <Stat label="Share" value={company.share != null ? `${(company.share * 100).toFixed(0)}%` : '—'} />
      </div>
      <SignalChips companyId={company.id} data={data} />
      {company.thesis && <Section title="Thesis">{company.thesis}</Section>}
      {company.notes && <Section title="Notes"><div className="whitespace-pre-line">{company.notes}</div></Section>}
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
        <Section title="Benefits from bottleneck">
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
    </>
  )
}

function CompanyFinancials({ companyId, data }: { companyId: string; data: GraphData }) {
  return <Fundamentals companyId={companyId} data={data} />
}

function CompanyActivity({ companyId, data }: { companyId: string; data: GraphData }) {
  return (
    <>
      <InsiderFlow companyId={companyId} data={data} />
      <SignalList companyId={companyId} data={data} />
    </>
  )
}

function CompanyHolders({ companyId, data }: { companyId: string; data: GraphData }) {
  const outFlows = data.flows.filter(f => f.from_id === companyId && f.from_kind === 'company')
  const inFlows  = data.flows.filter(f => f.to_id === companyId && f.to_kind === 'company')
  return (
    <>
      <InstitutionalHolders companyId={companyId} data={data} />
      <FlowList title={`Out (${outFlows.length})`} flows={outFlows} data={data} direction="out" />
      <FlowList title={`In (${inFlows.length})`}  flows={inFlows}  data={data} direction="in"  />
    </>
  )
}

// MarketData merged into StickyHeader (price + day change + 52w range live there now).

const METRIC_LABELS: Record<string, string> = {
  revenue: 'Revenue',
  gross_profit: 'Gross profit',
  operating_income: 'Operating income',
  net_income: 'Net income',
  operating_cash_flow: 'Op. cash flow',
  capex: 'Capex',
  rd_expense: 'R&D',
  cash: 'Cash',
}
const METRIC_ORDER = ['revenue', 'gross_profit', 'operating_income', 'net_income', 'operating_cash_flow', 'capex', 'rd_expense', 'cash']

function fmtBigDollar(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`
  return `$${n.toLocaleString()}`
}

function Fundamentals({ companyId, data }: { companyId: string; data: GraphData }) {
  const mine = data.fundamentals.filter(f => f.company_id === companyId)
  if (mine.length === 0) return null
  // Pick the most-recent value per metric (TTM-like — companyfacts already aggregates).
  const latestPerMetric = new Map<string, Fundamental>()
  for (const f of mine) {
    const cur = latestPerMetric.get(f.metric)
    if (!cur || f.period > cur.period) latestPerMetric.set(f.metric, f)
  }
  const rows = METRIC_ORDER
    .map(m => latestPerMetric.get(m))
    .filter((f): f is Fundamental => !!f)
  if (rows.length === 0) return null
  // Revenue is the headline; compute margin % off it if present.
  const revenue = latestPerMetric.get('revenue')?.value ?? null
  return (
    <Section title="Fundamentals">
      <ul className="space-y-1">
        {rows.map((f) => {
          const margin = revenue && f.metric !== 'revenue' && f.metric !== 'cash'
            ? (f.value / revenue) * 100
            : null
          return (
            <li key={f.metric} className="flex items-baseline justify-between text-xs">
              <span className="text-zinc-400">{METRIC_LABELS[f.metric] ?? f.metric}</span>
              <span className="font-mono text-zinc-200">
                {fmtBigDollar(f.value)}
                {margin != null && (
                  <span className="ml-2 text-[10px] text-zinc-500">{margin.toFixed(0)}%</span>
                )}
              </span>
            </li>
          )
        })}
      </ul>
      <div className="mt-1 text-[10px] text-zinc-600">
        SEC XBRL · period {rows[0].period}
      </div>
    </Section>
  )
}

function InsiderFlow({ companyId, data }: { companyId: string; data: GraphData }) {
  const txns = data.insiders.filter(t => t.company_id === companyId)
  if (txns.length === 0) return null

  // Net $: signed by acquired/disposed. A = bought (+), D = sold (-).
  // Focus on open-market sales/purchases (S, P) for the headline net.
  let netSignedUsd = 0
  let openMarketCount = 0
  for (const t of txns) {
    if (t.value_usd == null) continue
    const sign = t.acquired_or_disposed === 'D' ? -1 : 1
    if (t.transaction_code === 'S' || t.transaction_code === 'P') openMarketCount++
    netSignedUsd += sign * t.value_usd
  }
  const positive = netSignedUsd >= 0
  // Sort recent first for table
  const recent = txns.slice().sort((a, b) => b.filing_date.localeCompare(a.filing_date)).slice(0, 6)

  return (
    <Section title={`Insider flow · 90d (${txns.length})`}>
      <div className="mb-2 flex items-baseline gap-2">
        <span className={'font-mono text-sm ' + (positive ? 'text-emerald-400' : 'text-red-400')}>
          {positive ? '+' : ''}{fmtBigDollar(Math.abs(netSignedUsd))} net
        </span>
        <span className="text-[10px] text-zinc-500">· {openMarketCount} open-market</span>
      </div>
      <ul className="space-y-1">
        {recent.map((t) => {
          const sold = t.acquired_or_disposed === 'D'
          const code = t.transaction_code ?? '?'
          const codeColor = code === 'P' ? 'text-emerald-400' : code === 'S' ? 'text-red-400' : 'text-zinc-500'
          return (
            <li key={t.id} className="text-xs leading-snug">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-[10px] text-zinc-500">{t.filing_date}</span>
                <span className={`text-[10px] uppercase ${codeColor}`}>{code}</span>
                <span className={'font-mono ' + (sold ? 'text-red-400' : 'text-emerald-400')}>
                  {sold ? '-' : '+'}{t.value_usd != null ? fmtBigDollar(t.value_usd) : '—'}
                </span>
              </div>
              <div className="text-zinc-300">
                {t.reporting_owner ?? 'Unknown'}
                {t.reporting_owner_role && <span className="text-zinc-500"> · {t.reporting_owner_role}</span>}
              </div>
            </li>
          )
        })}
        {txns.length > 6 && <li className="text-xs text-zinc-500">+{txns.length - 6} more</li>}
      </ul>
      <div className="mt-1 text-[10px] text-zinc-600">SEC Form 4 · last 90d</div>
    </Section>
  )
}

function OpenSourceFootprint({ companyId, data }: { companyId: string; data: GraphData }) {
  // Most recent snapshot per company
  const snaps = data.hfActivity.filter(h => h.company_id === companyId)
  if (snaps.length === 0) return null
  const latest: HfActivity = snaps.reduce((acc, s) => s.snapshot_date > acc.snapshot_date ? s : acc, snaps[0])
  if (latest.model_count === 0) {
    return (
      <Section title="Open-source footprint">
        <div className="text-xs text-zinc-500">
          <code className="text-zinc-400">{latest.org_slug}</code> on Hugging Face · 0 public models
        </div>
      </Section>
    )
  }
  const daysSinceRelease = latest.last_release_date
    ? Math.round((Date.now() - new Date(latest.last_release_date).getTime()) / 86400_000)
    : null
  return (
    <Section title="Open-source footprint">
      <div className="space-y-1">
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-zinc-400">Models on Hugging Face</span>
          <span className="font-mono text-zinc-200">{latest.model_count.toLocaleString()}</span>
        </div>
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-zinc-400">Total downloads (30d)</span>
          <span className="font-mono text-cyan-400">{formatCount(latest.total_downloads_30d)}</span>
        </div>
        {latest.top_model_id && (
          <div className="text-xs">
            <div className="text-zinc-500">Most downloaded</div>
            <a
              href={`https://huggingface.co/${latest.top_model_id}`}
              target="_blank"
              rel="noreferrer"
              className="text-zinc-200 hover:text-white"
            >
              {latest.top_model_id} ↗
            </a>
            {latest.top_model_downloads != null && (
              <span className="ml-2 font-mono text-[10px] text-zinc-500">
                {formatCount(latest.top_model_downloads)} dl
              </span>
            )}
          </div>
        )}
        {daysSinceRelease != null && (
          <div className="text-[10px] text-zinc-500">
            Last release {daysSinceRelease === 0 ? 'today' : `${daysSinceRelease}d ago`} ({latest.last_release_date})
          </div>
        )}
        <div className="mt-1 text-[10px] text-zinc-600">huggingface.co/{latest.org_slug}</div>
      </div>
    </Section>
  )
}

function formatCount(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`
  return n.toLocaleString()
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
    <Section title={`Recent activity (${signals.length})`}>
      <ul className="space-y-1.5">
        {signals.slice(0, 12).map((s) => {
          const isNews = s.form_type === 'news'
          const badgeColor = isNews
            ? 'text-cyan-400'
            : s.form_type === '8-K' ? 'text-orange-400' : 'text-zinc-400'
          const badgeLabel = isNews ? 'NEWS' : (s.form_type ?? 'FILING')
          return (
            <li key={s.id} className="text-xs leading-snug">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-[10px] text-zinc-500">{s.date}</span>
                <span className={`text-[10px] uppercase ${badgeColor}`}>{badgeLabel}</span>
                {isNews && s.impact && (
                  <span className="text-[10px] text-zinc-500">· {s.impact}</span>
                )}
                {s.url && (
                  <a href={s.url} target="_blank" rel="noreferrer" className="ml-auto text-[10px] text-zinc-500 hover:text-white">↗</a>
                )}
              </div>
              <div className={isNews ? 'text-zinc-200' : 'text-zinc-300'}>{s.headline}</div>
            </li>
          )
        })}
        {signals.length > 12 && (
          <li className="text-xs text-zinc-500">+{signals.length - 12} older</li>
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

      <PortfolioBreakdown portfolio={portfolio} />
    </>
  )
}

function PortfolioBreakdown({ portfolio }: { portfolio: GraphData['companies'] }) {
  // Split into:
  //   * Curated — already placed on a layer (rendered in the graph)
  //   * Discovered — pulled in by the Form-D scraper, no layer yet
  const curated = portfolio.filter(c => c.layer_id)
  const discovered = portfolio.filter(c => !c.layer_id)
  return (
    <>
      <Section title={`Curated portfolio (${curated.length})`}>
        <ul className="space-y-1">
          {curated.map(c => (
            <li key={c.id} className="flex items-center justify-between text-xs">
              <span>{c.name}{c.ticker && <span className="text-zinc-500"> · {c.ticker}</span>}</span>
              <span className="text-zinc-600">{c.layer_id}</span>
            </li>
          ))}
          {curated.length === 0 && <li className="text-zinc-500">No mapped holdings.</li>}
        </ul>
      </Section>

      {discovered.length > 0 && (
        <Section title={`Discovered via Form D (${discovered.length})`}>
          <div className="mb-1.5 text-[10px] text-zinc-600">
            From SEC Form D filings. Promote to graph by editing the row&apos;s layer_id.
          </div>
          <ul className="max-h-64 space-y-1 overflow-y-auto pr-1">
            {discovered.slice(0, 50).map(c => (
              <li key={c.id} className="text-xs text-zinc-400">
                {c.name}
              </li>
            ))}
            {discovered.length > 50 && (
              <li className="text-xs text-zinc-600">+{discovered.length - 50} more…</li>
            )}
          </ul>
        </Section>
      )}
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

// ----- SignalChips: hiring / power / R&D -----
//
// Bloomberg-style "decision-ready" header chips above the long-form sections.
// Each one is conditionally rendered: hidden entirely (no "no data" state) for
// companies that aren't mapped to that signal, so the drawer stays clean.

function pickLatestAndPriors<T extends { snapshot_date: string }>(
  rows: T[],
): { latest: T | null; d7: T | null; d30: T | null } {
  if (rows.length === 0) return { latest: null, d7: null, d30: null }
  const sorted = rows.slice().sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date))
  const latest = sorted[0]
  // Closest snapshot to N days before the latest snapshot
  const latestT = new Date(latest.snapshot_date).getTime()
  const target7 = latestT - 7 * 86_400_000
  const target30 = latestT - 30 * 86_400_000
  const closest = (target: number): T | null => {
    let best: T | null = null
    let bestDelta = Infinity
    for (const r of sorted) {
      const d = Math.abs(new Date(r.snapshot_date).getTime() - target)
      if (d < bestDelta) { bestDelta = d; best = r }
    }
    // Reject if no nearby snapshot — keep deltas honest
    return bestDelta < 4 * 86_400_000 ? best : null
  }
  return { latest, d7: closest(target7), d30: closest(target30) }
}

function HiringPulseChip({ rows }: { rows: JobSnapshotRow[] }) {
  if (rows.length === 0) return null
  const { latest, d7, d30 } = pickLatestAndPriors(rows)
  if (!latest) return null
  const delta7 = d7 ? latest.total_open - d7.total_open : null
  const delta30 = d30 ? latest.total_open - d30.total_open : null
  const top = Array.isArray(latest.top_categories) && latest.top_categories[0]
    ? latest.top_categories[0]
    : null
  const deltaColor = (n: number | null) =>
    n == null ? 'text-zinc-600' : n >= 5 ? 'text-emerald-400' : n <= -5 ? 'text-red-400' : 'text-zinc-400'
  const ramping = delta7 != null && delta7 >= 20
  return (
    <div className="rounded border border-zinc-900 bg-zinc-900/40 px-2 py-1.5">
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500">Hiring pulse</div>
        <div className="flex items-baseline gap-1">
          <span className="font-mono text-sm text-zinc-100">{latest.total_open}</span>
          <span className="text-[10px] text-zinc-500">open</span>
          {ramping && <span className="ml-1 rounded bg-pink-500/15 px-1 py-0.5 text-[9px] uppercase text-pink-300">ramp</span>}
        </div>
      </div>
      <div className="mt-0.5 flex items-center gap-2 text-[10px] font-mono">
        <span className={deltaColor(delta7)}>
          {delta7 != null ? (delta7 >= 0 ? '+' : '') + delta7 + ' 7d' : '— 7d'}
        </span>
        <span className="text-zinc-700">·</span>
        <span className={deltaColor(delta30)}>
          {delta30 != null ? (delta30 >= 0 ? '+' : '') + delta30 + ' 30d' : '— 30d'}
        </span>
        {top && (
          <>
            <span className="text-zinc-700">·</span>
            <span className="text-zinc-400">top: <span className="text-zinc-200">{top.name}</span> ({top.count})</span>
          </>
        )}
      </div>
      <div className="mt-0.5 text-[9px] text-zinc-600">
        via {latest.source_provider} · {latest.source_slug}
      </div>
    </div>
  )
}

function PowerPressureChip({ rows }: { rows: GridDemandSnapshot[] }) {
  if (rows.length === 0) return null
  const latest = rows.slice().sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date))[0]
  if (!latest || latest.current_7d_avg_mwh == null) return null
  const gwh = latest.current_7d_avg_mwh / 1000
  const yoy = latest.yoy_change_pct ?? 0
  const yoyColor = yoy >= 5 ? 'text-yellow-300' : yoy <= -5 ? 'text-zinc-400' : 'text-zinc-300'
  const tight = yoy >= 5
  return (
    <div className="rounded border border-zinc-900 bg-zinc-900/40 px-2 py-1.5">
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500">Power pressure · {latest.region}</div>
        <div className="flex items-baseline gap-1">
          <span className="font-mono text-sm text-zinc-100">{gwh.toFixed(1)}</span>
          <span className="text-[10px] text-zinc-500">GWh 7d</span>
          {tight && <span className="ml-1 rounded bg-yellow-500/15 px-1 py-0.5 text-[9px] uppercase text-yellow-300">tight</span>}
        </div>
      </div>
      <div className="mt-0.5 text-[10px] font-mono">
        <span className={yoyColor}>{yoy >= 0 ? '+' : ''}{yoy.toFixed(1)}% YoY</span>
        {latest.last_hour && (
          <>
            <span className="ml-2 text-zinc-700">·</span>
            <span className="ml-2 text-zinc-500">last hr {latest.last_hourly_mwh != null ? (latest.last_hourly_mwh / 1000).toFixed(1) : '—'} GWh</span>
          </>
        )}
      </div>
      <div className="mt-0.5 text-[9px] text-zinc-600">EIA Form 930 · {latest.snapshot_date}</div>
    </div>
  )
}

function RDVelocityChip({ rows }: { rows: PatentSnapshotRow[] }) {
  if (rows.length === 0) return null
  const { latest, d30 } = pickLatestAndPriors(rows)
  if (!latest) return null
  const delta30 = d30 ? latest.ttm_count - d30.ttm_count : null
  const top3 = Array.isArray(latest.top_subclasses) ? latest.top_subclasses.slice(0, 3) : []
  return (
    <div className="rounded border border-zinc-900 bg-zinc-900/40 px-2 py-1.5">
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500">R&D velocity · TTM</div>
        <div className="flex items-baseline gap-1">
          <span className="font-mono text-sm text-zinc-100">{latest.ttm_count}</span>
          <span className="text-[10px] text-zinc-500">filings</span>
          {delta30 != null && (
            <span className={'ml-1 text-[10px] font-mono ' + (delta30 >= 0 ? 'text-violet-300' : 'text-zinc-400')}>
              {delta30 >= 0 ? '+' : ''}{delta30}/30d
            </span>
          )}
        </div>
      </div>
      {top3.length > 0 && (
        <div className="mt-0.5 flex flex-wrap gap-1 text-[10px] font-mono">
          {top3.map(s => (
            <span key={s.code} className="rounded border border-zinc-800 px-1 text-zinc-300">
              {s.code}
              {CPC_SUBCLASS_LABELS[s.code] && (
                <span className="ml-1 text-zinc-500">{CPC_SUBCLASS_LABELS[s.code]}</span>
              )}
              <span className="ml-1 text-zinc-500">·{s.count}</span>
            </span>
          ))}
        </div>
      )}
      <div className="mt-0.5 text-[9px] text-zinc-600">USPTO · {latest.snapshot_date}</div>
    </div>
  )
}

function SignalChips({ companyId, data }: { companyId: string; data: GraphData }) {
  const jobs = data.jobs.filter(j => j.company_id === companyId)
  const grid = data.gridDemand.filter(g => g.company_id === companyId)
  const patents = data.patents.filter(p => p.company_id === companyId)
  if (jobs.length === 0 && grid.length === 0 && patents.length === 0) return null
  return (
    <div className="mb-4 grid grid-cols-1 gap-2">
      {jobs.length    > 0 && <HiringPulseChip   rows={jobs}    />}
      {grid.length    > 0 && <PowerPressureChip rows={grid}    />}
      {patents.length > 0 && <RDVelocityChip    rows={patents} />}
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

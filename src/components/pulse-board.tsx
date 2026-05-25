'use client'

/**
 * Pulse Board — graph-wide "what mattered today" panel.
 *
 * Bloomberg-style overview anchored top-right. Five compact sections,
 * each ranking today's most decision-relevant items across the graph:
 *
 *   1. Movers       — top 5 absolute % price moves
 *   2. Filings      — newest 8-K headlines (last 24h, then last 7d)
 *   3. News         — newest Google News items with non-junky outlets
 *   4. Insider      — last 7d biggest signed-dollar moves
 *   5. Hiring ramps — biggest 7d delta in open job reqs
 *
 * Each row is clickable → opens the relevant entity drawer. Collapsible
 * (click the header), default open. Pure derivation from GraphData — no
 * fetches inside the component.
 */

import { useMemo, useState } from 'react'
import type { GraphData } from '@/lib/graph-data'
import type { SelectedRef } from './compute-graph'

interface Props {
  data: GraphData
  onSelect: (sel: SelectedRef) => void
}

export default function PulseBoard({ data, onSelect }: Props) {
  const [open, setOpen] = useState(true)

  const movers = useMovers(data)
  const filings = useRecentFilings(data)
  const news = useRecentNews(data)
  const insider = useInsiderWeek(data)
  const hiring = useHiringRamps(data)
  const funding = useFunding90d(data)

  return (
    <div className="pointer-events-auto absolute right-4 top-16 z-10 w-[320px] rounded-card border border-border-default bg-bg-overlay text-body text-fg-secondary shadow-panel backdrop-blur">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center justify-between border-b border-border-subtle px-4 py-3 text-left hover:bg-bg-hover/60"
      >
        <span className="text-label text-fg-primary">Pulse Board</span>
        <span className="text-fg-muted">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="max-h-[calc(100vh-200px)] space-y-4 overflow-y-auto px-4 py-3">
          <PulseSection title="Movers · 1d">
            {movers.length === 0 ? <NoData /> : movers.map((m) => (
              <PulseRow
                key={m.id}
                onClick={() => onSelect({ kind: 'company', id: m.id })}
                left={<span className="text-fg-primary">{m.ticker ?? m.name}</span>}
                right={
                  <span className={'font-mono ' + (m.pct >= 0 ? 'text-signal-healthy' : 'text-signal-alert')}>
                    {m.pct >= 0 ? '+' : ''}{m.pct.toFixed(2)}%
                  </span>
                }
              />
            ))}
          </PulseSection>

          <PulseSection title="Filings · 8-K">
            {filings.length === 0 ? <NoData /> : filings.map((f) => (
              <PulseRow
                key={f.id}
                onClick={f.coId ? () => onSelect({ kind: 'company', id: f.coId! }) : undefined}
                left={
                  <span className="line-clamp-2 text-fg-primary">
                    {f.coTicker && <span className="text-feed-filings">{f.coTicker} </span>}
                    {f.headline}
                  </span>
                }
                right={<span className="ml-2 text-fg-muted">{f.dateShort}</span>}
              />
            ))}
          </PulseSection>

          <PulseSection title="News">
            {news.length === 0 ? <NoData /> : news.map((n) => (
              <PulseRow
                key={n.id}
                onClick={n.coId ? () => onSelect({ kind: 'company', id: n.coId! }) : undefined}
                left={
                  <span className="line-clamp-2 text-fg-primary">
                    {n.coTicker && <span className="text-signal-info">{n.coTicker} </span>}
                    {n.headline}
                  </span>
                }
                right={<span className="ml-2 text-fg-muted">{n.dateShort}</span>}
              />
            ))}
          </PulseSection>

          <PulseSection title="Insider · 7d">
            {insider.length === 0 ? <NoData /> : insider.map((i) => (
              <PulseRow
                key={i.coId}
                onClick={() => onSelect({ kind: 'company', id: i.coId })}
                left={<span className="text-fg-primary">{i.coTicker ?? i.coName}</span>}
                right={
                  <span className={'font-mono ' + (i.netUsd >= 0 ? 'text-signal-healthy' : 'text-signal-alert')}>
                    {i.netUsd >= 0 ? '+' : '−'}{fmtUsd(Math.abs(i.netUsd))}
                  </span>
                }
              />
            ))}
          </PulseSection>

          <PulseSection title="Funding · 90d">
            {funding.length === 0 ? <NoData /> : funding.map((f) => (
              <PulseRow
                key={f.id}
                onClick={() => onSelect({ kind: 'company', id: f.coId })}
                left={
                  <span className="text-fg-primary">
                    {f.coTicker ?? f.coName}
                    <span className="ml-1 text-fg-muted">· {f.dateShort}</span>
                  </span>
                }
                right={
                  <span className="font-mono text-signal-healthy">
                    {fmtUsd(f.amountUsd)}{f.indefinite ? '+' : ''}
                  </span>
                }
              />
            ))}
          </PulseSection>

          <PulseSection title="Hiring ramps · 7d">
            {hiring.length === 0 ? <NoData /> : hiring.map((h) => (
              <PulseRow
                key={h.coId}
                onClick={() => onSelect({ kind: 'company', id: h.coId })}
                left={
                  <span className="text-fg-primary">
                    {h.coTicker ?? h.coName}
                    <span className="ml-1 text-fg-muted">· {h.topDept ?? '—'}</span>
                  </span>
                }
                right={
                  <span className={'font-mono ' + (h.delta >= 0 ? 'text-feed-jobs' : 'text-fg-secondary')}>
                    {h.delta >= 0 ? '+' : ''}{h.delta}
                  </span>
                }
              />
            ))}
          </PulseSection>
        </div>
      )}
    </div>
  )
}

// ---------- section + row primitives ----------

function PulseSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-label text-fg-muted">{title}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

function PulseRow({
  left, right, onClick,
}: {
  left: React.ReactNode
  right: React.ReactNode
  onClick?: () => void
}) {
  const isClickable = !!onClick
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!isClickable}
      className={
        'flex w-full items-baseline justify-between gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors ' +
        (isClickable ? 'cursor-pointer hover:bg-bg-hover/70' : 'cursor-default')
      }
    >
      <span className="flex-1 truncate">{left}</span>
      {right}
    </button>
  )
}

function NoData() {
  return <div className="px-1 py-1 text-meta text-fg-dim">no data yet</div>
}

// ---------- derivations ----------

interface MoverRow { id: string; name: string; ticker: string | null; pct: number }
function useMovers(data: GraphData): MoverRow[] {
  return useMemo(() => {
    const out: MoverRow[] = []
    for (const c of data.companies) {
      if (c.last_price == null || c.prev_close == null || c.prev_close === 0) continue
      const pct = ((c.last_price - c.prev_close) / c.prev_close) * 100
      if (!Number.isFinite(pct)) continue
      out.push({ id: c.id, name: c.name, ticker: c.ticker, pct })
    }
    return out.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct)).slice(0, 5)
  }, [data])
}

interface FilingRow {
  id: string
  headline: string
  coId: string | null
  coTicker: string | null
  dateShort: string
}
function useRecentFilings(data: GraphData): FilingRow[] {
  return useMemo(() => {
    const filings = data.signals
      .filter(s => s.source === 'sec-edgar')
      .slice(0, 6)
    const coById = new Map(data.companies.map(c => [c.id, c]))
    return filings.map(s => {
      const link = data.signalCompanies.find(sc => sc.signal_id === s.id)
      const co = link ? coById.get(link.company_id) : null
      return {
        id: s.id,
        headline: s.headline,
        coId: co?.id ?? null,
        coTicker: co?.ticker ?? null,
        dateShort: shortDate(s.date),
      }
    })
  }, [data])
}

function useRecentNews(data: GraphData): FilingRow[] {
  return useMemo(() => {
    const news = data.signals
      .filter(s => s.source === 'google-news')
      .slice(0, 6)
    const coById = new Map(data.companies.map(c => [c.id, c]))
    return news.map(s => {
      const link = data.signalCompanies.find(sc => sc.signal_id === s.id)
      const co = link ? coById.get(link.company_id) : null
      return {
        id: s.id,
        headline: s.headline,
        coId: co?.id ?? null,
        coTicker: co?.ticker ?? null,
        dateShort: shortDate(s.date),
      }
    })
  }, [data])
}

interface InsiderRow { coId: string; coName: string; coTicker: string | null; netUsd: number }
function useInsiderWeek(data: GraphData): InsiderRow[] {
  return useMemo(() => {
    const cutoffMs = Date.now() - 7 * 86_400_000
    const byCo = new Map<string, number>()
    for (const t of data.insiders) {
      if (t.value_usd == null) continue
      const d = new Date(t.filing_date).getTime()
      if (Number.isFinite(d) && d < cutoffMs) continue
      const sign = t.acquired_or_disposed === 'D' ? -1 : 1
      byCo.set(t.company_id, (byCo.get(t.company_id) ?? 0) + sign * t.value_usd)
    }
    const coById = new Map(data.companies.map(c => [c.id, c]))
    const rows: InsiderRow[] = []
    for (const [coId, netUsd] of byCo) {
      const co = coById.get(coId)
      if (!co || Math.abs(netUsd) < 1_000_000) continue   // below $1M is noise
      rows.push({ coId, coName: co.name, coTicker: co.ticker, netUsd })
    }
    return rows.sort((a, b) => Math.abs(b.netUsd) - Math.abs(a.netUsd)).slice(0, 5)
  }, [data])
}

interface FundingRow {
  id: string
  coId: string
  coName: string
  coTicker: string | null
  amountUsd: number
  indefinite: boolean
  dateShort: string
}
function useFunding90d(data: GraphData): FundingRow[] {
  return useMemo(() => {
    const cutoffMs = Date.now() - 90 * 86_400_000
    const coById = new Map(data.companies.map(c => [c.id, c]))
    const rows: FundingRow[] = []
    for (const r of data.fundingRounds) {
      const d = new Date(r.filed_date).getTime()
      if (Number.isFinite(d) && d < cutoffMs) continue
      // Use total_amount_sold_usd as the "raised" figure; fall back to offering amount.
      const amount = r.total_amount_sold_usd ?? r.total_offering_amount_usd
      if (amount == null) continue
      const co = coById.get(r.company_id)
      if (!co) continue
      rows.push({
        id: r.id,
        coId: co.id,
        coName: co.name,
        coTicker: co.ticker,
        amountUsd: amount,
        indefinite: r.has_amount_indefinite,
        dateShort: shortDate(r.filed_date),
      })
    }
    return rows.sort((a, b) => b.amountUsd - a.amountUsd).slice(0, 5)
  }, [data])
}

interface HiringRow { coId: string; coName: string; coTicker: string | null; delta: number; topDept: string | null }
function useHiringRamps(data: GraphData): HiringRow[] {
  return useMemo(() => {
    // Group by company, pick latest + 7d-ago snapshot, compute delta
    const byCo = new Map<string, GraphData['jobs']>()
    for (const j of data.jobs) {
      const arr = byCo.get(j.company_id) ?? []
      arr.push(j)
      byCo.set(j.company_id, arr)
    }
    const coById = new Map(data.companies.map(c => [c.id, c]))
    const rows: HiringRow[] = []
    for (const [coId, snaps] of byCo) {
      const sorted = snaps.slice().sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date))
      const latest = sorted[0]
      if (!latest) continue
      const latestMs = new Date(latest.snapshot_date).getTime()
      const target = latestMs - 7 * 86_400_000
      // Closest snapshot within 4 days of the target
      let best: typeof latest | null = null
      let bestDelta = Infinity
      for (const s of sorted) {
        const d = Math.abs(new Date(s.snapshot_date).getTime() - target)
        if (d < bestDelta) { bestDelta = d; best = s }
      }
      const co = coById.get(coId)
      if (!co) continue
      const delta = best && bestDelta < 4 * 86_400_000 ? latest.total_open - best.total_open : null
      const topDept = Array.isArray(latest.top_categories) && latest.top_categories[0]
        ? latest.top_categories[0].name
        : null
      // Always include if delta is meaningful; otherwise just show open count
      rows.push({
        coId,
        coName: co.name,
        coTicker: co.ticker,
        delta: delta ?? latest.total_open,
        topDept,
      })
    }
    return rows.sort((a, b) => b.delta - a.delta).slice(0, 5)
  }, [data])
}

// ---------- formatters ----------

function shortDate(iso: string): string {
  // 'YYYY-MM-DD' → 'M/D'
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso.slice(0, 10)
  return `${Number(m)}/${Number(d.slice(0, 2))}`
}

function fmtUsd(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`
  return `$${n.toFixed(0)}`
}

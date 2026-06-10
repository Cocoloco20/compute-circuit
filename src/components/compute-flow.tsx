'use client'

/**
 * Compute Flow view — Phase 8.
 *
 * Bipartite money-flow map of the publicly reported compute mega-deals:
 * AI-model buyers on the left (OpenAI, Anthropic, xAI, Meta, …), compute
 * sellers on the right (NVIDIA, AMD, Oracle, CoreWeave, clouds). Link
 * thickness scales with the REPORTED headline value; deals with undisclosed
 * values render at minimum width with a dashed stroke. Below the map, the
 * full deal ledger with per-row source attribution.
 *
 * Every number here is a reported commitment/ceiling ("up to"), not
 * recognized revenue — the ledger column says so, and each row carries the
 * publisher + month so it can be checked. This view is research context,
 * not investment advice.
 *
 * Pure SVG — no chart library, no client fetch (data arrives via the same
 * GraphData prop every view shares).
 */

import { useMemo, useState } from 'react'
import type { GraphData } from '@/lib/graph-data'
import type { ComputeContract } from '@/types/db'
import type { SelectedRef } from './compute-graph'

const KIND_COLORS: Record<ComputeContract['kind'], string> = {
  gpu_purchase: '#10b981',   // emerald — silicon off the shelf
  cloud_capacity: '#22d3ee', // cyan — rented compute
  custom_silicon: '#a855f7', // purple — co-designed ASICs
  equity_compute: '#fbbf24', // amber — investment entangled with supply
  jv_program: '#ec4899',     // pink — program-level JVs (Stargate)
}

const KIND_LABELS: Record<ComputeContract['kind'], string> = {
  gpu_purchase: 'GPU purchase',
  cloud_capacity: 'Cloud capacity',
  custom_silicon: 'Custom silicon',
  equity_compute: 'Equity + compute',
  jv_program: 'JV / program',
}

interface Props {
  data: GraphData
  onSelect: (ref: SelectedRef) => void
}

export default function ComputeFlow({ data, onSelect }: Props) {
  const [kindFilter, setKindFilter] = useState<ComputeContract['kind'] | null>(null)
  const contracts = useMemo(
    () => (kindFilter ? data.computeContracts.filter(c => c.kind === kindFilter) : data.computeContracts),
    [data.computeContracts, kindFilter],
  )
  const names = useMemo(
    () => new Map(data.companies.map(c => [c.id, c.name])),
    [data.companies],
  )

  const layout = useMemo(() => {
    // Order each side by total committed $ so the heaviest counterparties
    // sit at the top and the eye reads the hierarchy without a legend.
    const sumBy = (key: 'buyer_id' | 'seller_id') => {
      const m = new Map<string, number>()
      for (const c of contracts) m.set(c[key], (m.get(c[key]) ?? 0) + (c.value_usd_b ?? 0))
      return m
    }
    const buyerTotals = sumBy('buyer_id')
    const sellerTotals = sumBy('seller_id')
    const buyers = [...buyerTotals.keys()].sort((a, b) => (buyerTotals.get(b)! - buyerTotals.get(a)!))
    const sellers = [...sellerTotals.keys()].sort((a, b) => (sellerTotals.get(b)! - sellerTotals.get(a)!))

    const H = Math.max(buyers.length, sellers.length) * 64 + 60
    const y = (idx: number, count: number) => 50 + idx * ((H - 80) / Math.max(count - 1, 1))
    const buyerY = new Map(buyers.map((id, i) => [id, y(i, buyers.length)]))
    const sellerY = new Map(sellers.map((id, i) => [id, y(i, sellers.length)]))
    return { buyers, sellers, buyerTotals, sellerTotals, buyerY, sellerY, H }
  }, [contracts])

  const totalCommitted = contracts.reduce((a, c) => a + (c.value_usd_b ?? 0), 0)
  const totalGw = contracts.reduce((a, c) => a + (c.gigawatts ?? 0), 0)

  const W = 860
  const LX = 200   // buyer column x
  const RX = W - 200

  return (
    <div className="absolute inset-0 overflow-y-auto bg-[#05060a] px-4 pb-28 pt-16 md:px-8 md:pt-20">
      <div className="mx-auto max-w-5xl">
        <div className="mb-1 font-mono text-[11px] uppercase tracking-widest text-fg-dim">
          Phase 8 · Compute Flow
        </div>
        <h1 className="text-xl font-semibold text-zinc-100 md:text-2xl">
          Who buys compute from whom
        </h1>
        <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-fg-muted">
          Publicly reported mega-deals between AI-model companies and compute sellers.
          Values are reported commitments/ceilings (&ldquo;up to&rdquo;) — not recognized revenue.
          Every row links its source. {contracts.length} deals
          · ~${totalCommitted.toFixed(0)}B committed · {totalGw.toFixed(1)} GW where disclosed.
        </p>

        {/* Kind filter chips */}
        <div className="mt-4 flex flex-wrap gap-1.5">
          {(Object.keys(KIND_LABELS) as Array<ComputeContract['kind']>).map(k => (
            <button
              key={k}
              type="button"
              onClick={() => setKindFilter(kindFilter === k ? null : k)}
              className={`rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide transition-colors ${
                kindFilter === k ? 'border-zinc-500 bg-zinc-800 text-zinc-100' : 'border-zinc-800 text-fg-muted hover:border-zinc-600'
              }`}
            >
              <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: KIND_COLORS[k] }} />
              {KIND_LABELS[k]}
            </button>
          ))}
        </div>

        {/* Flow map */}
        <div className="mt-6 overflow-x-auto rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-2">
          <svg viewBox={`0 0 ${W} ${layout.H}`} className="min-w-[700px]" role="img"
               aria-label="Compute contract flows between buyers and sellers">
            <text x={LX} y={24} textAnchor="middle" className="fill-zinc-500" fontSize={11} fontFamily="monospace">BUYERS</text>
            <text x={RX} y={24} textAnchor="middle" className="fill-zinc-500" fontSize={11} fontFamily="monospace">SELLERS</text>

            {/* Links under nodes */}
            {contracts.map(c => {
              const y1 = layout.buyerY.get(c.buyer_id)
              const y2 = layout.sellerY.get(c.seller_id)
              if (y1 == null || y2 == null) return null
              const w = c.value_usd_b ? Math.max(1.5, Math.sqrt(c.value_usd_b) * 1.1) : 1.5
              const mid = (LX + RX) / 2
              return (
                <path
                  key={c.id}
                  d={`M ${LX + 70} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${RX - 70} ${y2}`}
                  fill="none"
                  stroke={KIND_COLORS[c.kind]}
                  strokeWidth={w}
                  strokeOpacity={0.55}
                  strokeDasharray={c.value_usd_b ? undefined : '4 4'}
                >
                  <title>{`${names.get(c.buyer_id) ?? c.buyer_id} → ${names.get(c.seller_id) ?? c.seller_id}
${c.headline}
${c.value_usd_b ? `$${c.value_usd_b}B reported` : 'value undisclosed'}${c.gigawatts ? ` · ${c.gigawatts} GW` : ''}
${c.source}`}</title>
                </path>
              )
            })}

            {/* Nodes */}
            {layout.buyers.map(id => (
              <g key={`b-${id}`} className="cursor-pointer" onClick={() => onSelect({ kind: 'company', id })}>
                <rect x={LX - 130} y={layout.buyerY.get(id)! - 16} width={200} height={32} rx={7}
                      className="fill-zinc-900 stroke-zinc-700" strokeWidth={1} />
                <text x={LX - 30} y={layout.buyerY.get(id)! - 1} textAnchor="middle"
                      className="fill-zinc-100" fontSize={12} fontWeight={600}>
                  {names.get(id) ?? id}
                </text>
                <text x={LX - 30} y={layout.buyerY.get(id)! + 11} textAnchor="middle"
                      className="fill-zinc-500" fontSize={9} fontFamily="monospace">
                  ${layout.buyerTotals.get(id)!.toFixed(0)}B committed
                </text>
              </g>
            ))}
            {layout.sellers.map(id => (
              <g key={`s-${id}`} className="cursor-pointer" onClick={() => onSelect({ kind: 'company', id })}>
                <rect x={RX - 70} y={layout.sellerY.get(id)! - 16} width={200} height={32} rx={7}
                      className="fill-zinc-900 stroke-zinc-700" strokeWidth={1} />
                <text x={RX + 30} y={layout.sellerY.get(id)! - 1} textAnchor="middle"
                      className="fill-zinc-100" fontSize={12} fontWeight={600}>
                  {names.get(id) ?? id}
                </text>
                <text x={RX + 30} y={layout.sellerY.get(id)! + 11} textAnchor="middle"
                      className="fill-zinc-500" fontSize={9} fontFamily="monospace">
                  ${layout.sellerTotals.get(id)!.toFixed(0)}B booked
                </text>
              </g>
            ))}
          </svg>
        </div>

        {/* Deal ledger */}
        <h2 className="mt-8 mb-2 font-mono text-[11px] uppercase tracking-widest text-fg-dim">
          Deal ledger — reported values, sourced
        </h2>
        <div className="overflow-x-auto rounded-xl border border-zinc-800/80">
          <table className="w-full min-w-[640px] text-left text-[12.5px]">
            <thead className="bg-zinc-900/70 font-mono text-[10px] uppercase tracking-wide text-fg-muted">
              <tr>
                <th className="px-3 py-2">Deal</th>
                <th className="px-3 py-2 text-right">Reported $</th>
                <th className="px-3 py-2 text-right">GW</th>
                <th className="px-3 py-2">Announced</th>
                <th className="px-3 py-2">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {[...contracts]
                .sort((a, b) => (b.value_usd_b ?? 0) - (a.value_usd_b ?? 0))
                .map(c => (
                  <tr key={c.id} className="align-top hover:bg-zinc-900/40">
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: KIND_COLORS[c.kind] }} />
                        <button type="button" className="font-medium text-zinc-200 hover:underline"
                                onClick={() => onSelect({ kind: 'company', id: c.buyer_id })}>
                          {names.get(c.buyer_id) ?? c.buyer_id}
                        </button>
                        <span className="text-zinc-600">→</span>
                        <button type="button" className="font-medium text-zinc-200 hover:underline"
                                onClick={() => onSelect({ kind: 'company', id: c.seller_id })}>
                          {names.get(c.seller_id) ?? c.seller_id}
                        </button>
                      </div>
                      <div className="mt-0.5 text-fg-muted">{c.headline}</div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-zinc-100">
                      {c.value_usd_b ? `$${c.value_usd_b}B` : '—'}
                      {c.status === 'reported' && <span className="ml-1 text-[9px] text-amber-500/80" title="Credible press reporting; not confirmed by both parties">rep.</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-fg-muted">
                      {c.gigawatts ?? '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 font-mono text-fg-muted">{c.announced}</td>
                    <td className="px-3 py-2.5 text-fg-muted">{c.source}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-[11px] leading-relaxed text-zinc-600">
          Hand-curated from public announcements and named-outlet reporting. Headline values are
          maximum commitments, frequently staged over multiple years and contingent on deployment
          milestones. Nothing here is investment advice.
        </p>
      </div>
    </div>
  )
}

'use client'

/**
 * Supply Chain Strip — horizontal bottleneck dashboard.
 *
 * Sits below the top bar, above the rest of the chrome. Five chain layers,
 * each rendered as a chip with a tightness color (green = healthy, yellow =
 * warn, red = alert). Each chip shows the most decision-relevant headline
 * value for that layer.
 *
 *   FUEL    Henry Hub $3.42 · Coal stocks 78d
 *   POWER   Retail 14.1¢/kWh · Nuclear off 5%
 *   GRID    PJM tight (+16%) · ERCO ok
 *   FAB     TWN 287 TWh +1.2% YoY
 *   DC      OpenAI hiring +49 7d
 *   MODELS  Google 1B downloads / 30d
 *
 * Click a chip → expands a tray showing all signals in that layer.
 *
 * Tightness colors come from EIA_SERIES_CATALOG tightnessRule entries, plus
 * layer-specific heuristics for ones the catalog doesn't enumerate.
 */

import { useMemo, useState } from 'react'
import type { GraphData } from '@/lib/graph-data'
import { EIA_SERIES_CATALOG, type ChainLayer } from '@/lib/eia-catalog'

interface ChainEntry {
  series_id: string
  label: string
  value: number
  unit: string
  // 'green' | 'yellow' | 'red' — derived from tightnessRule
  tone: 'green' | 'yellow' | 'red' | 'neutral'
  // Optional delta vs prior snapshot
  delta?: number | null
  date: string
}

interface ChainLayerSummary {
  layer: ChainLayer | 'fab' | 'dc' | 'models'
  label: string
  emoji: string
  worstTone: 'green' | 'yellow' | 'red' | 'neutral'
  entries: ChainEntry[]
  /** One-line headline displayed in the chip. */
  headline: string
}

const TONE_DOT: Record<string, string> = {
  green:   'bg-emerald-400',
  yellow:  'bg-amber-400',
  red:     'bg-red-400',
  neutral: 'bg-zinc-600',
}
const TONE_TEXT: Record<string, string> = {
  green:   'text-emerald-300',
  yellow:  'text-amber-300',
  red:     'text-red-300',
  neutral: 'text-zinc-400',
}
const TONE_RING: Record<string, string> = {
  green:   'ring-emerald-500/30',
  yellow:  'ring-amber-500/40',
  red:     'ring-red-500/50',
  neutral: 'ring-zinc-700',
}

function worstOf(tones: Array<ChainEntry['tone']>): ChainEntry['tone'] {
  if (tones.includes('red')) return 'red'
  if (tones.includes('yellow')) return 'yellow'
  if (tones.includes('green')) return 'green'
  return 'neutral'
}

function deriveCommodityTone(seriesId: string, value: number): ChainEntry['tone'] {
  const spec = EIA_SERIES_CATALOG.find(s => s.id === seriesId)
  if (!spec?.tightnessRule) return 'neutral'
  const { direction, warnAt, alertAt } = spec.tightnessRule
  if (direction === 'high-is-tight') {
    if (value >= alertAt) return 'red'
    if (value >= warnAt) return 'yellow'
    return 'green'
  }
  if (value <= alertAt) return 'red'
  if (value <= warnAt) return 'yellow'
  return 'green'
}

function deriveNukeOutageTone(pctOffline: number): ChainEntry['tone'] {
  // Outage % parsed out of the label string in the cron, e.g. "US nuclear offline (4.2%)".
  // Higher = more tight (less nuclear capacity available).
  if (pctOffline >= 15) return 'red'
  if (pctOffline >= 8) return 'yellow'
  return 'green'
}

function fmtNum(v: number, unit: string): string {
  if (unit === 'USD/MMBtu') return `$${v.toFixed(2)}`
  if (unit === 'cents/kWh') return `${v.toFixed(1)}¢`
  if (unit === '%') return `${v.toFixed(1)}%`
  if (unit === 'MMT CO2') return `${Math.round(v).toLocaleString()} MMT`
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M ${unit}`
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k ${unit}`
  return `${Math.round(v * 100) / 100} ${unit}`
}

export default function SupplyChainStrip({ data }: { data: GraphData }) {
  const [expanded, setExpanded] = useState<string | null>(null)

  const summary = useMemo<ChainLayerSummary[]>(() => {
    // Group commodities by their catalog layer + a synthesized "fab/dc/models" layer
    const bySeriesLatest = new Map<string, GraphData['eiaCommodities'][number]>()
    for (const c of data.eiaCommodities) {
      const cur = bySeriesLatest.get(c.series_id)
      if (!cur || c.snapshot_date > cur.snapshot_date) bySeriesLatest.set(c.series_id, c)
    }

    // ----- FUEL -----
    const fuelEntries: ChainEntry[] = []
    for (const spec of EIA_SERIES_CATALOG.filter(s => s.layer === 'fuel')) {
      const c = bySeriesLatest.get(spec.id)
      if (!c) continue
      fuelEntries.push({
        series_id: spec.id,
        label: spec.label,
        value: c.value,
        unit: c.unit,
        tone: deriveCommodityTone(spec.id, c.value),
        date: c.snapshot_date,
      })
    }

    // ----- POWER -----
    const powerEntries: ChainEntry[] = []
    for (const spec of EIA_SERIES_CATALOG.filter(s => s.layer === 'power')) {
      const c = bySeriesLatest.get(spec.id)
      if (!c) continue
      powerEntries.push({
        series_id: spec.id,
        label: spec.label,
        value: c.value,
        unit: c.unit,
        tone: deriveCommodityTone(spec.id, c.value),
        date: c.snapshot_date,
      })
    }
    // Add nuclear outage from the dedicated row (series_id = 'NUC.OUTAGE_US.D')
    const nuke = bySeriesLatest.get('NUC.OUTAGE_US.D')
    if (nuke) {
      // Pct parsed out of "US nuclear offline (4.2%)" label
      const m = (nuke.label ?? '').match(/\(([0-9.]+)%\)/)
      const pct = m ? Number(m[1]) : NaN
      powerEntries.push({
        series_id: 'NUC.OUTAGE_US.D',
        label: 'US nuclear offline',
        value: Number.isFinite(pct) ? pct : nuke.value,
        unit: Number.isFinite(pct) ? '%' : 'MW',
        tone: Number.isFinite(pct) ? deriveNukeOutageTone(pct) : 'neutral',
        date: nuke.snapshot_date,
      })
    }

    // ----- GRID — derived from grid_demand_snapshots (per-region tightness via YoY%) -----
    const gridEntries: ChainEntry[] = []
    const byRegion = new Map<string, GraphData['gridDemand'][number]>()
    for (const g of data.gridDemand) {
      const cur = byRegion.get(g.region)
      if (!cur || g.snapshot_date > cur.snapshot_date) byRegion.set(g.region, g)
    }
    for (const [region, g] of byRegion) {
      const yoy = g.yoy_change_pct ?? 0
      let tone: ChainEntry['tone'] = 'green'
      if (yoy >= 10) tone = 'red'
      else if (yoy >= 5) tone = 'yellow'
      gridEntries.push({
        series_id: `GRID.${region}`,
        label: region,
        value: (g.current_7d_avg_mwh ?? 0) / 1000,           // → GWh
        unit: 'GWh',
        tone,
        delta: yoy,
        date: g.snapshot_date,
      })
    }
    gridEntries.sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0))

    // ----- FAB (international) -----
    const fabEntries: ChainEntry[] = []
    const byCountry = new Map<string, GraphData['eiaInternational'][number]>()
    for (const i of data.eiaInternational) {
      const cur = byCountry.get(i.country_id)
      if (!cur || i.snapshot_date > cur.snapshot_date) byCountry.set(i.country_id, i)
    }
    for (const [, i] of byCountry) {
      const yoy = i.yoy_pct ?? 0
      let tone: ChainEntry['tone'] = 'green'
      // Falling generation in a fab country is the bottleneck signal
      if (yoy <= -3) tone = 'red'
      else if (yoy <= 0) tone = 'yellow'
      fabEntries.push({
        series_id: `INTL.${i.country_id}`,
        label: `${i.country_label} (${i.fab_exposure})`,
        value: i.net_generation_twh,
        unit: 'TWh',
        tone,
        delta: yoy,
        date: i.snapshot_date,
      })
    }
    fabEntries.sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0))

    // ----- SILICON — patent R&D velocity per co. The chips/foundry/equipment
    // layer of the stack, signalled by USPTO TTM filings + CPC distribution. -----
    const siliconEntries: ChainEntry[] = []
    const patentsByCo = new Map<string, GraphData['patents'][number]>()
    for (const p of data.patents) {
      const cur = patentsByCo.get(p.company_id)
      if (!cur || p.snapshot_date > cur.snapshot_date) patentsByCo.set(p.company_id, p)
    }
    for (const [coId, p] of patentsByCo) {
      const co = data.companies.find(c => c.id === coId)
      if (!co) continue
      // Top CPC subclass distills "what kind of R&D" — useful one-line label
      const topCpc = Array.isArray(p.top_subclasses) && p.top_subclasses[0]
        ? p.top_subclasses[0].code
        : null
      siliconEntries.push({
        series_id: `IP.${coId}`,
        label: `${co.ticker ?? co.name}${topCpc ? ' · ' + topCpc : ''}`,
        value: p.ttm_count,
        unit: 'TTM',
        tone: 'green',                                  // patent count is informational not tightness
        date: p.snapshot_date,
      })
    }
    siliconEntries.sort((a, b) => b.value - a.value)

    // ----- DC — hiring ramps + power-pressure cos -----
    const dcEntries: ChainEntry[] = []
    const jobsByCo = new Map<string, GraphData['jobs']>()
    for (const j of data.jobs) {
      const arr = jobsByCo.get(j.company_id) ?? []
      arr.push(j)
      jobsByCo.set(j.company_id, arr)
    }
    for (const [coId, snaps] of jobsByCo) {
      const sorted = snaps.slice().sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date))
      const latest = sorted[0]
      if (!latest) continue
      // 7d delta
      const target = new Date(latest.snapshot_date).getTime() - 7 * 86_400_000
      let prior: typeof latest | null = null
      let bestDelta = Infinity
      for (const s of sorted) {
        const d = Math.abs(new Date(s.snapshot_date).getTime() - target)
        if (d < bestDelta) { bestDelta = d; prior = s }
      }
      const delta = prior && bestDelta < 4 * 86_400_000 ? latest.total_open - prior.total_open : null
      let tone: ChainEntry['tone'] = 'green'
      if (delta != null && delta >= 30) tone = 'red'         // demand outstripping supply (= hiring frenzy)
      else if (delta != null && delta >= 15) tone = 'yellow'
      const co = data.companies.find(c => c.id === coId)
      if (!co) continue
      dcEntries.push({
        series_id: `JOBS.${coId}`,
        label: co.ticker ?? co.name,
        value: latest.total_open,
        unit: 'open',
        tone,
        delta,
        date: latest.snapshot_date,
      })
    }
    dcEntries.sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0))

    // ----- MODELS — HF activity (top orgs by 30d downloads) -----
    const modelsEntries: ChainEntry[] = []
    const hfByCo = new Map<string, GraphData['hfActivity'][number]>()
    for (const h of data.hfActivity) {
      const cur = hfByCo.get(h.company_id)
      if (!cur || h.snapshot_date > cur.snapshot_date) hfByCo.set(h.company_id, h)
    }
    for (const [coId, h] of hfByCo) {
      const co = data.companies.find(c => c.id === coId)
      if (!co || !h.total_downloads_30d) continue
      modelsEntries.push({
        series_id: `HF.${coId}`,
        label: co.name,
        value: h.total_downloads_30d,
        unit: 'dl/30d',
        tone: 'green',
        date: h.snapshot_date,
      })
    }
    modelsEntries.sort((a, b) => b.value - a.value)

    return [
      {
        layer: 'fuel',
        label: 'FUEL',
        emoji: '🛢',
        entries: fuelEntries,
        worstTone: worstOf(fuelEntries.map(e => e.tone)),
        headline: fuelEntries.length === 0
          ? 'no data'
          : `${fuelEntries[0].label} ${fmtNum(fuelEntries[0].value, fuelEntries[0].unit)}`,
      },
      {
        layer: 'power',
        label: 'POWER',
        emoji: '⚡️',
        entries: powerEntries,
        worstTone: worstOf(powerEntries.map(e => e.tone)),
        headline: powerEntries.length === 0
          ? 'no data'
          : `${powerEntries[0].label} ${fmtNum(powerEntries[0].value, powerEntries[0].unit)}`,
      },
      {
        layer: 'grid',
        label: 'GRID',
        emoji: '⚙️',
        entries: gridEntries,
        worstTone: worstOf(gridEntries.map(e => e.tone)),
        headline: gridEntries.length === 0
          ? 'no data'
          : `${gridEntries[0].label} ${gridEntries[0].delta != null ? (gridEntries[0].delta >= 0 ? '+' : '') + gridEntries[0].delta.toFixed(1) + '% YoY' : ''}`,
      },
      {
        layer: 'fab',
        label: 'FAB',
        emoji: '🏭',
        entries: fabEntries,
        worstTone: worstOf(fabEntries.map(e => e.tone)),
        headline: fabEntries.length === 0
          ? 'no data'
          : `${fabEntries[0].label.split(' ')[0]} ${fmtNum(fabEntries[0].value, fabEntries[0].unit)}`,
      },
      {
        layer: 'silicon',
        label: 'SILICON',
        emoji: '💎',
        entries: siliconEntries,
        worstTone: 'green',                              // informational, not tightness
        headline: siliconEntries.length === 0
          ? 'no data'
          : `${siliconEntries[0].label} ${siliconEntries[0].value} TTM`,
      },
      {
        layer: 'dc',
        label: 'DC',
        emoji: '🖥',
        entries: dcEntries,
        worstTone: worstOf(dcEntries.map(e => e.tone)),
        headline: dcEntries.length === 0
          ? 'no data'
          : `${dcEntries[0].label} ${dcEntries[0].delta != null && dcEntries[0].delta > 0 ? '+' + dcEntries[0].delta : ''}/7d`,
      },
      {
        layer: 'models',
        label: 'MODELS',
        emoji: '🧠',
        entries: modelsEntries,
        worstTone: 'green',
        headline: modelsEntries.length === 0
          ? 'no data'
          : `${modelsEntries[0].label} ${fmtNum(modelsEntries[0].value, modelsEntries[0].unit)}`,
      },
    ]
  }, [data])

  const hasAnyData = summary.some(s => s.entries.length > 0)
  if (!hasAnyData) return null

  return (
    <div className="pointer-events-auto absolute left-1/2 top-14 z-10 -translate-x-1/2">
      <div className="flex gap-1 rounded border border-zinc-800 bg-zinc-950/85 p-1 text-[10px] font-mono backdrop-blur">
        {summary.map((s) => {
          const isOpen = expanded === s.label
          const hasData = s.entries.length > 0
          return (
            <button
              key={s.label}
              type="button"
              onClick={() => setExpanded(isOpen ? null : s.label)}
              className={
                'flex items-center gap-1.5 rounded px-2 py-1 ring-1 transition ' +
                TONE_RING[s.worstTone] + ' ' +
                (isOpen ? 'bg-zinc-900' : 'bg-transparent hover:bg-zinc-900/60') +
                (!hasData ? ' opacity-40' : '')
              }
            >
              <span className={'inline-block h-1.5 w-1.5 rounded-full ' + TONE_DOT[s.worstTone]} />
              <span className="text-zinc-200">{s.label}</span>
              <span className={'text-[10px] ' + TONE_TEXT[s.worstTone]}>{s.headline}</span>
            </button>
          )
        })}
      </div>

      {/* Expanded tray */}
      {expanded && (() => {
        const s = summary.find(x => x.label === expanded)
        if (!s || s.entries.length === 0) return null
        return (
          <div className="mt-1 max-h-[300px] w-[420px] overflow-y-auto rounded border border-zinc-800 bg-zinc-950/95 p-3 text-[11px] font-mono backdrop-blur">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="uppercase tracking-wider text-zinc-400">{s.emoji} {s.label} layer · {s.entries.length} series</span>
              <button
                onClick={() => setExpanded(null)}
                className="text-zinc-600 hover:text-zinc-300"
              >×</button>
            </div>
            <div className="space-y-1">
              {s.entries.map(e => (
                <div key={e.series_id} className="flex items-baseline justify-between gap-2 rounded px-1 py-0.5 hover:bg-zinc-900/60">
                  <span className="flex items-center gap-1.5 truncate">
                    <span className={'inline-block h-1.5 w-1.5 shrink-0 rounded-full ' + TONE_DOT[e.tone]} />
                    <span className="text-zinc-200 truncate">{e.label}</span>
                  </span>
                  <span className="flex shrink-0 items-baseline gap-2 text-zinc-400">
                    <span className={TONE_TEXT[e.tone]}>{fmtNum(e.value, e.unit)}</span>
                    {e.delta != null && (
                      <span className={'text-[10px] ' + (e.delta >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                        {e.delta >= 0 ? '+' : ''}{e.delta.toFixed(1)}%
                      </span>
                    )}
                    <span className="text-[9px] text-zinc-600">{e.date.slice(5)}</span>
                  </span>
                </div>
              ))}
            </div>
            {/* POWER tray gets the AEO 2026 long-term forecast block */}
            {s.label === 'POWER' && <AeoForecastBlock projections={data.aeoProjections} />}
          </div>
        )
      })()}
    </div>
  )
}

// ---------- AEO 2026 long-term forecast block ----------
//
// Shown only in the POWER tray. Surfaces EIA's official AEO data center
// purchased-electricity projection across the 3 scenarios for 2030 + 2050,
// plus the "EIA revised UP" delta vs AEO 2025 — that's the headline.

function AeoForecastBlock({ projections }: { projections: GraphData['aeoProjections'] }) {
  const purchased = projections.filter(p => p.metric === 'dc_demand_purchased')
  if (purchased.length === 0) return null
  // Pivot: by scenario, latest values for 2030 + 2050
  const byKey = (scenario: string, year: number): number | null => {
    const r = purchased.find(p => p.scenario === scenario && p.projection_year === year)
    return r ? r.value_twh : null
  }
  const ref25_2030 = byKey('AEO2025REF', 2030)
  const cb_2030    = byKey('CB2026',     2030)
  const ai_2030    = byKey('HIGHELDMD',  2030)
  const ref25_2050 = byKey('AEO2025REF', 2050)
  const cb_2050    = byKey('CB2026',     2050)
  const ai_2050    = byKey('HIGHELDMD',  2050)

  const upRev2030 = ref25_2030 && cb_2030 ? ((cb_2030 - ref25_2030) / ref25_2030) * 100 : null

  return (
    <div className="mt-3 border-t border-zinc-800 pt-2">
      <div className="mb-1 text-[10px] uppercase tracking-widest text-zinc-500">
        AEO 2026 · US DC purchased electricity (TWh)
      </div>
      <table className="w-full font-mono text-[10px]">
        <thead className="text-[9px] uppercase text-zinc-600">
          <tr>
            <th className="text-left">scenario</th>
            <th className="text-right">2030</th>
            <th className="text-right">2050</th>
          </tr>
        </thead>
        <tbody>
          <tr className="text-zinc-400">
            <td>AEO 2025 ref</td>
            <td className="text-right">{ref25_2030?.toFixed(0) ?? '—'}</td>
            <td className="text-right">{ref25_2050?.toFixed(0) ?? '—'}</td>
          </tr>
          <tr className="text-zinc-200">
            <td>AEO 2026 baseline</td>
            <td className="text-right">{cb_2030?.toFixed(0) ?? '—'}</td>
            <td className="text-right">{cb_2050?.toFixed(0) ?? '—'}</td>
          </tr>
          <tr className="text-amber-300">
            <td>AI bull case</td>
            <td className="text-right">{ai_2030?.toFixed(0) ?? '—'}</td>
            <td className="text-right">{ai_2050?.toFixed(0) ?? '—'}</td>
          </tr>
        </tbody>
      </table>
      {upRev2030 != null && (
        <div className="mt-1 text-[10px] text-amber-200">
          EIA revised 2030 baseline {upRev2030 >= 0 ? '+' : ''}{upRev2030.toFixed(0)}% vs AEO 2025
        </div>
      )}
    </div>
  )
}

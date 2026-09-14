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
 *   GPU     $2.31/H100/hr (blended) · AWS $3.12 · Azure $3.45
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
  layer: ChainLayer | 'fab' | 'dc' | 'models' | 'btc' | 'gpu'
  label: string
  emoji: string
  worstTone: 'green' | 'yellow' | 'red' | 'neutral'
  entries: ChainEntry[]
  /** One-line headline displayed in the chip. */
  headline: string
}

const TONE_DOT: Record<string, string> = {
  green:   'bg-signal-healthy',
  yellow:  'bg-signal-warn',
  red:     'bg-signal-alert',
  neutral: 'bg-fg-dim',
}
const TONE_TEXT: Record<string, string> = {
  green:   'text-signal-healthy',
  yellow:  'text-feed-hf',
  red:     'text-signal-alert',
  neutral: 'text-fg-secondary',
}
const TONE_RING: Record<string, string> = {
  green:   'ring-signal-healthy/30',
  yellow:  'ring-signal-warn/40',
  red:     'ring-signal-alert/50',
  neutral: 'ring-border-strong',
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

/** 'desktop' (default) renders the horizontal floating strip pinned top-center.
    'mobile' renders a vertical stack of full-width chips for use inside the
    parent MobileSheet. */
export default function SupplyChainStrip({ data, variant = 'desktop' }: { data: GraphData; variant?: 'desktop' | 'mobile' }) {
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

    // ----- GPU — blended spot prices across Vast.ai + RunPod (gpu_spot_prices
    // table). The H100 line is the headline: $/H100/hr is the cleanest
    // training-demand thermometer we have. Tone per task spec:
    //   red    if H100 blended median > $3.00 /hr   (training market saturated)
    //   yellow if      $2.51 ..  3.00 /hr
    //   green  if              ≤ $2.00 /hr            (visible slack)
    //   (between green and yellow the chip stays green — narrow window)
    //
    // Expanded tray lists ALL models with their blended median + 24h delta.
    // Per-model delta = today's blended row vs yesterday's blended row.
    const gpuEntries: ChainEntry[] = []
    const gpuBlendedLatestByModel = new Map<string, GraphData['gpuSpot'][number]>()
    const gpuBlendedPriorByModel = new Map<string, GraphData['gpuSpot'][number]>()
    for (const row of data.gpuSpot) {
      if (row.source !== 'blended') continue
      const cur = gpuBlendedLatestByModel.get(row.gpu_model)
      if (!cur || row.snapshot_date > cur.snapshot_date) {
        // promote cur → prior, row → latest
        if (cur) gpuBlendedPriorByModel.set(row.gpu_model, cur)
        gpuBlendedLatestByModel.set(row.gpu_model, row)
      } else {
        const prior = gpuBlendedPriorByModel.get(row.gpu_model)
        if (!prior || row.snapshot_date > prior.snapshot_date) {
          gpuBlendedPriorByModel.set(row.gpu_model, row)
        }
      }
    }
    // Order chips: H100 SXM5 first, then H100 PCIe, H200, B200, A100 80GB, A100 40GB, RTX 4090, RTX 3090
    const GPU_DISPLAY_ORDER = [
      'H100 80GB SXM5',
      'H100 80GB PCIe',
      'H200',
      'B200',
      'A100 80GB',
      'A100 40GB',
      'RTX 4090',
      'RTX 3090',
    ]
    for (const model of GPU_DISPLAY_ORDER) {
      const latest = gpuBlendedLatestByModel.get(model)
      if (!latest) continue
      const prior = gpuBlendedPriorByModel.get(model)
      const deltaPct = prior && prior.median_usd_per_hour > 0
        ? ((latest.median_usd_per_hour - prior.median_usd_per_hour) / prior.median_usd_per_hour) * 100
        : null
      let tone: ChainEntry['tone'] = 'green'
      // Same H100 thresholds applied per-model so the tray visually agrees with the headline.
      if (model.startsWith('H100') || model === 'H200' || model === 'B200') {
        if (latest.median_usd_per_hour > 3.0) tone = 'red'
        else if (latest.median_usd_per_hour > 2.5) tone = 'yellow'
        else tone = 'green'
      }
      gpuEntries.push({
        series_id: `GPU.${model}`,
        label: model,
        value: latest.median_usd_per_hour,
        unit: '$/hr',
        tone,
        delta: deltaPct,
        date: latest.snapshot_date,
      })
    }
    // Headline tone: drive off the most-rented production GPU (H100 SXM5),
    // falling back to H100 PCIe → H200 if no SXM5 data yet.
    const headlineGpu =
      gpuBlendedLatestByModel.get('H100 80GB SXM5') ??
      gpuBlendedLatestByModel.get('H100 80GB PCIe') ??
      gpuBlendedLatestByModel.get('H200')
    let gpuChipTone: ChainEntry['tone'] = 'neutral'
    if (headlineGpu) {
      if (headlineGpu.median_usd_per_hour > 3.0) gpuChipTone = 'red'
      else if (headlineGpu.median_usd_per_hour > 2.5) gpuChipTone = 'yellow'
      else gpuChipTone = 'green'
    }

    // ----- BTC — global mining as a "compute spend" proxy. Hashrate ↑ ⇒ the
    // world is buying more ASICs and renting more grid power, which competes
    // with hyperscaler buildout. We pull three series from eia_commodity_snapshots
    // that the /api/cron/btc route populates from mempool.space.
    //
    // Tone rule per task spec: difficulty rising (last_adj_pct > 0, parsed
    // out of the BTC.DIFFICULTY.D label) = healthy (more demand for compute),
    // falling = warn.
    const btcEntries: ChainEntry[] = []
    const btcHash = bySeriesLatest.get('BTC.HASHRATE.D')
    const btcDiff = bySeriesLatest.get('BTC.DIFFICULTY.D')
    const btcPower = bySeriesLatest.get('BTC.NETWORK_POWER.D')
    // Parse adjustment % from the difficulty label, e.g. "BTC difficulty (last adj +3.12%)"
    let btcAdjPct: number | null = null
    if (btcDiff) {
      const m = (btcDiff.label ?? '').match(/last adj ([+-]?[0-9.]+)%/)
      if (m) btcAdjPct = Number(m[1])
    }
    const diffTone: ChainEntry['tone'] =
      btcAdjPct == null ? 'neutral' : btcAdjPct >= 0 ? 'green' : 'yellow'
    if (btcHash) {
      btcEntries.push({
        series_id: 'BTC.HASHRATE.D',
        label: 'Network hashrate',
        value: btcHash.value,
        unit: btcHash.unit,
        tone: diffTone,                  // hashrate inherits the difficulty trend tone
        date: btcHash.snapshot_date,
      })
    }
    if (btcDiff) {
      btcEntries.push({
        series_id: 'BTC.DIFFICULTY.D',
        label: 'Difficulty',
        // Display difficulty in trillions for readability (raw ~136T)
        value: btcDiff.value / 1e12,
        unit: 'T',
        tone: diffTone,
        delta: btcAdjPct,
        date: btcDiff.snapshot_date,
      })
    }
    if (btcPower) {
      btcEntries.push({
        series_id: 'BTC.NETWORK_POWER.D',
        label: 'Est. network draw',
        value: btcPower.value,
        unit: btcPower.unit,
        tone: diffTone,
        date: btcPower.snapshot_date,
      })
    }

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
        worstTone: 'green' as const,
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
        worstTone: 'green' as const,
        headline: modelsEntries.length === 0
          ? 'no data'
          : `${modelsEntries[0].label} ${fmtNum(modelsEntries[0].value, modelsEntries[0].unit)}`,
      },
      {
        layer: 'gpu',
        label: 'GPU',
        emoji: '🟩',
        entries: gpuEntries,
        worstTone: gpuChipTone,
        headline: gpuEntries.length === 0
          ? 'no data'
          : headlineGpu
            ? `$${headlineGpu.median_usd_per_hour.toFixed(2)}/H100/hr`
            : `$${gpuEntries[0].value.toFixed(2)}/${gpuEntries[0].label.split(' ')[0]}/hr`,
      },
      {
        layer: 'btc',
        label: 'BTC',
        emoji: '₿',
        entries: btcEntries,
        worstTone: worstOf(btcEntries.map(e => e.tone)),
        headline: btcEntries.length === 0
          ? 'no data'
          : btcHash
            ? `${Math.round(btcHash.value)} EH/s${btcAdjPct != null ? ` · ${btcAdjPct >= 0 ? '+' : ''}${btcAdjPct.toFixed(1)}% adj` : ''}`
            : `${btcEntries[0].label} ${fmtNum(btcEntries[0].value, btcEntries[0].unit)}`,
      },
    ] as ChainLayerSummary[]
  }, [data])

  const hasAnyData = summary.some(s => s.entries.length > 0)

  // Hyperscaler cheapest spot per (model, provider) — computed directly from data
  // for the tray renderer. Defined before any early return so hook order is stable.
  const hyperBest = useMemo(() => {
    const m = new Map<string, { provider: string; region: string; spotPerGpu: number }>()
    for (const row of data.gpuHyperscaler) {
      if (row.spot_usd_per_gpu_hour == null) continue
      const key = `${row.gpu_model}::${row.provider}`
      const cur = m.get(key)
      if (!cur || row.spot_usd_per_gpu_hour < cur.spotPerGpu) {
        m.set(key, { provider: row.provider, region: row.region, spotPerGpu: row.spot_usd_per_gpu_hour })
      }
    }
    return m
  }, [data.gpuHyperscaler])

  // Rental market availability squeeze signals: countries where Vast.ai listing
  // count dropped >50% in the last 7 days for a GPU model.
  const squeezeSignals = useMemo(() => {
    const out: Array<{ gpu_model: string; country: string; todayCount: number; priorCount: number; dropPct: number }> = []
    const cut7dDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const vastByModel = new Map<string, Array<{ date: string; byRegion: Record<string, number> }>>()
    for (const row of data.gpuSpot) {
      if (row.source !== 'vast.ai') continue
      const byRegion = row.listing_count_by_region as Record<string, number> | null
      if (!byRegion || Object.keys(byRegion).length === 0) continue
      const arr = vastByModel.get(row.gpu_model) ?? []
      arr.push({ date: row.snapshot_date, byRegion })
      vastByModel.set(row.gpu_model, arr)
    }
    for (const [model, rows] of vastByModel) {
      const sorted = rows.slice().sort((a, b) => b.date.localeCompare(a.date))
      const latest = sorted[0]; if (!latest) continue
      const prior = sorted.find(r => r.date <= cut7dDate); if (!prior) continue
      for (const [country, todayCount] of Object.entries(latest.byRegion)) {
        const priorCount = prior.byRegion[country] ?? 0
        if (priorCount === 0) continue
        const dropPct = ((priorCount - todayCount) / priorCount) * 100
        if (dropPct >= 50) out.push({ gpu_model: model, country, todayCount, priorCount, dropPct })
      }
    }
    return out
  }, [data.gpuSpot])

  if (!hasAnyData) return null

  // ----- MOBILE variant: vertical stack inside the parent MobileSheet -----
  //
  // Each chip is full-width with its headline on its own line so dense
  // values don't truncate. Tap to expand the layer's detail tray inline.
  if (variant === 'mobile') {
    return (
      <div className="space-y-2 px-3 py-3 text-meta font-mono">
        {summary.map((s) => {
          const isOpen = expanded === s.label
          const hasData = s.entries.length > 0
          return (
            <div
              key={s.label}
              className={'overflow-hidden rounded-card border ring-1 ' + TONE_RING[s.worstTone] +
                (hasData ? ' border-border-default' : ' border-border-subtle opacity-40')}
            >
              <button
                type="button"
                disabled={!hasData}
                onClick={() => setExpanded(isOpen ? null : s.label)}
                className={
                  'flex min-h-11 w-full flex-col items-start gap-1 px-3 py-2 text-left transition ' +
                  (isOpen ? 'bg-bg-surface' : 'bg-bg-overlay hover:bg-bg-surface/60')
                }
              >
                <span className="flex items-center gap-2">
                  <span className={'inline-block h-1.5 w-1.5 rounded-full ' + TONE_DOT[s.worstTone]} />
                  <span className="text-label text-fg-primary">{s.emoji} {s.label}</span>
                  <span className="ml-1 text-fg-dim">{s.entries.length} series</span>
                </span>
                <span className={'text-body ' + TONE_TEXT[s.worstTone]}>{s.headline}</span>
              </button>
              {isOpen && hasData && (
                <div className="space-y-1 border-t border-border-subtle bg-bg-overlay px-3 py-2">
                  {s.entries.map(e => (
                    <div key={e.series_id} className="flex items-baseline justify-between gap-2 rounded px-1 py-1">
                      <span className="flex items-center gap-1.5 truncate">
                        <span className={'inline-block h-1.5 w-1.5 shrink-0 rounded-full ' + TONE_DOT[e.tone]} />
                        <span className="text-fg-primary truncate">{e.label}</span>
                      </span>
                      <span className="flex shrink-0 items-baseline gap-2 text-fg-secondary">
                        <span className={TONE_TEXT[e.tone]}>{fmtNum(e.value, e.unit)}</span>
                        {e.delta != null && (
                          <span className={'text-meta ' + (e.delta >= 0 ? 'text-signal-healthy' : 'text-signal-alert')}>
                            {e.delta >= 0 ? '+' : ''}{e.delta.toFixed(1)}%
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                  {s.label === 'POWER' && <AeoForecastBlock projections={data.aeoProjections} />}
                  {s.label === 'GPU' && (
                    <GpuHyperscalerTable hyperBest={hyperBest} squeezeSignals={squeezeSignals} />
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  // ----- DESKTOP variant: horizontal strip pinned top-center -----
  //
  // Hidden below md: phone users reach the same content via the bottom-nav
  // "Chain" tab → MobileSheet → variant="mobile".
  // The chip rail itself is `overflow-x-auto` + `snap-x` so it touch-scrolls
  // gracefully at narrow widths (e.g. 768–1024px tablets) and each chip is
  // `flex-none` so chips never squash.
  return (
    <div className="pointer-events-none absolute left-[14rem] right-[22rem] top-14 z-10 hidden flex-col items-center md:flex">
      {/* Bounded to the gap between the layer key (left-4 + w-48) and the
          Pulse Board (right-4 + w-[320px]). Centered on the viewport with
          max-w-[calc(100vw-2rem)] it ran under both of them. The rail
          keeps its own horizontal scroll for when the gap is narrow. */}
      <div className="pointer-events-auto flex max-w-full snap-x snap-mandatory gap-1 overflow-x-auto rounded-md border border-border-default bg-bg-overlay p-1 text-meta font-mono shadow-panel backdrop-blur">
        {summary.map((s) => {
          const isOpen = expanded === s.label
          const hasData = s.entries.length > 0
          return (
            <button
              key={s.label}
              type="button"
              onClick={() => setExpanded(isOpen ? null : s.label)}
              className={
                'flex flex-none snap-start items-center gap-1.5 rounded px-2 py-1 ring-1 transition ' +
                TONE_RING[s.worstTone] + ' ' +
                (isOpen ? 'bg-bg-surface' : 'bg-transparent hover:bg-bg-surface/60') +
                (!hasData ? ' opacity-40' : '')
              }
            >
              <span className={'inline-block h-1.5 w-1.5 rounded-full ' + TONE_DOT[s.worstTone]} />
              <span className="text-fg-primary">{s.label}</span>
              <span className={'text-meta ' + TONE_TEXT[s.worstTone]}>{s.headline}</span>
            </button>
          )
        })}
      </div>

      {/* Expanded tray */}
      {expanded && (() => {
        const s = summary.find(x => x.label === expanded)
        if (!s || s.entries.length === 0) return null
        return (
          <div className="pointer-events-auto mt-1 max-h-[400px] w-[min(480px,100%)] overflow-y-auto rounded-card border border-border-default bg-bg-overlay p-3 text-[11px] font-mono shadow-panel backdrop-blur">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="uppercase tracking-wider text-fg-secondary">{s.emoji} {s.label} layer · {s.entries.length} series</span>
              <button
                onClick={() => setExpanded(null)}
                className="text-fg-dim hover:text-fg-secondary"
              >×</button>
            </div>
            <div className="space-y-1">
              {s.entries.map(e => (
                <div key={e.series_id} className="flex items-baseline justify-between gap-2 rounded px-1 py-0.5 hover:bg-bg-surface/60">
                  <span className="flex items-center gap-1.5 truncate">
                    <span className={'inline-block h-1.5 w-1.5 shrink-0 rounded-full ' + TONE_DOT[e.tone]} />
                    <span className="text-fg-primary truncate">{e.label}</span>
                  </span>
                  <span className="flex shrink-0 items-baseline gap-2 text-fg-secondary">
                    <span className={TONE_TEXT[e.tone]}>{fmtNum(e.value, e.unit)}</span>
                    {e.delta != null && (
                      <span className={'text-meta ' + (e.delta >= 0 ? 'text-signal-healthy' : 'text-signal-alert')}>
                        {e.delta >= 0 ? '+' : ''}{e.delta.toFixed(1)}%
                      </span>
                    )}
                    <span className="text-[9px] text-fg-dim">{e.date.slice(5)}</span>
                  </span>
                </div>
              ))}
            </div>
            {/* POWER tray gets the AEO 2026 long-term forecast block */}
            {s.label === 'POWER' && <AeoForecastBlock projections={data.aeoProjections} />}
            {/* GPU tray gets the hyperscaler cloud pricing table */}
            {s.label === 'GPU' && (
              <GpuHyperscalerTable hyperBest={hyperBest} squeezeSignals={squeezeSignals} />
            )}
          </div>
        )
      })()}
    </div>
  )
}



// ---------- GPU Hyperscaler Spot Pricing Table ----------
//
// Shown in the GPU tray below the per-model blended-median rows.
// 2-column table: GPU model × provider, cheapest spot per combo.
// Squeeze signals are shown as red sub-labels when Vast.ai availability
// dropped >50% in a country vs 7d ago.

type HyperscalerCellType = { provider: string; region: string; spotPerGpu: number }
type SqueezeSignalType = { gpu_model: string; country: string; todayCount: number; priorCount: number; dropPct: number }

const CLOUD_PROVIDERS = ['aws', 'azure'] as const
const HYPERSCALER_GPU_MODELS = ['H100 80GB SXM5', 'H200', 'B200', 'A100 80GB'] as const

function GpuHyperscalerTable({
  hyperBest,
  squeezeSignals,
}: {
  hyperBest: Map<string, HyperscalerCellType>
  squeezeSignals: SqueezeSignalType[]
}) {
  // Only render if we have any hyperscaler data
  const hasAny = HYPERSCALER_GPU_MODELS.some(m =>
    CLOUD_PROVIDERS.some(p => hyperBest.has(`${m}::${p}`))
  )
  if (!hasAny) return null

  // Build squeeze lookup: model → [countries with >50% drop]
  const squeezeByModel = new Map<string, SqueezeSignalType[]>()
  for (const s of squeezeSignals) {
    const arr = squeezeByModel.get(s.gpu_model) ?? []
    arr.push(s)
    squeezeByModel.set(s.gpu_model, arr)
  }

  return (
    <div className="mt-3 border-t border-border-default pt-2">
      <div className="mb-1.5 text-[9px] uppercase tracking-wider text-fg-dim">
        Cloud Spot Prices · cheapest region / provider
      </div>
      <table className="w-full text-[10px] font-mono">
        <thead>
          <tr className="text-[9px] uppercase text-fg-dim">
            <th className="text-left pb-1">GPU</th>
            {CLOUD_PROVIDERS.map(p => (
              <th key={p} className="text-right pb-1 uppercase">{p}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {HYPERSCALER_GPU_MODELS.map(model => {
            const squeezes = squeezeByModel.get(model) ?? []
            const cells = CLOUD_PROVIDERS.map(p => hyperBest.get(`${model}::${p}`) ?? null)
            // Skip row if no data for any provider
            if (cells.every(c => c === null)) return null
            return (
              <tr key={model} className="border-t border-border-subtle/30">
                <td className="py-0.5 pr-2 text-fg-secondary">
                  {model.replace(' 80GB', '').replace(' SXM5', ' SXM')}
                  {squeezes.length > 0 && (
                    <span className="ml-1 text-signal-alert" title={`Availability squeeze: ${squeezes.map(s => `${s.country} −1${s.dropPct.toFixed(0)}%`).join(', ')}`}>
                      ⚠
                    </span>
                  )}
                </td>
                {cells.map((cell, i) => (
                  <td key={CLOUD_PROVIDERS[i]} className="py-0.5 text-right">
                    {cell ? (
                      <span className="text-fg-primary">
                        ${cell.spotPerGpu.toFixed(2)}
                        <span className="ml-0.5 text-[8px] text-fg-dim">{cell.region}</span>
                      </span>
                    ) : (
                      <span className="text-fg-dim">—</span>
                    )}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
      {squeezeSignals.length > 0 && (
        <div className="mt-1.5 space-y-0.5">
          {squeezeSignals.map((s, i) => (
            <div key={i} className="text-[9px] text-signal-alert">
              ⚠ GPU squeeze: {s.country} {s.gpu_model.split(' ')[0]} −{s.dropPct.toFixed(0)}% listings vs 7d
            </div>
          ))}
        </div>
      )}
    </div>
  )
}


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
    <div className="mt-3 border-t border-border-default pt-2">
      <div className="mb-1 text-label text-fg-muted">
        AEO 2026 · US DC purchased electricity (TWh)
      </div>
      <table className="w-full font-mono text-meta">
        <thead className="text-[9px] uppercase text-fg-dim">
          <tr>
            <th className="text-left">scenario</th>
            <th className="text-right">2030</th>
            <th className="text-right">2050</th>
          </tr>
        </thead>
        <tbody>
          <tr className="text-fg-secondary">
            <td>AEO 2025 ref</td>
            <td className="text-right">{ref25_2030?.toFixed(0) ?? '—'}</td>
            <td className="text-right">{ref25_2050?.toFixed(0) ?? '—'}</td>
          </tr>
          <tr className="text-fg-primary">
            <td>AEO 2026 baseline</td>
            <td className="text-right">{cb_2030?.toFixed(0) ?? '—'}</td>
            <td className="text-right">{cb_2050?.toFixed(0) ?? '—'}</td>
          </tr>
          <tr className="text-feed-hf">
            <td>AI bull case</td>
            <td className="text-right">{ai_2030?.toFixed(0) ?? '—'}</td>
            <td className="text-right">{ai_2050?.toFixed(0) ?? '—'}</td>
          </tr>
        </tbody>
      </table>
      {upRev2030 != null && (
        <div className="mt-1 text-meta text-feed-hf">
          EIA revised 2030 baseline {upRev2030 >= 0 ? '+' : ''}{upRev2030.toFixed(0)}% vs AEO 2025
        </div>
      )}
    </div>
  )
}

'use client'

/**
 * Global ⌘K command palette — Feature #8 on the strategic roadmap.
 *
 * Single entry point for everything in the app: jump to any entity (company,
 * investor, bottleneck), surface a recent signal, filter by sector/layer, or
 * dispatch a named command ("today's hiring ramps", "show held positions",
 * etc.). Pure client-side fuzzy search across an in-memory corpus — no API
 * routes, no extra deps.
 *
 * Categories:
 *   - Entities   companies + investors + bottlenecks (the legacy corpus)
 *   - Signals    last-14d top 50 8-K/news headlines; opens linked co's drawer
 *   - Sectors    each layer ("labs", "infrastructure", ...) — filters the graph
 *   - Commands   ~10 hardcoded actions (Pulse Board hiring focus, held-only,
 *                power-tight regions, frontier-model leaderboard, ...)
 *
 * Ranking tiers (high → low):
 *   1. Exact ticker match           ("NVDA" → NVIDIA top)
 *   2. Word-boundary prefix match   ("anth" → "Anthropic")
 *   3. Substring in primary label
 *   4. Substring in sub-text
 *   Plus: recently-clicked entities (sessionStorage) get a tier-internal bump.
 *
 * Keyboard:
 *   ⌘K / Ctrl-K  toggle      ↑/↓ navigate     Enter select
 *   Tab          cycle categories             Esc close
 *
 * Hit dispatch:
 *   - entity hits → onSelect(SelectedRef) (legacy)
 *   - signal hits → onSelect with linked company SelectedRef (if any)
 *   - sector hits → custom DOM event 'cc:sector-filter' { layerId }
 *   - command hits → custom DOM event 'cc:command' { commandId }
 *
 * Parent compute-graph listens for the DOM events. No new state libraries.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { GraphData } from '@/lib/graph-data'
import type { SelectedRef } from './compute-graph'

// ---------- types ----------

type HitKind = 'company' | 'investor' | 'bottleneck' | 'agency' | 'signal' | 'sector' | 'command'
type HitCategory = 'entities' | 'signals' | 'sectors' | 'commands'

interface BaseHit {
  kind: HitKind
  category: HitCategory
  /** stable id, also used for "recently visited" memo */
  id: string
  label: string
  sub: string | null
  /** ticker / short token for tier-1 exact-match scoring */
  ticker?: string | null
  /** for signal hits — the company to jump to when selected */
  linkedCompanyId?: string | null
  /** for sector hits — the layer id to filter on */
  layerId?: string | null
  /** for command hits — emitted on the cc:command event */
  commandId?: string | null
  // Precomputed index fields for O(1) lowercasing and indexing during typing
  _labelLower?: string
  _subLower?: string
  _tickerLower?: string
  _labelWords?: string[]
}
type Hit = BaseHit

interface Props {
  data: GraphData
  onClose: () => void
  /** Legacy entity drawer dispatch */
  onSelect: (sel: SelectedRef) => void
}

// ---------- recently-visited memo (sessionStorage) ----------

const RECENT_KEY = 'cc.palette.recent'
const RECENT_MAX = 5

interface RecentEntry { hitKey: string; ts: number }

function readRecent(): RecentEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = sessionStorage.getItem(RECENT_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is RecentEntry => x && typeof x.hitKey === 'string')
  } catch {
    return []
  }
}

function pushRecent(hitKey: string) {
  if (typeof window === 'undefined') return
  const cur = readRecent().filter(e => e.hitKey !== hitKey)
  cur.unshift({ hitKey, ts: Date.now() })
  try {
    sessionStorage.setItem(RECENT_KEY, JSON.stringify(cur.slice(0, RECENT_MAX)))
  } catch { /* quota or denied — fine */ }
}

// ---------- hardcoded commands ----------

interface CommandSpec {
  commandId: string
  label: string
  sub: string
}

const COMMANDS: CommandSpec[] = [
  { commandId: 'pulse.hiring',         label: "Today's hiring ramps",      sub: 'Pulse Board · hiring focus' },
  { commandId: 'pulse.movers',         label: "Today's biggest movers",    sub: 'Pulse Board · movers focus' },
  { commandId: 'pulse.filings',        label: "Today's 8-K filings",       sub: 'Pulse Board · filings focus' },
  { commandId: 'pulse.insider',        label: 'Insider flow this week',    sub: 'Pulse Board · insider focus' },
  { commandId: 'pulse.funding',        label: 'Funding rounds · 90d',      sub: 'Pulse Board · funding focus' },
  { commandId: 'supply.power-tight',   label: 'Power-tight regions',       sub: 'Supply Chain · red-tone entries' },
  { commandId: 'graph.frontier-leader',label: 'Frontier model leaderboard',sub: 'Open #1 lab by weight' },
  { commandId: 'graph.held-only',      label: 'Show held positions',       sub: 'Graph filter · position_held=true' },
  { commandId: 'graph.hiring-dc',      label: 'Cos hiring for Data Center',sub: 'Filter · top dept = Data Center' },
  { commandId: 'graph.ai-earnings',    label: 'AI-mentioning earnings calls', sub: 'Filter · transcripts ai_mentions>30' },
]

// ---------- ranking ----------

const TIER_EXACT_TICKER = 0
const TIER_WORD_PREFIX  = 1
const TIER_LABEL_SUB    = 2
const TIER_SUB_SUB      = 3
const TIER_NONE         = 99

/**
 * Cheap fuzzy-ish scorer.
 * Returns a tuple (tier, position) — caller sorts by tier, then position.
 */
function score(hit: Hit, needle: string): { tier: number; pos: number } {
  const label = hit._labelLower ?? hit.label.toLowerCase()
  const sub = hit._subLower ?? (hit.sub ?? '').toLowerCase()
  const ticker = hit._tickerLower ?? (hit.ticker ?? '').toLowerCase()

  if (ticker && ticker === needle) return { tier: TIER_EXACT_TICKER, pos: 0 }

  // word-boundary prefix: first letter of any whitespace-separated word matches
  const labelWords = hit._labelWords ?? label.split(/[\s_/-]+/).filter(Boolean)
  for (const w of labelWords) {
    if (w.startsWith(needle)) return { tier: TIER_WORD_PREFIX, pos: w.length }
  }
  if (ticker && ticker.startsWith(needle)) return { tier: TIER_WORD_PREFIX, pos: ticker.length }

  const labelIdx = label.indexOf(needle)
  if (labelIdx !== -1) return { tier: TIER_LABEL_SUB, pos: labelIdx }
  const subIdx = sub.indexOf(needle)
  if (subIdx !== -1) return { tier: TIER_SUB_SUB, pos: subIdx }
  return { tier: TIER_NONE, pos: 0 }
}

function hitKey(h: Hit): string { return `${h.kind}:${h.id}` }

// ---------- corpus build ----------

function buildCorpus(data: GraphData): Hit[] {
  const out: Hit[] = []

  // Companies
  for (const co of data.companies) {
    out.push({
      kind: 'company',
      category: 'entities',
      id: co.id,
      label: co.name,
      sub: co.ticker ?? co.layer_id ?? null,
      ticker: co.ticker,
    })
  }
  // Investors
  for (const inv of data.investors) {
    out.push({
      kind: 'investor',
      category: 'entities',
      id: inv.id,
      label: inv.name,
      sub: 'investor',
    })
  }
  // Bottlenecks
  for (const b of data.bottlenecks) {
    out.push({
      kind: 'bottleneck',
      category: 'entities',
      id: b.id,
      label: b.name,
      sub: b.severity ?? 'bottleneck',
    })
  }
  // Agencies (Phase 7A) — regulators / export-control / standards bodies.
  for (const a of (data.agencies ?? [])) {
    out.push({
      kind: 'agency',
      category: 'entities',
      id: a.id,
      label: a.name,
      sub: [a.jurisdiction, a.agency_type].filter(Boolean).join(' · ') || 'agency',
    })
  }

  // Recent signals — last 14 days, top 50 by date
  const cutoffMs = Date.now() - 14 * 86_400_000
  const coById = new Map(data.companies.map(c => [c.id, c]))
  const firstCoForSignal = new Map<string, string>()
  for (const link of data.signalCompanies) {
    if (!firstCoForSignal.has(link.signal_id)) {
      firstCoForSignal.set(link.signal_id, link.company_id)
    }
  }
  const recent = data.signals
    .filter(s => {
      const t = new Date(s.date).getTime()
      return Number.isFinite(t) && t >= cutoffMs
    })
    .slice(0, 50)
  for (const s of recent) {
    const linkedCoId = firstCoForSignal.get(s.id) ?? null
    const co = linkedCoId ? coById.get(linkedCoId) : null
    const sourceShort = (s.source ?? '').replace('sec-edgar', '8-K').replace('google-news', 'news')
    const sub = `${sourceShort || 'signal'} · ${shortDate(s.date)}${co ? ` · ${co.ticker ?? co.name}` : ''}`
    out.push({
      kind: 'signal',
      category: 'signals',
      id: s.id,
      label: s.headline,
      sub,
      ticker: co?.ticker ?? null,
      linkedCompanyId: linkedCoId,
    })
  }

  // Sectors / layers
  for (const layer of data.layers) {
    out.push({
      kind: 'sector',
      category: 'sectors',
      id: layer.id,
      label: layer.name,
      sub: 'layer · filter graph',
      layerId: layer.id,
    })
  }

  // Hardcoded commands
  for (const cmd of COMMANDS) {
    out.push({
      kind: 'command',
      category: 'commands',
      id: cmd.commandId,
      label: cmd.label,
      sub: cmd.sub,
      commandId: cmd.commandId,
    })
  }

  // Precompute lowercase fields and word tokens for fast fuzzy-matching search
  for (const h of out) {
    h._labelLower = h.label.toLowerCase()
    h._subLower = (h.sub ?? '').toLowerCase()
    h._tickerLower = (h.ticker ?? '').toLowerCase()
    h._labelWords = h._labelLower.split(/[\s_/-]+/).filter(Boolean)
  }

  return out
}

// ---------- component ----------

const CATEGORY_ORDER: HitCategory[] = ['entities', 'signals', 'sectors', 'commands']
const CATEGORY_LABEL: Record<HitCategory, string> = {
  entities: 'Entities',
  signals:  'Signals',
  sectors:  'Sectors',
  commands: 'Commands',
}

export default function CommandPalette({ data, onClose, onSelect }: Props) {
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const [activeCategory, setActiveCategory] = useState<HitCategory | 'all'>('all')
  const [recent, setRecent] = useState<RecentEntry[]>(() => readRecent())
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const corpus = useMemo(() => buildCorpus(data), [data])

  // For "recently visited" lookup on the empty-query view.
  const corpusByKey = useMemo(() => {
    const m = new Map<string, Hit>()
    for (const h of corpus) m.set(hitKey(h), h)
    return m
  }, [corpus])

  // Results, ranked + grouped.
  const results = useMemo<Hit[]>(() => {
    const needle = q.trim().toLowerCase()
    const recentKeys = new Set(recent.map(r => r.hitKey))

    if (!needle) {
      // Empty query: show recently-visited at top (if any), then a sampler from
      // each non-entity category, then a slice of entities. Keeps the palette
      // useful even before typing.
      const out: Hit[] = []
      // recently-visited slice
      for (const r of recent) {
        const h = corpusByKey.get(r.hitKey)
        if (h) out.push(h)
      }
      // category samplers
      const byCat: Record<HitCategory, Hit[]> = { entities: [], signals: [], sectors: [], commands: [] }
      for (const h of corpus) {
        if (!recentKeys.has(hitKey(h))) byCat[h.category].push(h)
      }
      // active-category filter (Tab)
      if (activeCategory !== 'all') {
        return [...out.filter(h => h.category === activeCategory), ...byCat[activeCategory]].slice(0, 30)
      }
      out.push(...byCat.commands.slice(0, 6))
      out.push(...byCat.sectors.slice(0, 6))
      out.push(...byCat.signals.slice(0, 6))
      out.push(...byCat.entities.slice(0, 12))
      return out.slice(0, 30)
    }

    // Scored results
    const scored: Array<{ h: Hit; tier: number; pos: number; recentBump: number }> = []
    for (const h of corpus) {
      if (activeCategory !== 'all' && h.category !== activeCategory) continue
      const s = score(h, needle)
      if (s.tier === TIER_NONE) continue
      scored.push({
        h,
        tier: s.tier,
        pos: s.pos,
        recentBump: recentKeys.has(hitKey(h)) ? 0 : 1, // 0 sorts first → bump
      })
    }
    scored.sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier
      if (a.recentBump !== b.recentBump) return a.recentBump - b.recentBump
      if (a.pos !== b.pos) return a.pos - b.pos
      return a.h.label.length - b.h.label.length
    })
    return scored.slice(0, 30).map(s => s.h)
  }, [corpus, corpusByKey, q, activeCategory, recent])

  // Reset cursor on input/category change.
  useEffect(() => { setIdx(0) }, [q, activeCategory])
  useEffect(() => { inputRef.current?.focus() }, [])

  // Scroll active row into view as user arrows through.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-row="${idx}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [idx])

  function commit(hit: Hit) {
    pushRecent(hitKey(hit))
    setRecent(readRecent())
    // Dispatch per kind.
    if (hit.kind === 'company' || hit.kind === 'investor' || hit.kind === 'bottleneck') {
      onSelect({ kind: hit.kind, id: hit.id } as SelectedRef)
      return
    }
    if (hit.kind === 'signal') {
      if (hit.linkedCompanyId) {
        onSelect({ kind: 'company', id: hit.linkedCompanyId })
      } else {
        // signal has no linked co — close palette as a no-op (rather than do nothing)
        onClose()
      }
      return
    }
    if (hit.kind === 'sector' && hit.layerId) {
      window.dispatchEvent(new CustomEvent('cc:sector-filter', { detail: { layerId: hit.layerId } }))
      window.location.hash = `sector=${encodeURIComponent(hit.layerId)}`
      onClose()
      return
    }
    if (hit.kind === 'command' && hit.commandId) {
      window.dispatchEvent(new CustomEvent('cc:command', { detail: { commandId: hit.commandId } }))
      onClose()
      return
    }
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIdx(i => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const hit = results[idx]
      if (hit) commit(hit)
    } else if (e.key === 'Tab') {
      e.preventDefault()
      const order: Array<HitCategory | 'all'> = ['all', ...CATEGORY_ORDER]
      const ci = order.indexOf(activeCategory)
      const next = order[(ci + (e.shiftKey ? order.length - 1 : 1)) % order.length]
      setActiveCategory(next)
    }
  }

  // Group results by category for the rendered list (preserves rank within each
  // group; cursor index is still flat across the whole list).
  const grouped = useMemo(() => {
    const groups: Array<{ category: HitCategory; rows: Array<{ hit: Hit; flatIdx: number }> }> = []
    const seen = new Map<HitCategory, Array<{ hit: Hit; flatIdx: number }>>()
    results.forEach((h, i) => {
      if (!seen.has(h.category)) seen.set(h.category, [])
      seen.get(h.category)!.push({ hit: h, flatIdx: i })
    })
    for (const cat of CATEGORY_ORDER) {
      const rows = seen.get(cat)
      if (rows && rows.length > 0) groups.push({ category: cat, rows })
    }
    return groups
  }, [results])

  const recentVisible = !q.trim() && recent.length > 0

  return (
    <div
      // Mobile: full-screen modal that respects safe-area-inset-bottom so the
      // input/footer don't collide with the home indicator. Desktop: centered
      // 560px card 8rem from the top.
      className="fixed inset-0 z-40 flex items-stretch justify-center bg-black/40 backdrop-blur-sm md:items-start md:pt-32"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      onClick={onClose}
    >
      <div
        className="flex w-full flex-col overflow-hidden border-border-default bg-bg-overlay shadow-panel backdrop-blur md:h-auto md:w-[560px] md:rounded-card md:border"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <input
          ref={inputRef}
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          placeholder="Search anything — co, investor, signal, sector, command…"
          className="w-full border-b border-border-subtle bg-transparent px-4 py-3 text-body text-fg-primary placeholder:text-fg-muted focus:outline-none"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />

        {/* Category tabs (Tab cycles, click to set) */}
        <div className="flex items-center gap-1 border-b border-border-subtle bg-bg-surface/40 px-3 py-1.5">
          {(['all', ...CATEGORY_ORDER] as Array<HitCategory | 'all'>).map((cat) => {
            const active = activeCategory === cat
            const label = cat === 'all' ? 'All' : CATEGORY_LABEL[cat]
            return (
              <button
                type="button"
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={
                  'rounded px-2 py-0.5 text-label transition-colors ' +
                  (active
                    ? 'bg-bg-hover text-accent-primary'
                    : 'text-fg-muted hover:text-fg-primary')
                }
              >
                {label}
              </button>
            )
          })}
          <span className="ml-auto text-meta text-fg-dim">Tab to cycle</span>
        </div>

        {/* Result list — fills available vertical space on mobile, caps at
            420px on desktop so the centered card doesn't grow past comfort. */}
        <div ref={listRef} className="flex-1 overflow-y-auto py-1 md:max-h-[420px] md:flex-none">
          {results.length === 0 && (
            <div className="px-4 py-8 text-center text-body text-fg-muted">no matches</div>
          )}
          {recentVisible && (
            <CategoryHeader label="Recently visited" />
          )}
          {grouped.map((g, gi) => (
            <div key={g.category}>
              {(!recentVisible || gi > 0 || g.rows[0].flatIdx >= recent.length) && (
                <CategoryHeader label={CATEGORY_LABEL[g.category]} />
              )}
              {g.rows.map(({ hit, flatIdx }) => {
                const active = flatIdx === idx
                return (
                  <button
                    type="button"
                    key={`${hit.kind}-${hit.id}-${flatIdx}`}
                    data-row={flatIdx}
                    onMouseEnter={() => setIdx(flatIdx)}
                    onClick={() => commit(hit)}
                    className={
                      // min-h-11 on mobile keeps rows ≥44px (WCAG 2.5.5);
                      // desktop stays dense.
                      'flex min-h-11 w-full items-center justify-between gap-3 border-l-2 px-3 py-2 text-left transition-colors md:min-h-0 md:py-1.5 ' +
                      (active
                        ? 'border-accent-primary bg-bg-hover'
                        : 'border-transparent hover:bg-bg-hover/60')
                    }
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-body text-fg-primary">{hit.label}</div>
                      {hit.sub && (
                        <div className="truncate text-meta text-fg-muted">{hit.sub}</div>
                      )}
                    </div>
                    <span className="shrink-0 text-meta uppercase tracking-widest text-fg-dim">{hit.kind}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border-subtle bg-bg-surface/40 px-4 py-1.5 text-meta uppercase tracking-widest text-fg-dim">
          <span>↑↓ navigate · ↵ open · Tab category · esc close</span>
          <span>{results.length} of {corpus.length}</span>
        </div>
      </div>
    </div>
  )
}

function CategoryHeader({ label }: { label: string }) {
  return (
    <div className="mt-1 border-t border-border-subtle px-3 pb-0.5 pt-1.5 text-label text-fg-muted first:mt-0 first:border-t-0">
      {label}
    </div>
  )
}

// ---------- helpers ----------

function shortDate(iso: string): string {
  // 'YYYY-MM-DD…' → 'M/D'
  const [y, m, d] = iso.slice(0, 10).split('-')
  if (!y || !m || !d) return iso.slice(0, 10)
  return `${Number(m)}/${Number(d)}`
}

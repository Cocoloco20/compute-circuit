'use client'

/**
 * 2D world-map view of the AI-compute ecosystem — companion to the 3D graph
 * in compute-graph.tsx (Phase 7C-lite).
 *
 * The 3D ecosystem graph shows *how the layers connect*; this view shows
 * *where the cos physically are*. Both consume the same GraphData payload
 * and share the entity drawer for click-to-detail.
 *
 * Render:
 *   - 1200×600 SVG equirectangular projection (scaled responsively).
 *   - Faint continent outlines (one hand-traced path; see world-outline.ts).
 *   - One dot per company with hq_lat/hq_lng — colored by layer.
 *   - Cluster nearby cos within 6px so dense hubs (Bay Area, Tokyo) render
 *     as a single labeled badge.
 *   - Top-50 flows from data.flows as quadratic bezier arcs source→target.
 *     Stroke-dasharray pulse animates flow direction.
 *   - Hover any dot → tooltip with co name + ticker + city.
 *   - Click → open entity drawer (same SelectedRef contract as the 3D view).
 */

import { useMemo, useState } from 'react'
import type { GraphData } from '@/lib/graph-data'
import type { Company, Flow, FlowType } from '@/types/db'
import type { SelectedRef } from './compute-graph'
import { latLngToSvg, arcPathBetween, clusterByProximity, type XY } from '@/lib/geo'
import { WORLD_OUTLINE_PATH, ANCHOR_CITIES } from '@/lib/world-outline'
import { TOKENS } from '@/lib/design-tokens'

// ----- constants -----

const VIEW_W = 1200
const VIEW_H = 600
const DOT_R = 4
const CLUSTER_PX = 6     // cos within 6px collapse into one badge
const MAX_FLOW_ARCS = 50 // cap so the page stays performant

// Flow type → stroke color. Matches FLOW_COLORS in compute-graph.tsx
// so the two views feel consistent.
const FLOW_COLOR: Record<FlowType, string> = {
  money:     '#10b981',
  compute:   '#22d3ee',
  energy:    '#fbbf24',
  equipment: '#cbd5e1',
  intel:     '#a855f7',
  venture:   '#ec4899',
}

// Per-layer dot color. Re-uses Phase 6 feed-* tokens where they semantically
// align (e.g. cloud is a feed-priced kind of thing), plus the chip color
// palette from the chrome legend. Stable across renders.
const LAYER_COLOR: Record<string, string> = {
  energy:         TOKENS.feed.grid,      // #FACC15 yellow
  equipment:      '#cbd5e1',             // slate-300 (matches FLOW_COLOR.equipment)
  materials:      '#94a3b8',             // slate-400
  foundry:        TOKENS.signal.warn,    // amber
  memory:         TOKENS.feed.hf,        // amber yellow
  chips:          TOKENS.signal.info,    // cyan
  infrastructure: TOKENS.feed.patents,   // purple
  cloud:          TOKENS.accent.primary, // violet
  labs:           TOKENS.accent.secondary, // pink
}

// ----- props -----

interface Props {
  data: GraphData
  onSelect: (ref: SelectedRef) => void
}

// ----- main component -----

export default function WorldMap({ data, onSelect }: Props) {
  // Only render cos that have HQ coords. Drop anything without — they have
  // nowhere to sit on the map.
  const placed = useMemo(
    () => data.companies.filter(c => c.hq_lat != null && c.hq_lng != null),
    [data.companies],
  )

  // Project lat/lng → SVG x/y once.
  const projected = useMemo(
    () =>
      placed.map(c => ({
        company: c,
        xy: latLngToSvg(Number(c.hq_lat), Number(c.hq_lng), VIEW_W, VIEW_H),
      })),
    [placed],
  )

  // Build the lookup table the flow arcs consume: co id → projected XY.
  const xyById = useMemo(() => {
    const m = new Map<string, XY>()
    for (const p of projected) m.set(p.company.id, p.xy)
    return m
  }, [projected])

  // Cluster co-located cos into single badges. Each cluster knows the list
  // of cos in it; we render its centroid as one dot and the cluster size
  // as a numeric badge.
  const clusters = useMemo(
    () =>
      clusterByProximity(
        projected.map(p => ({ xy: p.xy, item: p.company })),
        CLUSTER_PX,
      ),
    [projected],
  )

  // Flow arcs — only between placed cos. Cap at MAX_FLOW_ARCS to keep the
  // page legible (200+ arcs would just be noise).
  const flowArcs = useMemo(() => {
    const arcs: Array<{ flow: Flow; from: XY; to: XY; d: string }> = []
    for (const f of data.flows) {
      const from = xyById.get(f.from_id)
      const to = xyById.get(f.to_id)
      // Only company→company flows. Investor flows have no HQ location.
      if (!from || !to) continue
      // Skip self-loops (e.g. nvda→nvda) — render as a degenerate point.
      if (Math.hypot(from.x - to.x, from.y - to.y) < 1) continue
      arcs.push({ flow: f, from, to, d: arcPathBetween(from, to, VIEW_H) })
      if (arcs.length >= MAX_FLOW_ARCS) break
    }
    return arcs
  }, [data.flows, xyById])

  const [hover, setHover] = useState<{ company: Company; x: number; y: number } | null>(null)

  return (
    <div className="relative h-full w-full overflow-hidden bg-bg-canvas">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full select-none"
        role="img"
        aria-label="World map of AI-compute companies"
      >
        {/* ----- Gradient defs for flow arcs -----
            Each flow gets a left→right linear gradient (transparent → color
            → transparent) and a dasharray animation that scrolls along the
            stroke, producing the impression of motion from source → target. */}
        <defs>
          {(Object.keys(FLOW_COLOR) as FlowType[]).map(kind => (
            <linearGradient
              key={`flow-${kind}`}
              id={`flow-${kind}`}
              x1="0%" y1="0%" x2="100%" y2="0%"
            >
              <stop offset="0%" stopColor={FLOW_COLOR[kind]} stopOpacity="0" />
              <stop offset="50%" stopColor={FLOW_COLOR[kind]} stopOpacity="0.55" />
              <stop offset="100%" stopColor={FLOW_COLOR[kind]} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>

        {/* ----- Continent silhouettes ----- */}
        <path
          d={WORLD_OUTLINE_PATH}
          fill="rgba(38, 42, 51, 0.35)"
          stroke={TOKENS.border.default}
          strokeWidth={0.6}
          strokeLinejoin="round"
        />

        {/* Equator + prime meridian as faint guide lines (helps users orient
            without drowning out the data). */}
        <line x1={0} y1={VIEW_H / 2} x2={VIEW_W} y2={VIEW_H / 2}
          stroke={TOKENS.border.subtle} strokeWidth={0.3} strokeDasharray="2 4" />
        <line x1={VIEW_W / 2} y1={0} x2={VIEW_W / 2} y2={VIEW_H}
          stroke={TOKENS.border.subtle} strokeWidth={0.3} strokeDasharray="2 4" />

        {/* ----- Anchor city labels (only the canonical hubs) ----- */}
        {ANCHOR_CITIES.map(c => {
          const { x, y } = latLngToSvg(c.lat, c.lng, VIEW_W, VIEW_H)
          return (
            <text
              key={c.name}
              x={x + 6}
              y={y - 6}
              fontSize={7}
              fill={TOKENS.fg.dim}
              fontFamily="ui-monospace, monospace"
              pointerEvents="none"
            >
              {c.name}
            </text>
          )
        })}

        {/* ----- Flow arcs ----- */}
        {flowArcs.map((arc, i) => (
          <g key={`arc-${arc.flow.id}-${i}`}>
            {/* Static thin underline that establishes the path. */}
            <path
              d={arc.d}
              fill="none"
              stroke={FLOW_COLOR[arc.flow.type]}
              strokeOpacity={0.15}
              strokeWidth={0.6}
            />
            {/* Animated dash that scrolls along the path. The dasharray is
                "12 28" (12px dash, 28px gap = 40px period) and we shift
                stroke-dashoffset by -40 over 3s → continuous motion. */}
            <path
              d={arc.d}
              fill="none"
              stroke={FLOW_COLOR[arc.flow.type]}
              strokeOpacity={0.85}
              strokeWidth={1.2}
              strokeLinecap="round"
              strokeDasharray="12 28"
              style={{
                animation: `wm-flow 3s linear infinite`,
                animationDelay: `${(i * 0.13) % 3}s`,
              }}
            />
          </g>
        ))}

        {/* ----- City dots (clustered) ----- */}
        {clusters.map((cl, i) => {
          // Cluster's primary company drives color/click target. Choose the
          // highest-weight co so the dot anchors to the most prominent name.
          const primary = [...cl.items].sort((a, b) => b.weight - a.weight)[0]
          const layerColor = primary.layer_id ? LAYER_COLOR[primary.layer_id] : TOKENS.fg.muted
          const hovered = hover?.company.id === primary.id
          const radius = DOT_R + (cl.items.length > 1 ? Math.min(cl.items.length * 0.6, 3) : 0)
          return (
            <g key={`cluster-${i}`}>
              {/* Soft glow halo — makes dots readable on dark canvas. */}
              <circle
                cx={cl.cx}
                cy={cl.cy}
                r={radius + 2.5}
                fill={layerColor}
                fillOpacity={hovered ? 0.35 : 0.18}
              />
              <circle
                cx={cl.cx}
                cy={cl.cy}
                r={radius}
                fill={layerColor}
                stroke={hovered ? TOKENS.fg.primary : 'rgba(255,255,255,0.25)'}
                strokeWidth={hovered ? 1.2 : 0.5}
                style={{ cursor: 'pointer' }}
                onMouseEnter={(e) => {
                  const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement | null)?.getBoundingClientRect()
                  setHover({
                    company: primary,
                    x: rect ? (cl.cx / VIEW_W) * rect.width : cl.cx,
                    y: rect ? (cl.cy / VIEW_H) * rect.height : cl.cy,
                  })
                }}
                onMouseLeave={() => setHover(null)}
                onClick={() => onSelect({ kind: 'company', id: primary.id })}
              >
                <title>{cl.items.map(c => c.ticker ?? c.name).join(', ')}</title>
              </circle>
              {/* Cluster size badge — only show when ≥2 cos collapsed. */}
              {cl.items.length > 1 && (
                <g pointerEvents="none">
                  <rect
                    x={cl.cx + radius + 1}
                    y={cl.cy - 7}
                    width={cl.items.length > 9 ? 14 : 10}
                    height={10}
                    rx={5}
                    fill="#0A0B0F"
                    stroke={layerColor}
                    strokeOpacity={0.5}
                    strokeWidth={0.4}
                  />
                  <text
                    x={cl.cx + radius + 1 + (cl.items.length > 9 ? 7 : 5)}
                    y={cl.cy + 0.5}
                    fontSize={7}
                    textAnchor="middle"
                    fill={TOKENS.fg.primary}
                    fontFamily="ui-monospace, monospace"
                    fontWeight={600}
                  >
                    {cl.items.length}
                  </text>
                </g>
              )}
            </g>
          )
        })}
      </svg>

      {/* ----- Hover tooltip overlay ----- */}
      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border border-border-default bg-bg-overlay px-2.5 py-1.5 text-xs text-fg-primary shadow-card backdrop-blur"
          style={{ left: hover.x + 12, top: hover.y + 12 }}
        >
          <div className="font-mono font-semibold">{hover.company.name}</div>
          <div className="mt-0.5 flex items-center gap-2 text-fg-muted">
            {hover.company.ticker && <span className="font-mono text-[10px]">{hover.company.ticker}</span>}
            {hover.company.hq_city && <span className="text-[10px]">{hover.company.hq_city}</span>}
          </div>
          {hover.company.layer_id && (
            <div className="mt-0.5 text-[10px] uppercase tracking-wider text-fg-dim">
              {data.layers.find(l => l.id === hover.company.layer_id)?.name ?? hover.company.layer_id}
            </div>
          )}
        </div>
      )}

      {/* ----- Layer legend (bottom-right) ----- */}
      <div className="pointer-events-none absolute bottom-4 right-4 hidden space-y-1 text-[11px] font-mono text-fg-secondary md:block">
        <div className="mb-1 text-label text-fg-dim">Layers</div>
        {[...data.layers]
          .filter(l => LAYER_COLOR[l.id])
          .reverse()
          .map(l => (
            <div key={l.id} className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: LAYER_COLOR[l.id] }} />
              <span>{l.name}</span>
            </div>
          ))}
      </div>

      {/* ----- Stat line (top-left of canvas) ----- */}
      <div className="pointer-events-none absolute bottom-4 left-4 hidden text-[11px] font-mono text-fg-muted md:block">
        <div className="text-label text-fg-dim">World view</div>
        <div>
          {projected.length} cos · {clusters.length} cities · {flowArcs.length} flows
        </div>
      </div>

      {/* CSS keyframes for the flow-arc dash scroll. Inline so the component
          ships self-contained — no globals.css coupling. */}
      <style jsx>{`
        @keyframes wm-flow {
          to { stroke-dashoffset: -40; }
        }
      `}</style>
    </div>
  )
}

'use client'

/**
 * GlossaryView — full-screen "what is this world made of" reference.
 *
 * Toggled from the top bar (📖 Glossary button). Renders three sections:
 *   A. Layers (16)        — the stacked categorization buckets of the world
 *   B. Agencies (22+)     — regulators / export-control / safety bodies
 *   C. Flow types (6)     — money / compute / energy / equipment / intel / venture
 *
 * Each card is intentionally text-heavy: a newcomer should be able to scroll
 * the page top-to-bottom and walk away knowing what every label in the graph
 * means + why it matters.
 *
 * Click handlers route back to the parent's entity-drawer for cos / agencies
 * so the Glossary doubles as a navigation surface. Layer cards are dead-ends
 * for now (no "open layer" drawer exists), but the example_company chips ARE
 * clickable.
 */

import type { GraphData } from '@/lib/graph-data'
import type { SelectedRef } from './compute-graph'
import type { FlowType } from '@/types/db'

interface Props {
  data: GraphData
  onSelect?: (s: SelectedRef) => void
}

// ---------- Flow type catalogue (hardcoded — these are enum values) ----------

interface FlowTypeMeta {
  key: FlowType
  label: string
  colorClass: string  // tailwind bg-* for the swatch
  hex: string         // raw hex (used as a fallback if Tailwind purges the class)
  definition: string
  example: string
}

// Colors mirror FLOW_COLORS in compute-graph.tsx so the legend stays in sync.
const FLOW_TYPES: FlowTypeMeta[] = [
  {
    key: 'money',
    label: 'Money',
    colorClass: 'bg-emerald-500',
    hex: '#10b981',
    definition: 'Capital flowing between investors and operating companies — VC rounds, public equity buys, debt issuance.',
    example: 'a16z → xAI (Series C lead)',
  },
  {
    key: 'compute',
    label: 'Compute',
    colorClass: 'bg-cyan-400',
    hex: '#22d3ee',
    definition: 'Physical compute capacity flowing as GPU shipments or cloud capacity reservations between vendors and consumers.',
    example: 'NVIDIA → CoreWeave (H100 / H200 shipments)',
  },
  {
    key: 'energy',
    label: 'Energy',
    colorClass: 'bg-amber-400',
    hex: '#fbbf24',
    definition: 'Power or fuel committed under PPAs, supply contracts, or grid interconnection agreements.',
    example: 'Constellation → Microsoft (TMI nuclear PPA, 2028 restart)',
  },
  {
    key: 'equipment',
    label: 'Equipment',
    colorClass: 'bg-slate-300',
    hex: '#cbd5e1',
    definition: 'Wafer-fab tools, datacenter cooling rigs, networking hardware moving between vendor and operator.',
    example: 'ASML → TSMC (EUV scanner shipments)',
  },
  {
    key: 'intel',
    label: 'Intel',
    colorClass: 'bg-purple-500',
    hex: '#a855f7',
    definition: 'Knowledge transfer — research collaborations, IP licensing, safety-eval access agreements, strategic intel.',
    example: 'UK AISI ↔ Anthropic (pre-deployment Claude 4 evals)',
  },
  {
    key: 'venture',
    label: 'Venture',
    colorClass: 'bg-pink-500',
    hex: '#ec4899',
    definition: 'Strategic + corporate venture stakes that are simultaneously money + relationship.',
    example: 'Microsoft → OpenAI (strategic investment + Azure exclusivity)',
  },
]

// ---------- Main ----------

export default function GlossaryView({ data, onSelect }: Props) {
  // Sort layers bottom-of-stack → top so the reading order matches the 3D scene
  // (y_position ascending = oil-gas first → government last). order_index works
  // for our seed since Phase 7A used fractional values to slot in without
  // renumbering, but y_position is the canonical visual order.
  const sortedLayers = [...data.layers].sort((a, b) => a.y_position - b.y_position)

  // Sort agencies: jurisdiction → name. Stable, readable for a printed glossary.
  const sortedAgencies = [...data.agencies].sort((a, b) => {
    const jA = a.jurisdiction ?? 'zz'
    const jB = b.jurisdiction ?? 'zz'
    if (jA !== jB) return jA.localeCompare(jB)
    return a.name.localeCompare(b.name)
  })

  // Co-by-id index for example_company chip click-through.
  const cosByName = new Map<string, string>()
  for (const co of data.companies) {
    cosByName.set(co.name.toLowerCase(), co.id)
    if (co.ticker) cosByName.set(co.ticker.toLowerCase(), co.id)
  }

  // Per-agency: number of cos regulated. For now we approximate as cos in the
  // same jurisdiction (until we model agency↔company relationships explicitly).
  function regulatedCount(jurisdiction: string | null): number {
    if (!jurisdiction) return 0
    return data.companies.filter(c => c.country === jurisdiction).length
  }

  return (
    <div className="absolute inset-0 z-0 overflow-y-auto bg-bg-canvas text-fg-primary">
      <div className="mx-auto max-w-6xl px-4 pb-32 pt-20 md:pt-24">
        {/* Page header */}
        <header className="mb-8 border-b border-border-subtle pb-6">
          <h1 className="text-headline text-fg-primary">Glossary</h1>
          <p className="mt-2 max-w-3xl text-body text-fg-secondary">
            A tour of the Compute Circuit ontology — every layer in the stack, every
            regulator that governs it, every flow type that connects two nodes. Skim
            top-to-bottom once and the rest of the app will read naturally.
          </p>
          <div className="mt-3 flex flex-wrap gap-3 font-mono text-meta uppercase tracking-wider text-fg-muted">
            <span>{sortedLayers.length} layers</span>
            <span aria-hidden="true">·</span>
            <span>{sortedAgencies.length} agencies</span>
            <span aria-hidden="true">·</span>
            <span>{FLOW_TYPES.length} flow types</span>
            <span aria-hidden="true">·</span>
            <span>{data.bottlenecks.length} bottlenecks</span>
          </div>
        </header>

        {/* ============ A. LAYERS ============ */}
        <section className="mb-12" aria-labelledby="glossary-layers">
          <SectionHeader id="glossary-layers" eyebrow="A" title="Layers" count={sortedLayers.length}>
            The 16 vertical buckets that organize every company in the graph,
            ordered from the deepest raw-material feedstocks (Oil &amp; Gas) up
            through the model labs and on to the governments that regulate
            them. The 3D scene renders these as horizontal rings at different
            y-positions.
          </SectionHeader>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {sortedLayers.map((layer) => {
              const examples = layer.example_companies ?? []
              const bn = layer.bottleneck_keywords ?? []
              const coCount = data.companies.filter(c => c.layer_id === layer.id).length
              const agCount = data.agencies.filter(a => a.layer_id === layer.id).length
              return (
                <div
                  key={layer.id}
                  className="rounded-card border border-border-default bg-bg-surface p-4 shadow-card"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="text-title text-fg-primary">{layer.name}</h3>
                    <span className="font-mono text-meta text-fg-muted">
                      {coCount} cos{agCount > 0 ? ` · ${agCount} agencies` : ''}
                    </span>
                  </div>
                  <p className="mt-2 text-body text-fg-secondary">
                    {layer.description ?? <span className="text-fg-dim italic">No description yet.</span>}
                  </p>

                  {examples.length > 0 && (
                    <div className="mt-3">
                      <div className="mb-1 text-label text-fg-dim">Examples</div>
                      <div className="flex flex-wrap gap-1.5">
                        {examples.map((ex) => {
                          const coId = cosByName.get(ex.toLowerCase())
                          const cls =
                            'inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-meta ' +
                            (coId
                              ? 'cursor-pointer border-border-default bg-bg-hover text-fg-primary hover:border-accent-primary/60 hover:text-accent-primary'
                              : 'border-border-subtle bg-bg-canvas text-fg-secondary')
                          return coId ? (
                            <button
                              type="button"
                              key={ex}
                              onClick={() => onSelect?.({ kind: 'company', id: coId })}
                              className={cls}
                            >
                              {ex}
                            </button>
                          ) : (
                            <span key={ex} className={cls}>{ex}</span>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {bn.length > 0 && (
                    <div className="mt-3">
                      <div className="mb-1 text-label text-fg-dim">Bottlenecks</div>
                      <div className="flex flex-wrap gap-1.5">
                        {bn.map((b) => (
                          <span
                            key={b}
                            className="inline-flex items-center rounded-full border border-signal-warn/30 bg-signal-warn/10 px-2 py-0.5 font-mono text-meta text-signal-warn"
                          >
                            {b}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        {/* ============ B. AGENCIES ============ */}
        <section className="mb-12" aria-labelledby="glossary-agencies">
          <SectionHeader id="glossary-agencies" eyebrow="B" title="Agencies" count={sortedAgencies.length}>
            Regulators, export-control bodies, antitrust offices, and AI-safety
            institutes. They don&apos;t consume compute themselves, but their actions
            propagate through the stack within weeks — every BIS rule update,
            every CAC algorithm filing, every EU AI Act milestone reshapes
            something below them.
          </SectionHeader>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {sortedAgencies.map((ag) => {
              const flag = jurisdictionFlag(ag.jurisdiction)
              const regCount = regulatedCount(ag.jurisdiction)
              return (
                <div
                  key={ag.id}
                  className="rounded-card border border-border-default bg-bg-surface p-4 shadow-card"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-title text-fg-primary">
                        {flag && <span className="mr-1.5" aria-hidden="true">{flag}</span>}
                        {ag.name}
                      </h3>
                      <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-meta uppercase tracking-wider text-fg-muted">
                        {ag.jurisdiction && <span>{ag.jurisdiction}</span>}
                        {ag.agency_type && (
                          <span className="inline-flex items-center rounded-md border border-border-subtle bg-bg-canvas px-1.5 py-0.5 text-fg-secondary">
                            {ag.agency_type}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onSelect?.({ kind: 'agency', id: ag.id })}
                      className="shrink-0 rounded-md border border-border-default bg-bg-hover px-2 py-1 font-mono text-meta uppercase tracking-wider text-fg-secondary hover:border-accent-primary/60 hover:text-accent-primary"
                      aria-label={`Open ${ag.name} drawer`}
                    >
                      Open
                    </button>
                  </div>

                  <p className="mt-3 text-body text-fg-secondary">
                    {ag.description ?? <span className="text-fg-dim italic">No description yet.</span>}
                  </p>

                  {ag.recent_focus && (
                    <div className="mt-3 rounded-md border border-border-subtle bg-bg-canvas p-3">
                      <div className="mb-1 text-label text-fg-dim">Recent focus</div>
                      <p className="text-body text-fg-primary">{ag.recent_focus}</p>
                    </div>
                  )}

                  {regCount > 0 && ag.jurisdiction && (
                    <div className="mt-3 font-mono text-meta uppercase tracking-wider text-fg-muted">
                      regulates ~{regCount} {ag.jurisdiction}-domiciled co{regCount === 1 ? '' : 's'} in the graph
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        {/* ============ C. FLOW TYPES ============ */}
        <section className="mb-8" aria-labelledby="glossary-flows">
          <SectionHeader id="glossary-flows" eyebrow="C" title="Flow types" count={FLOW_TYPES.length}>
            The six kinds of edges drawn between nodes in the 3D graph. Each
            type has its own color so a glance at the scene tells you what
            kind of relationship is moving — money, capacity, power, hardware,
            knowledge, or strategic ownership.
          </SectionHeader>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {FLOW_TYPES.map((ft) => (
              <div
                key={ft.key}
                className="rounded-card border border-border-default bg-bg-surface p-4 shadow-card"
              >
                <div className="flex items-center gap-3">
                  <span
                    className="inline-block h-4 w-4 rounded-full shadow-card"
                    style={{ backgroundColor: ft.hex }}
                    aria-hidden="true"
                  />
                  <h3 className="text-title text-fg-primary">{ft.label}</h3>
                  <code className="ml-auto font-mono text-meta text-fg-muted">{ft.key}</code>
                </div>
                <p className="mt-2 text-body text-fg-secondary">{ft.definition}</p>
                <div className="mt-3 rounded-md border border-border-subtle bg-bg-canvas p-3">
                  <div className="mb-1 text-label text-fg-dim">Example flow</div>
                  <p className="font-mono text-body text-fg-primary">{ft.example}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ============ D. BOTTLENECKS ============ */}
        {data.bottlenecks.length > 0 && (
          <section className="mb-8" aria-labelledby="glossary-bottlenecks">
            <SectionHeader id="glossary-bottlenecks" eyebrow="D" title="Bottlenecks" count={data.bottlenecks.length}>
              The supply-chain pressure points that show up in the 3D graph as
              glowing octahedra between layer rings. Each one is a known
              binding constraint on how fast the stack above can scale.
            </SectionHeader>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {data.bottlenecks.map((b) => {
                const sevHex =
                  b.severity === 'critical' ? '#ef4444' :
                  b.severity === 'high' ? '#f97316' :
                  b.severity === 'medium' ? '#fbbf24' : '#94a3b8'
                return (
                  <button
                    type="button"
                    key={b.id}
                    onClick={() => onSelect?.({ kind: 'bottleneck', id: b.id })}
                    className="rounded-card border border-border-default bg-bg-surface p-4 text-left shadow-card transition-colors hover:border-border-strong"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-title text-fg-primary">{b.name}</h3>
                      {b.severity && (
                        <span
                          className="shrink-0 rounded-full border px-2 py-0.5 font-mono text-meta uppercase tracking-wider"
                          style={{ borderColor: sevHex + '66', color: sevHex, backgroundColor: sevHex + '14' }}
                        >
                          {b.severity}
                        </span>
                      )}
                    </div>
                    {b.evidence && (
                      <p className="mt-2 text-body text-fg-secondary">{b.evidence}</p>
                    )}
                    {b.timeline && (
                      <div className="mt-3 rounded-md border border-border-subtle bg-bg-canvas p-3">
                        <div className="mb-1 text-label text-fg-dim">Timeline</div>
                        <p className="text-body text-fg-primary">{b.timeline}</p>
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

// ---------- helpers ----------

function SectionHeader({
  id,
  eyebrow,
  title,
  count,
  children,
}: {
  id: string
  eyebrow: string
  title: string
  count: number
  children: React.ReactNode
}) {
  return (
    <header className="mb-4">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-label uppercase tracking-wider text-accent-primary">
          Section {eyebrow}
        </span>
        <h2 id={id} className="text-stat text-fg-primary">{title}</h2>
        <span className="font-mono text-meta text-fg-muted">{count}</span>
      </div>
      <p className="mt-1 max-w-3xl text-body text-fg-secondary">{children}</p>
    </header>
  )
}

// ISO 3166-1 alpha-2 → regional-indicator emoji (e.g. "US" → 🇺🇸). Returns
// null for the EU + invalid codes (EU isn't a real ISO country — uses 🇪🇺
// regional-indicator pair for "EU" which renders the EU flag on most fonts).
function jurisdictionFlag(j: string | null | undefined): string | null {
  if (!j) return null
  const u = j.toUpperCase()
  if (u.length !== 2 || !/^[A-Z]{2}$/.test(u)) return null
  return String.fromCodePoint(u.charCodeAt(0) - 65 + 0x1f1e6, u.charCodeAt(1) - 65 + 0x1f1e6)
}

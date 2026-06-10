/**
 * Zero-cost thesis generator — no LLM, no API keys.
 *
 * Composes companies.thesis_ai (2 sentences) + thesis_risk_ai (1 sentence)
 * deterministically from data already in the DB: layer role, country, market
 * cap, TTM capex (computeCapexTTM), earnings-call AI/GPU/data-center mention
 * counts, and recent Form D raises. Same philosophy as the lexicon-based
 * transcript scorer: deterministic > generative when the budget is $0 —
 * every claim traces to a DB row, nothing can be hallucinated.
 *
 * Sentence shape varies by a stable hash of the company id so 2,461 cards
 * don't all read identically, but re-runs always produce the same text for
 * the same data.
 *
 * IDEMPOTENT + NON-DESTRUCTIVE: only fills rows where thesis_ai IS NULL.
 * Hand-written `thesis` and any future LLM-generated thesis_ai are never
 * touched. To regenerate one co: NULL its thesis_ai, re-run.
 *
 * Run: npx tsx scripts/generate-theses-free.ts [--limit 20] [--only nvda]
 */
import { createClient } from '@supabase/supabase-js'
import * as path from 'path'
import { config } from 'dotenv'
import { computeCapexTTM } from '../src/lib/capex'
import type { Fundamental } from '../src/types/db'

config({ path: path.join(__dirname, '..', '.env.local') })
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('Missing env'); process.exit(1) }
const sb = createClient(url, key)

const args = process.argv.slice(2)
const arg = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null }
const LIMIT = arg('--limit') ? Number(arg('--limit')) : null
const ONLY = arg('--only')

interface CoRow {
  id: string; name: string; ticker: string | null; country: string | null
  private: boolean | null; layer_id: string | null; market_cap_usd: number | null
  thesis_ai: string | null
}

const fmtB = (n: number) => n >= 1e12 ? `$${(n / 1e12).toFixed(1)}T` : n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : `$${(n / 1e6).toFixed(0)}M`

// Stable tiny hash → picks among phrasing variants per co.
const hash = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h) }

const COUNTRY_NAMES: Record<string, string> = {
  US: 'US', CN: 'Chinese', TW: 'Taiwanese', JP: 'Japanese', KR: 'South Korean',
  DE: 'German', FR: 'French', GB: 'British', NL: 'Dutch', IN: 'Indian',
  CA: 'Canadian', CH: 'Swiss', SE: 'Swedish', SG: 'Singaporean', SA: 'Saudi',
  AE: 'Emirati', IL: 'Israeli', AU: 'Australian', BR: 'Brazilian', MX: 'Mexican',
  IT: 'Italian', ES: 'Spanish', DK: 'Danish', NO: 'Norwegian', FI: 'Finnish',
  IE: 'Irish', BE: 'Belgian', AT: 'Austrian', HK: 'Hong Kong-based', TH: 'Thai',
  ID: 'Indonesian', MY: 'Malaysian', VN: 'Vietnamese', PH: 'Philippine',
}

// One risk line per layer family; generic fallback composed from layer name.
const LAYER_RISK: Record<string, string> = {
  labs: 'Frontier-model economics remain unproven — training costs compound faster than revenue, and open-weight releases can erase pricing power overnight.',
  chips: 'Chip cycles cut both ways: today’s allocation scarcity becomes tomorrow’s inventory glut if AI capex digests faster than expected.',
  foundry: 'Fab economics are brutally capital-intensive and geopolitically exposed — a single export-control change can reroute the entire order book.',
  energy: 'Interconnection queues and permitting, not demand, are the binding constraint — multi-year grid timelines can strand data-center capex.',
  infrastructure: 'Hyperscaler concentration is the core risk: a handful of buyers set pricing, and any capex pause hits backlog-driven valuations hard.',
  materials: 'Commodity exposure means margins track spot markets more than AI demand — the AI story amplifies but does not decouple the cycle.',
  government: 'Policy direction can invert quickly with administrations — subsidy-dependent positioning carries binary regulatory risk.',
}

interface Aggregates {
  capexByCo: Map<string, { ttm: number | null; yoy: number | null }>
  mentionsByCo: Map<string, { ai: number; dc: number; filings: number }>
  raiseByCo: Map<string, number>
}

function composeThesis(
  co: CoRow,
  layer: { name: string; description: string | null } | undefined,
  agg: Aggregates,
): { thesis: string; risk: string } {
  const h = hash(co.id)
  const nat = co.country ? COUNTRY_NAMES[co.country] ?? co.country : null
  const layerName = layer?.name?.toLowerCase() ?? 'AI-economy'
  // First clause of the curated layer description = the layer's role in the
  // AI stack, written by a human. Reuse it instead of inventing phrasing.
  const layerRole = layer?.description?.split(/(?<=\.)\s/)[0] ?? null

  // Sentence 1 — positioning. Two clean variants; the layer description is
  // reserved for sentence 2 so it never appears twice.
  const sizeBit = co.market_cap_usd ? `${fmtB(co.market_cap_usd)} ` : ''
  const natBit = nat ? `${nat} ` : ''
  const s1Variants = [
    `${co.name} is a ${sizeBit}${natBit}company in the ${layerName} layer of the AI compute stack.`,
    `A ${sizeBit}${natBit}player in the ${layerName} layer, ${co.name} is tracked here for its position in the AI supply chain.`,
  ]
  const s1 = s1Variants[h % 2]

  // Sentence 2 — the most interesting fact we actually have, in priority order.
  const capex = agg.capexByCo.get(co.id)
  const mentions = agg.mentionsByCo.get(co.id)
  const raise = agg.raiseByCo.get(co.id)
  let s2: string
  if (capex?.ttm && capex.ttm > 1e9) {
    s2 = `Trailing-twelve-month capex runs ${fmtB(capex.ttm)}${capex.yoy != null ? ` (${capex.yoy >= 0 ? '+' : ''}${capex.yoy.toFixed(0)}% YoY)` : ''}, putting it among the heavier builders in its layer.`
  } else if (mentions && mentions.ai + mentions.dc >= 5) {
    s2 = `Management leaned into the theme on recent earnings calls — ${mentions.ai} AI and ${mentions.dc} data-center mentions across ${mentions.filings} release${mentions.filings === 1 ? '' : 's'} in the trailing two quarters.`
  } else if (raise && raise > 0) {
    s2 = `It last raised ${fmtB(raise)} via Form D, signaling active private-market backing.`
  } else if (layerRole) {
    // Layer descriptions are noun phrases ("HBM and DRAM makers whose...",
    // "Power generators, utilities, ..."), so introduce with "comprises" —
    // never lowercase the first word (acronyms like HBM would mangle).
    s2 = `The layer comprises ${layerRole.charAt(0).toLowerCase() === layerRole.charAt(0) ? layerRole : layerRole.charAt(0).toLowerCase() + layerRole.slice(1)}`
    // Acronym guard: if the first word is all-caps (HBM, GPU, EUV), keep it.
    const firstWord = layerRole.split(/\s/)[0]
    if (firstWord === firstWord.toUpperCase() && firstWord.length > 1) {
      s2 = `The layer comprises ${layerRole}`
    }
  } else {
    s2 = `Tracked here for its exposure to AI-driven demand across the compute supply chain.`
  }

  // Risk line — layer-specific where curated, generic otherwise.
  const risk = (co.layer_id && LAYER_RISK[co.layer_id])
    ?? `Like most of the ${layerName} layer, the AI narrative is additive rather than core — if AI capex slows, the stock trades on its legacy business, not the theme.`

  return { thesis: `${s1} ${s2}`.replace(/\s+/g, ' ').trim(), risk }
}

async function main() {
  // ---- load inputs (all paginated where tables exceed 1000 rows) ----
  const { data: layersData } = await sb.from('layers').select('id, name, description')
  const layers = new Map((layersData ?? []).map((l: { id: string; name: string; description: string | null }) => [l.id, l]))

  const PAGE = 1000
  const cos: CoRow[] = []
  for (let from = 0; ; from += PAGE) {
    let q = sb.from('companies')
      .select('id, name, ticker, country, private, layer_id, market_cap_usd, thesis_ai')
      .order('id').range(from, from + PAGE - 1)
    if (ONLY) q = q.eq('id', ONLY)
    const { data, error } = await q
    if (error) throw error
    cos.push(...((data ?? []) as CoRow[]))
    if (!data || data.length < PAGE) break
  }

  const fnd: Fundamental[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from('fundamentals')
      .select('company_id, period, period_type, metric, value')
      .eq('metric', 'capex').order('period', { ascending: false }).range(from, from + PAGE - 1)
    if (error) throw error
    fnd.push(...((data ?? []) as Fundamental[]))
    if (!data || data.length < PAGE) break
  }
  const capexByCo = new Map<string, { ttm: number | null; yoy: number | null }>()
  for (const coId of new Set(fnd.map(f => f.company_id))) {
    const r = computeCapexTTM(fnd, coId)
    capexByCo.set(coId, { ttm: r.ttm, yoy: r.yoy_pct })
  }

  const { data: ts } = await sb.from('transcript_signals')
    .select('company_id, ai_mentions, data_center_mentions, filed_date')
    .gte('filed_date', new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10))
  const mentionsByCo = new Map<string, { ai: number; dc: number; filings: number }>()
  for (const r of (ts ?? []) as Array<{ company_id: string; ai_mentions: number | null; data_center_mentions: number | null }>) {
    const m = mentionsByCo.get(r.company_id) ?? { ai: 0, dc: 0, filings: 0 }
    m.ai += r.ai_mentions ?? 0; m.dc += r.data_center_mentions ?? 0; m.filings += 1
    mentionsByCo.set(r.company_id, m)
  }

  const { data: frs } = await sb.from('funding_rounds')
    .select('company_id, total_amount_sold_usd, filed_date')
    .order('filed_date', { ascending: false }).limit(500)
  const raiseByCo = new Map<string, number>()
  for (const r of (frs ?? []) as Array<{ company_id: string; total_amount_sold_usd: number | null }>) {
    if (r.total_amount_sold_usd && !raiseByCo.has(r.company_id)) raiseByCo.set(r.company_id, r.total_amount_sold_usd)
  }

  const agg: Aggregates = { capexByCo, mentionsByCo, raiseByCo }

  // ---- compose + write (only rows missing thesis_ai) ----
  let todo = cos.filter(c => !c.thesis_ai)
  if (LIMIT) todo = todo.slice(0, LIMIT)
  console.log(`Composing theses for ${todo.length} cos (of ${cos.length} total)...`)

  const nowIso = new Date().toISOString()
  let ok = 0, fail = 0
  const CONCURRENCY = 10
  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    const batch = todo.slice(i, i + CONCURRENCY)
    await Promise.all(batch.map(async (co) => {
      const { thesis, risk } = composeThesis(co, co.layer_id ? layers.get(co.layer_id) : undefined, agg)
      const { error } = await (sb.from('companies') as unknown as {
        update: (p: Record<string, string>) => { eq: (c: string, v: string) => Promise<{ error: { message: string } | null }> }
      }).update({ thesis_ai: thesis, thesis_risk_ai: risk, thesis_generated_at: nowIso }).eq('id', co.id)
      if (error) { fail++; console.warn(`  ✗ ${co.id}: ${error.message}`) } else ok++
    }))
    if ((i / CONCURRENCY) % 20 === 0 && i > 0) console.log(`  ${i}/${todo.length}...`)
  }
  console.log(`Done: ${ok} written, ${fail} failed. Cost: $0.00`)

  // Show a sample so the run is verifiable at a glance.
  for (const sampleId of [todo[0]?.id, todo[Math.floor(todo.length / 2)]?.id].filter(Boolean)) {
    const { data } = await sb.from('companies').select('name, thesis_ai, thesis_risk_ai').eq('id', sampleId!).single()
    if (data) console.log(`\n— ${data.name}\n  ${data.thesis_ai}\n  RISK: ${data.thesis_risk_ai}`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })

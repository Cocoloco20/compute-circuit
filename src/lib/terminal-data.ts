/**
 * Data layer for /terminal — the Morning Terminal (Milestone 1).
 *
 * SERVICE ROLE ONLY. Every table this reads (migration 0048) is RLS-enabled
 * with zero policies, so the anon client would return `[]` rather than an
 * error — a silent empty dashboard. supabaseServiceRole() is the only client
 * that sees these rows, which is why this module must never be imported from
 * a "use client" component.
 *
 * The read is one Promise.all. Every zone is independently non-fatal: a zone
 * that fails renders its own error state and the rest of the terminal still
 * loads. The homepage outage on 2026-09-07 came from one failing read taking
 * the whole render down; this does the opposite by construction.
 */

import { supabaseServiceRole } from '@/lib/supabase/service-role'
import { fetchFund } from '@/lib/fund-data'
import type {
  PipelineCard, PipelineStage, Decision, DecisionResurfacing, CommitLogEntry,
} from '@/types/db'

// Shapes for the column-list selects below. types/db.ts keeps the Supabase
// Database generic deliberately light, so `.select('a, b')` types as `never`
// and every read casts — the same pattern graph-data.ts uses.
interface CompanyPriceRow {
  id: string
  name: string
  ticker: string | null
  last_price: number | null
  price_updated_at: string | null
  price_history: Array<[string, number]> | null
}
interface CompanyNameRow { id: string; name: string }
interface CompanySectorRow { id: string; name: string; layer_id: string | null }

/** Cards go stale in the funnel after this many days. Red badge past it. */
export const STALE_STAGE_DAYS = 14
/** A resurfacing left un-judged this long is itself an alert. */
export const UNREVIEWED_DAYS = 3
/** Data older than this shows the stale banner instead of pretending it's live. */
export const STALE_DATA_HOURS = 4

export const PIPELINE_STAGES: PipelineStage[] =
  ['Sourcing', 'Screening', 'DD', 'Term Sheet', 'Closed', 'Passed']

export interface QueueRow {
  companyId: string
  company: string
  sector: string | null
  stage: PipelineStage
  actionNeeded: string | null
  deadline: string | null
  owner: string | null
  daysInStage: number
  /** Why this row is in the queue — shown as the reason chip. */
  reason: 'overdue' | 'due-today' | 'term-sheet'
}

export interface HeatCell {
  companyId: string
  name: string
  ticker: string | null
  /** % move against cost basis. Null when we hold no cost or no price. */
  pctSinceCost: number | null
  lastPrice: number | null
  priceUpdatedAt: string | null
  history: number[]
}

export interface ResurfaceCard {
  id: string
  companyId: string
  company: string
  outcome: Decision['outcome']
  primaryFactor: Decision['primary_factor']
  confidence: number
  reasoning: string
  decidedAt: string
  triggerKind: DecisionResurfacing['trigger_kind']
  triggerSummary: string
  triggerDate: string | null
  triggerUrl: string | null
  createdAt: string
  daysWaiting: number
}

export interface Alert {
  kind: 'overdue' | 'stalled' | 'unreviewed' | 'sync'
  label: string
  count: number
  href: string
}

export interface ZoneError { failed: true; message: string }
export type Zone<T> = T | ZoneError
export function zoneFailed<T>(z: Zone<T>): z is ZoneError {
  return typeof z === 'object' && z !== null && (z as ZoneError).failed === true
}

export interface TerminalData {
  /** Newest price stamp across the universe — drives the stale banner. */
  dataAsOf: string | null
  dryPowderUsd: number | null
  queue: Zone<QueueRow[]>
  heat: Zone<HeatCell[]>
  pipeline: Zone<Array<{ stage: PipelineStage; count: number }>>
  resurfaced: Zone<ResurfaceCard[]>
  commits: Zone<CommitLogEntry[]>
  alerts: Alert[]
}

function daysSince(iso: string | null): number {
  if (!iso) return 0
  const ms = Date.now() - new Date(iso).getTime()
  return Math.max(0, Math.floor(ms / 86_400_000))
}

async function zone<T>(label: string, run: () => Promise<T>): Promise<Zone<T>> {
  try {
    return await run()
  } catch (err) {
    return { failed: true, message: `${label}: ${err instanceof Error ? err.message : String(err)}` }
  }
}

export async function fetchTerminal(): Promise<TerminalData> {
  const sb = supabaseServiceRole()

  // Today at 23:59:59 local — the queue's "deadline <= today EOD" boundary.
  const todayEod = new Date()
  todayEod.setHours(23, 59, 59, 999)
  const todayIso = todayEod.toISOString().slice(0, 10)

  const [cardsZ, heatZ, resurfZ, commitsZ, freshness] = await Promise.all([
    // ---- pipeline cards: feed both the queue and the stage snapshot -------
    zone('pipeline', async () => {
      const { data, error } = await sb
        .from('pipeline_cards')
        .select('*')
        .order('deadline', { ascending: true, nullsFirst: false })
      if (error) throw new Error(error.message)
      return (data ?? []) as unknown as PipelineCard[]
    }),

    // ---- portfolio heat: watchlist rows we actually hold -----------------
    zone('portfolio', async () => {
      const { data, error } = await sb
        .from('watchlist')
        .select('company_id, shares, avg_cost_usd')
        .not('shares', 'is', null)
      if (error) throw new Error(error.message)
      const rows = (data ?? []) as unknown as Array<{ company_id: string; shares: number | null; avg_cost_usd: number | null }>
      if (!rows.length) return [] as HeatCell[]

      const { data: cosRaw, error: coErr } = await sb
        .from('companies')
        .select('id, name, ticker, last_price, price_updated_at, price_history')
        .in('id', rows.map(r => r.company_id))
      if (coErr) throw new Error(coErr.message)
      // The Database generic in types/db.ts is intentionally light, so
      // column-list selects widen to `never`. Same cast the graph layer uses.
      const cos = (cosRaw ?? []) as unknown as CompanyPriceRow[]
      const byId = new Map(cos.map(c => [c.id, c]))

      return rows.map((r): HeatCell => {
        const c = byId.get(r.company_id)
        const price = c?.last_price ?? null
        const cost = r.avg_cost_usd
        return {
          companyId: r.company_id,
          name: c?.name ?? r.company_id,
          ticker: c?.ticker ?? null,
          lastPrice: price,
          priceUpdatedAt: c?.price_updated_at ?? null,
          pctSinceCost: price != null && cost != null && cost > 0
            ? ((price - cost) / cost) * 100
            : null,
          history: (c?.price_history ?? []).slice(-30).map(([, v]: [string, number]) => v),
        }
      }).sort((a, b) => (b.pctSinceCost ?? -Infinity) - (a.pctSinceCost ?? -Infinity))
    }),

    // ---- resurfaced decisions: the loop that closes ----------------------
    zone('resurfaced', async () => {
      const { data, error } = await sb
        .from('decision_resurfacings')
        .select('*')
        .is('verdict', null)
        .order('created_at', { ascending: false })
        .limit(3)
      if (error) throw new Error(error.message)
      const rs = (data ?? []) as unknown as DecisionResurfacing[]
      if (!rs.length) return [] as ResurfaceCard[]

      const { data: ds, error: dErr } = await sb
        .from('decisions').select('*').in('id', rs.map(r => r.decision_id))
      if (dErr) throw new Error(dErr.message)
      const decisionRows = (ds ?? []) as unknown as Decision[]
      const decisions = new Map(decisionRows.map(d => [d.id, d]))

      const companyIds = [...new Set(decisionRows.map(d => d.company_id))]
      const { data: cosRaw } = companyIds.length
        ? await sb.from('companies').select('id, name').in('id', companyIds)
        : { data: [] }
      const names = new Map(((cosRaw ?? []) as unknown as CompanyNameRow[])
        .map(c => [c.id, c.name]))

      return rs.flatMap((r): ResurfaceCard[] => {
        const d = decisions.get(r.decision_id)
        if (!d) return []          // orphaned trigger — skip, don't render half a card
        return [{
          id: r.id,
          companyId: d.company_id,
          company: names.get(d.company_id) ?? d.company_id,
          outcome: d.outcome,
          primaryFactor: d.primary_factor,
          confidence: d.confidence,
          reasoning: d.reasoning,
          decidedAt: d.decided_at,
          triggerKind: r.trigger_kind,
          triggerSummary: r.trigger_summary,
          triggerDate: r.trigger_date,
          triggerUrl: r.trigger_url,
          createdAt: r.created_at,
          daysWaiting: daysSince(r.created_at),
        }]
      })
    }),

    // ---- commit log: what happened while I slept -------------------------
    zone('commits', async () => {
      const { data, error } = await sb
        .from('commit_log').select('*')
        .order('created_at', { ascending: false }).limit(10)
      if (error) throw new Error(error.message)
      return (data ?? []) as unknown as CommitLogEntry[]
    }),

    // ---- freshness: newest price stamp in the universe -------------------
    (async () => {
      try {
        const { data } = await sb
          .from('companies').select('price_updated_at')
          .not('price_updated_at', 'is', null)
          .order('price_updated_at', { ascending: false }).limit(1)
        const row = (data ?? [])[0] as unknown as { price_updated_at: string } | undefined
        return row?.price_updated_at ?? null
      } catch { return null }
    })(),
  ])

  // ---- derive the queue and the stage snapshot from one card read --------
  let queue: Zone<QueueRow[]>
  let pipeline: Zone<Array<{ stage: PipelineStage; count: number }>>
  let companyNames = new Map<string, { name: string; sector: string | null }>()

  if (zoneFailed(cardsZ)) {
    queue = cardsZ
    pipeline = cardsZ
  } else {
    const cards = cardsZ
    pipeline = PIPELINE_STAGES.map(stage => ({
      stage, count: cards.filter(c => c.stage === stage).length,
    }))

    // Queue rule from the spec: deadline <= today EOD, OR stage = Term Sheet.
    const queued = cards.filter(c =>
      (c.deadline != null && c.deadline <= todayIso) || c.stage === 'Term Sheet')

    if (queued.length) {
      try {
        const { data } = await sb
          .from('companies').select('id, name, layer_id')
          .in('id', queued.map(c => c.company_id))
        companyNames = new Map(((data ?? []) as unknown as CompanySectorRow[])
          .map(c => [c.id, { name: c.name, sector: c.layer_id }]))
      } catch { /* names are cosmetic — fall back to the id */ }
    }

    queue = queued.slice(0, 5).map((c): QueueRow => {
      const meta = companyNames.get(c.company_id)
      return {
        companyId: c.company_id,
        company: meta?.name ?? c.company_id,
        sector: meta?.sector ?? null,
        stage: c.stage,
        actionNeeded: c.action_needed,
        deadline: c.deadline,
        owner: c.owner,
        daysInStage: daysSince(c.entered_stage_at),
        reason: c.deadline != null && c.deadline < todayIso ? 'overdue'
              : c.deadline === todayIso ? 'due-today'
              : 'term-sheet',
      }
    })
  }

  // ---- alert stripe: computed, never stored ------------------------------
  const alerts: Alert[] = []
  if (!zoneFailed(cardsZ)) {
    const overdue = cardsZ.filter(c => c.deadline != null && c.deadline < todayIso).length
    if (overdue) alerts.push({ kind: 'overdue', label: 'past deadline', count: overdue, href: '/terminal#queue' })

    const stalled = cardsZ.filter(c =>
      !['Closed', 'Passed'].includes(c.stage) &&
      daysSince(c.entered_stage_at) > STALE_STAGE_DAYS).length
    if (stalled) alerts.push({ kind: 'stalled', label: `stalled >${STALE_STAGE_DAYS}d`, count: stalled, href: '/terminal#pipeline' })
  }
  if (!zoneFailed(resurfZ)) {
    const cold = resurfZ.filter(r => r.daysWaiting > UNREVIEWED_DAYS).length
    if (cold) alerts.push({ kind: 'unreviewed', label: 'resurfaced, unjudged', count: cold, href: '/terminal#resurfaced' })
  }
  if (freshness && daysSince(freshness) >= 1) {
    alerts.push({ kind: 'sync', label: 'ingestion stale', count: 1, href: '/terminal' })
  }

  // Fund financials (migration 0052). Non-fatal: a terminal that fails to
  // render because the fund row is missing is worse than one showing "—".
  let dryPowderUsd: number | null = null
  try {
    const f = await fetchFund()
    if (f.fund && !f.error) dryPowderUsd = f.totals.dryPowder
  } catch { /* leave null */ }

  return {
    dataAsOf: freshness,
    dryPowderUsd,
    queue, heat: heatZ, pipeline, resurfaced: resurfZ, commits: commitsZ, alerts,
  }
}

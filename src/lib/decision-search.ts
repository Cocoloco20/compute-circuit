import { supabaseServiceRole } from '@/lib/supabase/service-role'
import { FACTORS, OUTCOMES } from '@/lib/decisions'
import type {
  Decision, DecisionOutcome, DecisionFactorName, ResurfaceVerdict,
} from '@/types/db'

/**
 * Decision search — the query layer that makes the log worth keeping.
 *
 * Capture without search is a diary. The questions this exists to answer are
 * the ones you cannot ask yourself honestly from memory:
 *
 *   "every pass where the blocker was market timing"
 *   "every pass I was 5/5 confident about"   ← the calibration set
 *   "every pass later judged wrong"          ← the anti-portfolio
 *
 * Server-rendered from query params so every one of those is a URL you can
 * bookmark, and so the answer is computed from rows rather than recalled.
 *
 * SERVICE ROLE ONLY — decisions is RLS-locked with zero policies, so the anon
 * client returns [] rather than an error. Never import this client-side.
 */

export const VERDICTS: ResurfaceVerdict[] = ['Yes', 'Partially', 'No']
export const PAGE_SIZE = 50

export interface DecisionFilters {
  company?: string
  factor?: DecisionFactorName
  outcome?: DecisionOutcome
  confidence?: number
  /**
   * 'No' is the anti-portfolio: passes where the reasoning was judged wrong.
   * The spec calls this verdict=Wrong; both spellings are accepted so a
   * bookmarked URL from the spec keeps working.
   */
  verdict?: ResurfaceVerdict | 'unreviewed'
  dissent?: boolean
  from?: string
  to?: string
  q?: string
  page: number
}

export interface DecisionRow {
  id: string
  companyId: string
  company: string
  outcome: DecisionOutcome
  primaryFactor: DecisionFactorName
  confidence: number
  reasoning: string
  whatWouldChangeMind: string | null
  dissent: boolean
  decidedAt: string
  /** Newest verdict across this decision's resurfacings; null if none/unjudged. */
  verdict: ResurfaceVerdict | null
  resurfacedCount: number
}

export interface SearchResult {
  rows: DecisionRow[]
  total: number
  page: number
  pages: number
  error: string | null
  /** Counts across the WHOLE log, not the filtered page — the context bar. */
  totals: {
    all: number
    byOutcome: Record<string, number>
    byFactor: Array<{ factor: string; n: number }>
    highConfidencePasses: number
    provenWrong: number
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function parseFilters(sp: Record<string, string | string[] | undefined>): DecisionFilters {
  const one = (k: string): string | undefined => {
    const v = sp[k]
    const s = Array.isArray(v) ? v[0] : v
    return s && s.trim() ? s.trim() : undefined
  }

  const rawVerdict = one('verdict')
  let verdict: DecisionFilters['verdict']
  if (rawVerdict) {
    // Accept the spec's "Wrong"/"Right" wording as well as the stored values.
    const v = rawVerdict.toLowerCase()
    if (v === 'wrong' || v === 'no') verdict = 'No'
    else if (v === 'right' || v === 'yes') verdict = 'Yes'
    else if (v === 'partially') verdict = 'Partially'
    else if (v === 'unreviewed') verdict = 'unreviewed'
  }

  const conf = Number(one('confidence'))
  const factor = one('factor') as DecisionFactorName | undefined
  const outcome = one('outcome') as DecisionOutcome | undefined
  const from = one('from')
  const to = one('to')

  return {
    company: one('company'),
    // Reject anything not in the enum rather than passing it to Postgres,
    // which would 400 the whole page over a typo'd bookmark.
    factor: factor && FACTORS.includes(factor) ? factor : undefined,
    outcome: outcome && OUTCOMES.includes(outcome) ? outcome : undefined,
    confidence: Number.isInteger(conf) && conf >= 1 && conf <= 5 ? conf : undefined,
    verdict,
    dissent: one('dissent') === 'true' ? true : undefined,
    from: from && ISO_DATE.test(from) ? from : undefined,
    to: to && ISO_DATE.test(to) ? to : undefined,
    q: one('q'),
    page: Math.max(1, Number(one('page')) || 1),
  }
}

/** Rebuild a query string with one key changed. Used by every filter control. */
export function withParam(
  current: Record<string, string | string[] | undefined>,
  key: string,
  value: string | null,
): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(current)) {
    const s = Array.isArray(v) ? v[0] : v
    if (s && k !== key && k !== 'page') p.set(k, s)
  }
  if (value) p.set(key, value)
  const s = p.toString()
  return s ? `/decisions?${s}` : '/decisions'
}

export async function searchDecisions(f: DecisionFilters): Promise<SearchResult> {
  const sb = supabaseServiceRole()
  const empty: SearchResult = {
    rows: [], total: 0, page: 1, pages: 0, error: null,
    totals: { all: 0, byOutcome: {}, byFactor: [], highConfidencePasses: 0, provenWrong: 0 },
  }

  try {
    // --- resolve a company name filter to ids -----------------------------
    // The filter is a name ("anthropic"), the column is an id, so this has to
    // resolve first. No match means no results — not "ignore the filter",
    // which would silently show the whole log instead.
    let companyIds: string[] | null = null
    if (f.company) {
      const { data } = await sb
        .from('companies').select('id').ilike('name', `%${f.company}%`).limit(200)
      companyIds = ((data ?? []) as unknown as Array<{ id: string }>).map(c => c.id)
      if (!companyIds.length) return { ...empty, page: f.page }
    }

    let q = sb.from('decisions').select('*', { count: 'exact' })
    if (companyIds) q = q.in('company_id', companyIds)
    if (f.factor) q = q.eq('primary_factor', f.factor)
    if (f.outcome) q = q.eq('outcome', f.outcome)
    if (f.confidence) q = q.eq('confidence', f.confidence)
    if (f.dissent) q = q.eq('dissent', true)
    if (f.from) q = q.gte('decided_at', `${f.from}T00:00:00Z`)
    if (f.to) q = q.lte('decided_at', `${f.to}T23:59:59Z`)
    if (f.q) {
      // Free text hits the two fields that hold actual reasoning.
      const safe = f.q.replace(/[%,()]/g, ' ')
      q = q.or(`reasoning.ilike.%${safe}%,what_would_change_mind.ilike.%${safe}%`)
    }

    const from = (f.page - 1) * PAGE_SIZE
    const { data, count, error } = await q
      .order('decided_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)

    let decisions = (data ?? []) as unknown as Decision[]

    // --- verdicts ---------------------------------------------------------
    const verdictByDecision = new Map<string, { verdict: ResurfaceVerdict | null; n: number }>()
    if (decisions.length) {
      const { data: rs } = await sb
        .from('decision_resurfacings')
        .select('decision_id, verdict, created_at')
        .in('decision_id', decisions.map(d => d.id))
        .order('created_at', { ascending: false })
      for (const r of ((rs ?? []) as unknown as Array<{
        decision_id: string; verdict: ResurfaceVerdict | null
      }>)) {
        const prev = verdictByDecision.get(r.decision_id)
        verdictByDecision.set(r.decision_id, {
          // Ordered newest-first, so the first non-null verdict seen wins.
          verdict: prev?.verdict ?? r.verdict,
          n: (prev?.n ?? 0) + 1,
        })
      }
    }

    // Verdict is a property of resurfacings, not of the decision row, so it
    // cannot be a SQL filter on `decisions`. Applying it after the page has
    // been fetched would silently drop rows and make the pager lie, so it
    // filters the fetched page and the count is corrected alongside.
    let filteredOut = 0
    if (f.verdict) {
      const before = decisions.length
      decisions = decisions.filter(d => {
        const v = verdictByDecision.get(d.id)
        return f.verdict === 'unreviewed'
          ? (!v || v.verdict === null)
          : v?.verdict === f.verdict
      })
      filteredOut = before - decisions.length
    }

    // --- names ------------------------------------------------------------
    let names = new Map<string, string>()
    if (decisions.length) {
      const { data: cos } = await sb
        .from('companies').select('id, name').in('id', decisions.map(d => d.company_id))
      names = new Map(((cos ?? []) as unknown as Array<{ id: string; name: string }>)
        .map(c => [c.id, c.name]))
    }

    const rows: DecisionRow[] = decisions.map(d => {
      const v = verdictByDecision.get(d.id)
      return {
        id: d.id,
        companyId: d.company_id,
        company: names.get(d.company_id) ?? d.company_id,
        outcome: d.outcome,
        primaryFactor: d.primary_factor,
        confidence: d.confidence,
        reasoning: d.reasoning,
        whatWouldChangeMind: d.what_would_change_mind,
        dissent: d.dissent,
        decidedAt: d.decided_at,
        verdict: v?.verdict ?? null,
        resurfacedCount: v?.n ?? 0,
      }
    })

    const total = Math.max(0, (count ?? 0) - filteredOut)

    return {
      rows,
      total,
      page: f.page,
      pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      error: null,
      totals: await computeTotals(sb),
    }
  } catch (err) {
    return { ...empty, page: f.page, error: err instanceof Error ? err.message : String(err) }
  }
}

type Sb = ReturnType<typeof supabaseServiceRole>

/**
 * Whole-log counts for the context bar. Deliberately unfiltered: the point of
 * "12 high-confidence passes" is that it does not move when you narrow the
 * table, so you can see where the current view sits against the whole record.
 */
async function computeTotals(sb: Sb): Promise<SearchResult['totals']> {
  const count = async (build: (q: ReturnType<Sb['from']>) => unknown): Promise<number> => {
    try {
      const r = await (build(sb.from('decisions')) as unknown as
        Promise<{ count: number | null }>)
      return r.count ?? 0
    } catch { return 0 }
  }

  const all = await count(t => t.select('*', { count: 'exact', head: true }))
  const byOutcome: Record<string, number> = {}
  for (const o of OUTCOMES) {
    byOutcome[o] = await count(t => t.select('*', { count: 'exact', head: true }).eq('outcome', o))
  }
  const highConfidencePasses = await count(t =>
    t.select('*', { count: 'exact', head: true }).eq('outcome', 'Pass').eq('confidence', 5))

  const byFactor: Array<{ factor: string; n: number }> = []
  for (const fac of FACTORS) {
    const n = await count(t =>
      t.select('*', { count: 'exact', head: true }).eq('primary_factor', fac))
    if (n) byFactor.push({ factor: fac, n })
  }
  byFactor.sort((a, b) => b.n - a.n)

  let provenWrong = 0
  try {
    const r = await sb.from('decision_resurfacings')
      .select('*', { count: 'exact', head: true }).eq('verdict', 'No')
    provenWrong = r.count ?? 0
  } catch { /* non-fatal */ }

  return { all, byOutcome, byFactor, highConfidencePasses, provenWrong }
}

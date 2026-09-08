import { supabaseServiceRole } from '@/lib/supabase/service-role'
import type { YcCompany } from '@/types/db'

/**
 * /screen — browse the reference layer and pull names into the pipeline.
 *
 * The funnel had no mouth. /pipeline only shows cards you already added, and
 * adding one required typing a name you already knew — so 11,000 tracked
 * companies were unreachable. This is the front end of the funnel.
 *
 * QUERY STRATEGY. Over 11k companies the wrong shape is "fetch everything,
 * filter in JS", and the second-wrong shape is an `.in()` with thousands of
 * ids, which blows the PostgREST URL length. So each request is driven from
 * whichever filter is most selective, and pagination is applied AT that
 * source:
 *
 *   backer filter   → drive from company_backers (one investor's rows)
 *   YC filters      → drive from yc_companies    (batch/status/size)
 *   otherwise       → drive from companies
 *
 * Whatever drives it returns one page of ids; the rest is a bounded fetch.
 */

export const PAGE_SIZE = 40

export interface ScreenFilters {
  backer?: string
  batch?: string
  status?: string
  maxTeam?: number
  sector?: string
  q?: string
  /** Hide anything already on the board — the default, since it is a sourcing view. */
  hideInPipeline: boolean
  page: number
}

export interface ScreenRow {
  id: string
  name: string
  ticker: string | null
  sector: string | null
  isPrivate: boolean
  domain: string | null
  backers: string[]
  yc: Pick<YcCompany, 'batch' | 'status' | 'team_size' | 'one_liner' | 'industry'> | null
  inPipeline: boolean
  fundingRounds: number
}

export interface ScreenResult {
  rows: ScreenRow[]
  total: number
  page: number
  pages: number
  error: string | null
  facets: {
    investors: Array<{ id: string; name: string; n: number }>
    batches: string[]
    sectors: string[]
  }
}

export function parseScreenFilters(sp: Record<string, string | string[] | undefined>): ScreenFilters {
  const one = (k: string) => {
    const v = sp[k]
    const s = Array.isArray(v) ? v[0] : v
    return s && s.trim() ? s.trim() : undefined
  }
  const maxTeam = Number(one('maxTeam'))
  return {
    backer: one('backer'),
    batch: one('batch'),
    status: one('status'),
    maxTeam: Number.isInteger(maxTeam) && maxTeam > 0 ? maxTeam : undefined,
    sector: one('sector'),
    q: one('q'),
    // Opt-out rather than opt-in: showing names already on the board by
    // default would make the view mostly re-reads of your own pipeline.
    hideInPipeline: one('showAll') !== 'true',
    page: Math.max(1, Number(one('page')) || 1),
  }
}

type Sb = ReturnType<typeof supabaseServiceRole>

export async function screenCompanies(f: ScreenFilters): Promise<ScreenResult> {
  const sb = supabaseServiceRole()
  const empty: ScreenResult = {
    rows: [], total: 0, page: f.page, pages: 0, error: null,
    facets: { investors: [], batches: [], sectors: [] },
  }

  try {
    const facets = await loadFacets(sb)
    const from = (f.page - 1) * PAGE_SIZE
    const usesYc = !!(f.batch || f.status || f.maxTeam)

    let ids: string[] = []
    let total = 0

    if (f.backer) {
      const r = await sb.from('company_backers')
        .select('company_id', { count: 'exact' })
        .eq('investor_id', f.backer)
        .order('company_id')
        .range(from, from + PAGE_SIZE - 1)
      if (r.error) throw new Error(r.error.message)
      ids = ((r.data ?? []) as unknown as Array<{ company_id: string }>).map(x => x.company_id)
      total = r.count ?? 0
      // A YC filter on top of a backer filter narrows the fetched page only.
      // Paginating the intersection properly needs a join we cannot express
      // here; the count stays the backer's total, so it is honest about being
      // the broader set rather than silently wrong.
      if (usesYc && ids.length) {
        let y = sb.from('yc_companies').select('company_id').in('company_id', ids)
        if (f.batch) y = y.eq('batch', f.batch)
        if (f.status) y = y.eq('status', f.status)
        if (f.maxTeam) y = y.lte('team_size', f.maxTeam)
        const yr = await y
        const keep = new Set(((yr.data ?? []) as unknown as Array<{ company_id: string }>)
          .map(x => x.company_id))
        ids = ids.filter(i => keep.has(i))
      }
    } else if (usesYc) {
      let y = sb.from('yc_companies').select('company_id', { count: 'exact' })
      if (f.batch) y = y.eq('batch', f.batch)
      if (f.status) y = y.eq('status', f.status)
      if (f.maxTeam) y = y.lte('team_size', f.maxTeam)
      const r = await y.order('company_id').range(from, from + PAGE_SIZE - 1)
      if (r.error) throw new Error(r.error.message)
      ids = ((r.data ?? []) as unknown as Array<{ company_id: string }>).map(x => x.company_id)
      total = r.count ?? 0
    } else {
      let c = sb.from('companies').select('id', { count: 'exact' })
      if (f.sector) c = c.eq('layer_id', f.sector)
      if (f.q) c = c.ilike('name', `%${f.q.replace(/[%,()]/g, ' ')}%`)
      const r = await c.order('name').range(from, from + PAGE_SIZE - 1)
      if (r.error) throw new Error(r.error.message)
      ids = ((r.data ?? []) as unknown as Array<{ id: string }>).map(x => x.id)
      total = r.count ?? 0
    }

    if (!ids.length) return { ...empty, total, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), facets }

    // ---- hydrate the page -----------------------------------------------
    const [cos, ycs, backerRows, inPipe, funding] = await Promise.all([
      sb.from('companies').select('id, name, ticker, layer_id, private, domain').in('id', ids),
      sb.from('yc_companies').select('company_id, batch, status, team_size, one_liner, industry').in('company_id', ids),
      sb.from('company_backers').select('company_id, investor_id').in('company_id', ids),
      sb.from('pipeline_cards').select('company_id').in('company_id', ids),
      sb.from('funding_rounds').select('company_id').in('company_id', ids),
    ])

    const coById = new Map(((cos.data ?? []) as unknown as Array<{
      id: string; name: string; ticker: string | null; layer_id: string | null
      private: boolean; domain: string | null
    }>).map(c => [c.id, c]))

    const ycById = new Map(((ycs.data ?? []) as unknown as Array<
      { company_id: string } & ScreenRow['yc']
    >).map(y => [y.company_id, y]))

    const investorName = new Map(facets.investors.map(i => [i.id, i.name]))
    const backersById = new Map<string, string[]>()
    for (const b of ((backerRows.data ?? []) as unknown as Array<{ company_id: string; investor_id: string }>)) {
      backersById.set(b.company_id, [
        ...(backersById.get(b.company_id) ?? []),
        investorName.get(b.investor_id) ?? b.investor_id,
      ])
    }

    const inPipeline = new Set(((inPipe.data ?? []) as unknown as Array<{ company_id: string }>)
      .map(p => p.company_id))
    const fundingCount = new Map<string, number>()
    for (const r of ((funding.data ?? []) as unknown as Array<{ company_id: string }>)) {
      fundingCount.set(r.company_id, (fundingCount.get(r.company_id) ?? 0) + 1)
    }

    let rows: ScreenRow[] = ids.flatMap(id => {
      const c = coById.get(id)
      if (!c) return []
      const y = ycById.get(id)
      return [{
        id: c.id,
        name: c.name,
        ticker: c.ticker,
        sector: c.layer_id,
        isPrivate: c.private,
        domain: c.domain,
        backers: (backersById.get(id) ?? []).sort(),
        yc: y ? {
          batch: y.batch, status: y.status, team_size: y.team_size,
          one_liner: y.one_liner, industry: y.industry,
        } : null,
        inPipeline: inPipeline.has(id),
        fundingRounds: fundingCount.get(id) ?? 0,
      }]
    })

    // Free-text and sector are applied here when something else drove the
    // query, so they can narrow a backer or YC page too.
    if (f.q && (f.backer || usesYc)) {
      const needle = f.q.toLowerCase()
      rows = rows.filter(r =>
        r.name.toLowerCase().includes(needle) ||
        (r.yc?.one_liner ?? '').toLowerCase().includes(needle))
    }
    if (f.sector && (f.backer || usesYc)) rows = rows.filter(r => r.sector === f.sector)
    if (f.hideInPipeline) rows = rows.filter(r => !r.inPipeline)

    return { rows, total, page: f.page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), error: null, facets }
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : String(err) }
  }
}

async function loadFacets(sb: Sb): Promise<ScreenResult['facets']> {
  const investors: Array<{ id: string; name: string; n: number }> = []
  try {
    const { data } = await sb.from('investors').select('id, name').order('name')
    for (const i of ((data ?? []) as unknown as Array<{ id: string; name: string }>)) {
      const c = await sb.from('company_backers')
        .select('*', { count: 'exact', head: true }).eq('investor_id', i.id)
      if (c.count) investors.push({ ...i, n: c.count })
    }
    investors.sort((a, b) => b.n - a.n)
  } catch { /* facets are navigation, not data — degrade quietly */ }

  // Newest batches first: "Fall 2026" must sort above "Winter 2012", which is
  // year-then-season, not alphabetical.
  const SEASON: Record<string, number> = { Winter: 0, Spring: 1, Summer: 2, Fall: 3 }
  let batches: string[] = []
  try {
    const seen = new Set<string>()
    for (let from = 0; from < 7000; from += 1000) {
      const { data } = await sb.from('yc_companies').select('batch').range(from, from + 999)
      const rows = (data ?? []) as unknown as Array<{ batch: string | null }>
      for (const r of rows) if (r.batch) seen.add(r.batch)
      if (rows.length < 1000) break
    }
    batches = [...seen].sort((a, b) => {
      const [sa, ya] = a.split(' '); const [sb_, yb] = b.split(' ')
      return Number(yb) - Number(ya) || (SEASON[sb_] ?? 0) - (SEASON[sa] ?? 0)
    })
  } catch { /* ignore */ }

  let sectors: string[] = []
  try {
    const { data } = await sb.from('layers').select('id').order('id')
    sectors = ((data ?? []) as unknown as Array<{ id: string }>).map(l => l.id)
  } catch { /* ignore */ }

  return { investors, batches, sectors }
}

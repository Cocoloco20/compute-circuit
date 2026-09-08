import { normalizeName, slugifyName } from '@/lib/scrapers/index'

/**
 * Y Combinator directory import.
 *
 * Source: https://yc-oss.github.io/api/companies/all.json — an open dataset on
 * GitHub Pages, rebuilt daily from YC's Algolia index. It is UNOFFICIAL and
 * ships no LICENSE, so treat it as internal research input and do not
 * redistribute it. YC's own robots.txt disallows /companies?*, so their site
 * directory is deliberately not crawled.
 *
 * Why import all 6,204 and not just the good ones: 1,072 are already Inactive
 * and 815 Acquired, and knowing that a name is dead is worth as much as
 * knowing it is live — a sourcing list that quietly omits the failures teaches
 * a false base rate. The status and batch columns carry that, so the caller
 * filters rather than the importer deciding.
 */

export const YC_API = 'https://yc-oss.github.io/api/companies/all.json'
export const YC_INVESTOR_ID = 'ycombinator'

export interface YcRecord {
  id?: number
  name?: string
  slug?: string
  website?: string
  batch?: string
  status?: string
  industry?: string
  subindustry?: string
  team_size?: number | null
  one_liner?: string
  url?: string
  top_company?: boolean
  launched_at?: number | null
}

export interface YcNormalized {
  ycId: number | null
  name: string
  slug: string | null
  website: string | null
  batch: string | null
  status: string | null
  industry: string | null
  subindustry: string | null
  teamSize: number | null
  oneLiner: string | null
  ycUrl: string | null
  topCompany: boolean
  launchedAt: string | null
  /** Stable company id when we have to insert this as a new company row. */
  companyId: string
  /** Match key against existing companies.name. */
  matchKey: string
}

export async function fetchYcDirectory(signal?: AbortSignal): Promise<YcRecord[]> {
  const r = await fetch(YC_API, {
    cache: 'no-store',
    signal: signal ?? AbortSignal.timeout(30_000),
    headers: { Accept: 'application/json' },
  })
  if (!r.ok) throw new Error(`yc directory: HTTP ${r.status}`)
  const body = (await r.json()) as unknown
  if (!Array.isArray(body)) throw new Error('yc directory: expected an array')
  return body as YcRecord[]
}

export function normalizeYc(rec: YcRecord): YcNormalized | null {
  const name = (rec.name ?? '').trim()
  if (!name) return null

  // YC slugs are unique and stable, so prefer them for the id and fall back to
  // the name only when a record somehow has none. Prefixed so a YC-discovered
  // row can never collide with a ticker-derived id like "nvda".
  const slug = rec.slug?.trim() || null
  const companyId = `yc-${slug || slugifyName(name)}`.slice(0, 64)

  return {
    ycId: typeof rec.id === 'number' ? rec.id : null,
    name,
    slug,
    website: rec.website?.trim() || null,
    batch: rec.batch?.trim() || null,
    status: rec.status?.trim() || null,
    industry: rec.industry?.trim() || null,
    subindustry: rec.subindustry?.trim() || null,
    teamSize: typeof rec.team_size === 'number' ? rec.team_size : null,
    oneLiner: rec.one_liner?.trim() || null,
    ycUrl: rec.url?.trim() || null,
    topCompany: rec.top_company === true,
    // The feed gives unix seconds; null is common and fine.
    launchedAt: typeof rec.launched_at === 'number' && rec.launched_at > 0
      ? new Date(rec.launched_at * 1000).toISOString()
      : null,
    companyId,
    matchKey: normalizeName(name),
  }
}

/**
 * Only 23 of the 6,204 are Public. Everything else is private, which is what
 * decides whether the row shows up in the compute graph's public-market views.
 */
export function isPrivate(status: string | null): boolean {
  return status !== 'Public'
}

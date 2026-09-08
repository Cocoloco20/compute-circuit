import { normalizeName, slugifyName, isFundVehicle } from '@/lib/scrapers/index'

/**
 * Shared normalizer for fund portfolio lists.
 *
 * Feeds from two places, both producing the same JSON shape:
 *   - sitemap enumeration done here (Sequoia publishes 425 company URLs)
 *   - ~/fund-os-research/portfolios/<fund>.json written by the Hermes agents
 *
 * Deliberately NOT a scraper. Each fund site is its own shape — WordPress,
 * Framer, hand-rolled — and the fragile per-site parsing lives outside this
 * file. What is shared, and what actually causes data corruption when it
 * differs between sources, is identity: how a name becomes a company id, how
 * it matches something already tracked, and what gets rejected.
 */

export interface PortfolioEntry {
  name: string
  url?: string | null
}

export interface PortfolioFile {
  fund: string
  domain?: string
  method?: string
  source_url?: string
  companies: PortfolioEntry[]
}

export interface NormalizedEntry {
  name: string
  url: string | null
  /** "<fund>-<slug>" — unique per fund, so two funds' rows never collide. */
  companyId: string
  matchKey: string
}

/**
 * "unconventional-ai" → "Unconventional AI".
 *
 * Slug-derived names are lossy, and for Framer/SPA sites the slug is all the
 * raw HTML gives — the rendered title is generic. Acronyms are the part worth
 * special-casing: "ai"/"api"/"hq" title-cased naively read as Ai/Api/Hq,
 * which then fail to match an existing "…AI" row and create a duplicate.
 */
const ACRONYMS = new Set([
  'ai', 'api', 'ar', 'vr', 'hq', 'io', 'ml', 'os', 'db', 'ui', 'ux',
  'hr', 'it', 'cx', 'crm', 'erp', 'sdk', 'llm', 'gpu', 'iot', '3d', 'xr',
])

export function humanizeSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map(w => ACRONYMS.has(w.toLowerCase())
      ? w.toUpperCase()
      : w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export function slugFromUrl(url: string): string | null {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean)
    return parts[parts.length - 1] ?? null
  } catch {
    return null
  }
}

/**
 * Reasons an entry is dropped rather than imported. Returned rather than
 * thrown so the caller can report what it rejected — a silent drop is how an
 * import ends up claiming coverage it does not have.
 */
export type RejectReason = 'empty' | 'fund-vehicle' | 'too-short' | 'boilerplate'

/** Nav/footer text that leaks out of a portfolio page's link list. */
const BOILERPLATE = new Set([
  'portfolio', 'companies', 'our companies', 'team', 'about', 'contact',
  'news', 'insights', 'careers', 'jobs', 'home', 'all', 'more', 'privacy',
  'terms', 'blog', 'people', 'press', 'stories', 'perspectives',
])

export function rejectReason(name: string): RejectReason | null {
  const n = name.trim()
  if (!n) return 'empty'
  // A single character is never a real company name in these lists; it is
  // almost always an alphabet filter control ("A B C D…") on the page.
  if (n.length < 2) return 'too-short'
  if (BOILERPLATE.has(n.toLowerCase())) return 'boilerplate'
  if (isFundVehicle(n)) return 'fund-vehicle'
  return null
}

export function normalizeEntry(
  fund: string,
  e: PortfolioEntry,
  /**
   * The fund's own domain. A url only yields a usable slug when it points at
   * the FUND's site (sequoiacap.com/companies/klarna → "klarna"). a16z's
   * entries carry the company's own homepage instead, where the last path
   * segment is meaningless or empty — deriving a slug from those produced ids
   * like "a16z-" and collapsed unrelated companies onto one row.
   */
  fundDomain?: string,
): NormalizedEntry | null {
  const name = (e.name ?? '').trim()
  if (rejectReason(name)) return null

  let slug: string | null = null
  if (e.url && fundDomain) {
    try {
      const host = new URL(e.url).hostname.replace(/^www\./, '')
      if (host === fundDomain.replace(/^www\./, '')) slug = slugFromUrl(e.url)
    } catch { /* unparseable url — fall through to the name */ }
  }
  if (!slug) slug = slugifyName(name)

  return {
    name,
    url: e.url ?? null,
    companyId: `${fund}-${slug}`.slice(0, 64),
    matchKey: normalizeName(name),
  }
}

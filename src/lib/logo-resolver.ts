import { upstreamSignal } from './cron-budget'
/**
 * Logo auto-resolver.
 *
 * Two responsibilities:
 *   1. resolveDomainForCompany(name, ticker?) — given a company name (and
 *      optional ticker), find a canonical web domain. Free sources only,
 *      no API keys:
 *        a) Wikipedia REST summary  → infobox 'website' row scrape
 *        b) DuckDuckGo Instant Answer API
 *      Returns the bare domain (e.g. "vertiv.com"), no scheme/path.
 *
 *   2. verifyLogoForDomain(domain) — HEAD-fetch our own /api/logo/{domain}
 *      proxy and tell whether the bytes returned are a real logo or the
 *      gstatic default placeholder. Used by the cron to set
 *      logo_status='verified' vs 'fallback'.
 *
 * Both functions are conservative on failure: any thrown fetch error returns
 * null instead of bubbling, so the cron can mark the row 'missing' and move on.
 *
 * Politeness: each function does at most 1-2 HTTP calls. The cron caps its
 * batch at 30 cos/run.
 */

const UA = 'compute-circuit-logo-resolver (research tool) luigui.h2002@gmail.com'

// When gstatic faviconV2 can't find a favicon for a domain, it returns a
// tiny ~9-byte sentinel response. Real PNG favicons start around 600 bytes
// and run up to ~3KB. We classify any response under 100 bytes as a
// "placeholder" (effectively missing), and anything above that as a real
// logo. The threshold is generous on the low side because some legit
// favicons (e.g. Anthropic's 948-byte single-color glyph) are quite small.
const DEFAULT_PLACEHOLDER_MAX_BYTES = 100

export interface ResolvedDomain {
  domain: string
  source: 'wikipedia' | 'duckduckgo'
}

/**
 * Try to resolve a usable web domain for a company.
 * Returns null if no source produces one.
 */
export async function resolveDomainForCompany(
  name: string,
  ticker?: string | null,
): Promise<ResolvedDomain | null> {
  // 1) Wikipedia first — most reliable for established companies. The infobox
  // 'website' row is canonical (sourced from Wikidata's P856 property).
  // Ticker is intentionally not used for Wikipedia lookup — the slug-based
  // article URL doesn't accept ticker queries.
  const fromWiki = await tryWikipedia(name)
  if (fromWiki) return { domain: fromWiki, source: 'wikipedia' }

  // 2) DuckDuckGo Instant Answer fallback. Less reliable but doesn't require
  // an exact Wikipedia article name.
  const fromDdg = await tryDuckDuckGo(name, ticker)
  if (fromDdg) return { domain: fromDdg, source: 'duckduckgo' }

  return null
}

/**
 * HEAD-fetch /api/logo/{domain} (via the supplied baseUrl) and classify the
 * response:
 *   - 'verified'  — proxy returned > DEFAULT_PLACEHOLDER_MAX_BYTES (real logo)
 *   - 'fallback'  — proxy returned a small generic placeholder
 *   - 'missing'   — proxy returned non-2xx OR the fetch threw
 */
export async function verifyLogoForDomain(
  domain: string,
  baseUrl: string,
): Promise<'verified' | 'fallback' | 'missing'> {
  try {
    // HEAD first to avoid pulling bytes when we just need Content-Length.
    // The /api/logo proxy supports HEAD via Next's default handler chaining
    // (it returns the same headers as GET, sans body).
    const headRes = await fetch(`${baseUrl}/api/logo/${encodeURIComponent(domain)}`, { signal: upstreamSignal(15_000),
      method: 'HEAD',
      headers: { 'User-Agent': UA },
    })
    if (!headRes.ok) {
      // 404 / 502 from the proxy → upstream had nothing.
      return 'missing'
    }
    const lenHeader = headRes.headers.get('content-length')
    const len = lenHeader ? parseInt(lenHeader, 10) : NaN
    if (Number.isFinite(len) && len > 0) {
      return len > DEFAULT_PLACEHOLDER_MAX_BYTES ? 'verified' : 'fallback'
    }
    // No content-length (some edges strip it). Fall back to a real GET so we
    // can measure the body length ourselves.
    const getRes = await fetch(`${baseUrl}/api/logo/${encodeURIComponent(domain)}`, { signal: upstreamSignal(15_000),
      headers: { 'User-Agent': UA },
    })
    if (!getRes.ok) return 'missing'
    const buf = await getRes.arrayBuffer()
    return buf.byteLength > DEFAULT_PLACEHOLDER_MAX_BYTES ? 'verified' : 'fallback'
  } catch {
    return 'missing'
  }
}

// ---------- internals ----------

/**
 * Wikipedia REST summary endpoint → article URL → HTML scrape of infobox
 * 'website' row. Two HTTP calls in the happy path.
 *
 * The summary endpoint accepts a fuzzy slug, but we improve hit rate by
 * trying the company name with several normalizations:
 *   "Vertiv Holdings Co"           → "Vertiv_Holdings_Co"
 *   "Vertiv Holdings Co" (ticker)  → "Vertiv"  (drop corporate suffix)
 * If both miss, we give up — DuckDuckGo will try next.
 */
async function tryWikipedia(name: string): Promise<string | null> {
  const candidates = makeWikiCandidates(name)
  for (const slug of candidates) {
    const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(slug)}`
    try {
      const summary = await fetch(summaryUrl, { signal: upstreamSignal(8_000),
        headers: { 'User-Agent': UA, Accept: 'application/json' },
      })
      if (!summary.ok) continue
      const json = await summary.json() as {
        type?: string
        content_urls?: { desktop?: { page?: string } }
        title?: string
      }
      // 'disambiguation' or 'standard' page types come back; only the latter
      // is useful for infobox scraping.
      if (json.type === 'disambiguation') continue
      const pageUrl = json.content_urls?.desktop?.page
      if (!pageUrl) continue

      const pageRes = await fetch(pageUrl, { signal: upstreamSignal(8_000),
        headers: { 'User-Agent': UA, Accept: 'text/html' },
      })
      if (!pageRes.ok) continue
      const html = await pageRes.text()
      const domain = extractWebsiteFromInfobox(html)
      if (domain) return domain
    } catch {
      // network failure on this candidate — try the next.
      continue
    }
  }
  return null
}

/**
 * Build ordered candidate slugs for Wikipedia summary lookup.
 *   "OpenAI"                        → ["OpenAI"]
 *   "Vertiv Holdings Co"            → ["Vertiv_Holdings_Co", "Vertiv"]
 *   "Vertiv Holdings Co" (VRT)      → ["Vertiv_Holdings_Co", "Vertiv"]
 */
function makeWikiCandidates(name: string): string[] {
  const out: string[] = []
  const base = name.trim().replace(/\s+/g, '_')
  if (base) out.push(base)

  // Strip common corporate suffixes for a second attempt.
  const stripped = name
    .replace(/\b(Holdings|Holding|Inc\.?|Corp\.?|Corporation|Company|Co\.?|Ltd\.?|Limited|LLC|PLC|Group|N\.V\.|S\.A\.|SA|AG|S\.p\.A\.)\b/gi, '')
    .replace(/[.,]/g, '')
    .trim()
    .replace(/\s+/g, '_')
  if (stripped && stripped !== base) out.push(stripped)

  return out
}

/**
 * Scrape a rendered Wikipedia page for the infobox 'Website' row.
 * Wikipedia renders the website cell as either:
 *   <a class="external text" href="https://www.example.com">www.example.com</a>
 *   <span class="url">www.example.com</span>
 * We look for the first one inside a table.infobox row whose header says
 * "Website" (case-insensitive).
 */
function extractWebsiteFromInfobox(html: string): string | null {
  // Find the infobox block. There's only ever one per page.
  const infoboxMatch = html.match(/<table[^>]*class="[^"]*infobox[^"]*"[\s\S]*?<\/table>/i)
  if (!infoboxMatch) return null
  const infobox = infoboxMatch[0]

  // Find a row whose <th> says "Website".
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  let row: RegExpExecArray | null
  while ((row = rowRe.exec(infobox))) {
    const inner = row[1]
    if (!/<th[^>]*>[\s\S]*?(?:Website|Web\s*site)[\s\S]*?<\/th>/i.test(inner)) continue
    // First href or span.url wins.
    const hrefMatch = inner.match(/<a[^>]*href="(https?:\/\/[^"]+)"/i)
    if (hrefMatch) {
      const d = hrefToDomain(hrefMatch[1])
      if (d) return d
    }
    const spanMatch = inner.match(/<span[^>]*class="[^"]*\burl\b[^"]*"[^>]*>([^<]+)</i)
    if (spanMatch) {
      const d = hrefToDomain('http://' + spanMatch[1].trim())
      if (d) return d
    }
    return null
  }
  return null
}

/**
 * DuckDuckGo Instant Answer JSON API. Free, no key, returns an `AbstractURL`
 * field for many entity queries that points at the official site.
 */
async function tryDuckDuckGo(name: string, ticker?: string | null): Promise<string | null> {
  const query = ticker ? `${name} ${ticker}` : name
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
  try {
    const r = await fetch(url, { signal: upstreamSignal(8_000), headers: { 'User-Agent': UA, Accept: 'application/json' } })
    if (!r.ok) return null
    const j = await r.json() as { AbstractURL?: string; Results?: Array<{ FirstURL?: string }> }
    if (j.AbstractURL) {
      const d = hrefToDomain(j.AbstractURL)
      if (d) return d
    }
    // Fallback: first Result URL if AbstractURL is absent.
    const firstResult = j.Results?.[0]?.FirstURL
    if (firstResult) {
      const d = hrefToDomain(firstResult)
      if (d) return d
    }
    return null
  } catch {
    return null
  }
}

/**
 * Normalize an href into a bare domain. Strips scheme, www., path, and
 * lowercases. Returns null for unparseable input or for hrefs that are
 * actually Wikipedia/Wikimedia URLs (which sometimes leak through if the
 * infobox row had a Wikipedia link instead of an external one).
 */
function hrefToDomain(href: string): string | null {
  try {
    const u = new URL(href)
    let h = u.hostname.toLowerCase()
    if (h.startsWith('www.')) h = h.slice(4)
    if (!h.includes('.')) return null
    // Reject Wikipedia self-links and our own host (paranoia).
    if (/\b(wikipedia|wikimedia)\.org$/i.test(h)) return null
    return h
  } catch {
    return null
  }
}

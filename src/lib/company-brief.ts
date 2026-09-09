/**
 * Read a company's homepage — the one page it wrote to explain itself.
 *
 * Not a crawler. One GET to the root, meta tags and headline out, done. This
 * is what a link preview does, and it is what a person does first when they
 * open a company they have never heard of.
 *
 * Deliberately no LLM. A meta description written by the company is a better
 * summary than anything generated from it, it costs nothing, and it cannot
 * hallucinate a product that does not exist.
 *
 * When the homepage refuses — OpenAI and xAI both return 403 to any
 * unauthenticated GET — it falls back to Wikipedia's summary API: free, no key,
 * no meaningful rate limit. That text is a THIRD PARTY describing the company,
 * not the company describing itself, so every brief carries its `source` and
 * the UI must not present a Wikipedia extract under "What they say they do".
 */

export type FetchStatus =
  | 'ok' | 'http_error' | 'timeout' | 'no_domain' | 'blocked' | 'parse_empty' | 'dns_error'

export type BriefSource = 'homepage' | 'wikipedia'

export interface Brief {
  source: BriefSource
  url: string | null
  title: string | null
  description: string | null
  headline: string | null
  extract: string | null
  fetchStatus: FetchStatus
  httpStatus: number | null
}

const TIMEOUT_MS = 9000
const MAX_EXTRACT = 600
const UA = 'compute-circuit/1.0 (+research; contact via site owner)'

function decode(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#x27;/g, "'").replace(/&#x2F;/g, '/')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
}

function meta(html: string, ...names: string[]): string | null {
  for (const n of names) {
    // Attribute order varies, so match either ordering rather than assuming.
    const patterns = [
      new RegExp(`<meta[^>]+(?:name|property)=["']${n}["'][^>]+content=["']([^"']{2,400})["']`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']{2,400})["'][^>]+(?:name|property)=["']${n}["']`, 'i'),
    ]
    for (const re of patterns) {
      const m = html.match(re)
      if (m?.[1]?.trim()) return decode(m[1].trim())
    }
  }
  return null
}

/** Visible body copy with the furniture stripped. Best-effort by design. */
function extractText(html: string): string | null {
  const body = html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
  const text = decode(body).replace(/\s+/g, ' ').trim()
  if (text.length < 40) return null
  return text.slice(0, MAX_EXTRACT)
}

export async function fetchBrief(domain: string | null): Promise<Brief> {
  const empty: Brief = {
    source: 'homepage',
    url: null, title: null, description: null, headline: null,
    extract: null, fetchStatus: 'no_domain', httpStatus: null,
  }
  if (!domain) return empty

  const clean = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '')
  if (!clean || !clean.includes('.')) return empty
  const url = `https://${clean}/`

  let res: Response
  try {
    res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Distinguish "no such host" from "took too long" — a dead domain is a
    // signal about the company; a timeout is a signal about the fetch.
    const dns = /ENOTFOUND|getaddrinfo|dns/i.test(msg)
    return { ...empty, url, fetchStatus: dns ? 'dns_error' : 'timeout' }
  }

  if (!res.ok) {
    return { ...empty, url, fetchStatus: res.status === 403 || res.status === 429 ? 'blocked' : 'http_error',
             httpStatus: res.status }
  }

  const ct = res.headers.get('content-type') ?? ''
  if (!ct.includes('html')) return { ...empty, url, fetchStatus: 'parse_empty', httpStatus: res.status }

  // Cap the read: a homepage that ships megabytes is not giving us more signal.
  const html = (await res.text()).slice(0, 400_000)

  const title = (html.match(/<title[^>]*>([^<]{2,200})<\/title>/i)?.[1] ?? '').trim() || null
  const description = meta(html, 'description', 'og:description', 'twitter:description')
  const headline = (html.match(/<h1[^>]*>([\s\S]{2,200}?)<\/h1>/i)?.[1] ?? '')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || null
  const extract = extractText(html)

  const anything = title || description || headline || extract
  return {
    source: 'homepage',
    url,
    title: title ? decode(title) : null,
    description,
    headline: headline ? decode(headline) : null,
    extract,
    fetchStatus: anything ? 'ok' : 'parse_empty',
    httpStatus: res.status,
  }
}


/* ------------------------------------------------------------------ */
/* Wikipedia fallback                                                  */
/* ------------------------------------------------------------------ */

/**
 * The danger here is not a failed lookup, it is a confident wrong one.
 * "Expanse" is a GPU-scheduling startup and also a television series; "Arch",
 * "Basis", "Alliance" and "Color" are all portfolio companies AND common
 * nouns with articles. A brief that quietly describes the wrong subject is
 * worse than no brief, because nothing downstream can tell it is wrong.
 *
 * So a Wikipedia hit is accepted only when it looks like an organisation and
 * its title actually corresponds to the company name.
 */
const ORG_HINT = new RegExp(
  '\\b(compan(y|ies)|corporation|corp\\b|incorporated|\\binc\\b|holdings|start-?up|firm|' +
  'business|enterprise|conglomerate|subsidiary|manufacturer|developer|laborator(y|ies)|' +
  'research (lab|organi[sz]ation|institute)|venture capital|technology (company|firm)|' +
  'software|platform|marketplace|brand|bank|airline|studio)\\b', 'i')

function normTitle(s: string): string {
  return s.toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim()
}

/** Does this Wikipedia page plausibly describe THIS company? */
function titleMatches(companyName: string, pageTitle: string): boolean {
  const a = normTitle(companyName)
  const b = normTitle(pageTitle)
  if (!a || !b) return false
  if (a === b) return true
  // Allow "Anthropic" -> "Anthropic PBC" and "OpenAI" -> "OpenAI", but reject
  // "Expanse" -> "The Expanse", where the page title carries extra leading
  // words that change the subject.
  return b.startsWith(a + ' ') || a.startsWith(b + ' ')
}

interface WikiSummary {
  type?: string; title?: string; description?: string; extract?: string
  content_urls?: { desktop?: { page?: string } }
}

async function wikiSummary(title: string): Promise<WikiSummary | null> {
  try {
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
      { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'User-Agent': UA, Accept: 'application/json' } },
    )
    if (!res.ok) return null
    return (await res.json()) as WikiSummary
  } catch {
    return null
  }
}

export async function fetchWikipediaBrief(
  companyName: string | null,
): Promise<Brief | null> {
  if (!companyName || companyName.trim().length < 2) return null
  const name = companyName.trim()

  let j = await wikiSummary(name)
  // A bare name often lands on a disambiguation page — "xAI" resolves to "Xai",
  // which lists a Chinese given name, a game studio and the company. Wikipedia's
  // own convention disambiguates with a "(company)" suffix, so ask for that
  // exact page rather than guessing among the alternatives.
  if (j && j.type === 'disambiguation') j = await wikiSummary(`${name} (company)`)
  if (!j || (j.type && j.type !== 'standard')) return null
  if (!j.title || !titleMatches(name, j.title)) return null

  // Test the SHORT descriptor, not the article body. The body of "Alliance"
  // ("groups, or states that have joined together for mutual benefit...")
  // trips an organisation regex while describing a concept, not a company;
  // its descriptor, "Coalition of individuals to secure common interests",
  // correctly does not. Only fall back to the extract when there is no
  // descriptor at all.
  const descriptor = (j.description ?? '').trim()
  if (!ORG_HINT.test(descriptor || (j.extract ?? ''))) return null

  const extract = (j.extract ?? '').trim().slice(0, MAX_EXTRACT) || null
  if (!extract && !descriptor) return null

  return {
    source: 'wikipedia',
    url: j.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(j.title)}`,
    title: j.title,
    description: j.description ?? null,
    headline: null,
    extract,
    fetchStatus: 'ok',
    httpStatus: 200,
  }
}

/**
 * Homepage first, Wikipedia only to rescue a failure. Never the other way
 * round: the company's own words outrank an encyclopedia's whenever we can get
 * them. The original failure status is preserved on the returned brief's
 * httpStatus so a rescued 403 is still visibly a 403 upstream.
 */
export async function fetchBriefWithFallback(
  domain: string | null,
  companyName: string | null,
): Promise<Brief> {
  const primary = await fetchBrief(domain)
  if (primary.fetchStatus === 'ok') return primary
  const wiki = await fetchWikipediaBrief(companyName)
  return wiki ?? primary
}

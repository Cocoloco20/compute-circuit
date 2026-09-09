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
 */

export type FetchStatus =
  | 'ok' | 'http_error' | 'timeout' | 'no_domain' | 'blocked' | 'parse_empty' | 'dns_error'

export interface Brief {
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
    url,
    title: title ? decode(title) : null,
    description,
    headline: headline ? decode(headline) : null,
    extract,
    fetchStatus: anything ? 'ok' : 'parse_empty',
    httpStatus: res.status,
  }
}

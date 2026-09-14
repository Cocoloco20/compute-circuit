/**
 * Google News RSS client.
 *
 * Free, no signup, no documented rate limit (anecdotally generous).
 * URL: https://news.google.com/rss/search?q=<term>&hl=en-US&gl=US&ceid=US:en
 *
 * Returns up to ~100 most-recent articles for the search term, ordered newest first.
 * Each <item> has title, link (Google redirector URL), pubDate (RFC 822), source
 * (publisher name as text node with @url attr). We parse with fast-xml-parser
 * and normalize.
 */

import { XMLParser } from 'fast-xml-parser'
import { upstreamSignal, type Budget } from './cron-budget'

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15'

export interface NewsItem {
  title: string
  link: string
  pubDate: string   // ISO date string
  source: string    // publisher name (e.g. "Bloomberg", "Reuters")
}

interface RssItem {
  title?: string
  link?: string
  pubDate?: string
  source?: string | { '#text'?: string }
  guid?: string | { '#text'?: string }
}

export async function fetchGoogleNewsRss(query: string): Promise<NewsItem[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/rss+xml' },
      signal: upstreamSignal(),
    })
    if (!r.ok) return []
    const xml = await r.text()
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@',
      removeNSPrefix: true,
      // Google News titles often contain entities like &amp;#39; — let the parser unescape.
    })
    const parsed = parser.parse(xml) as { rss?: { channel?: { item?: RssItem | RssItem[] } } }
    const raw = parsed?.rss?.channel?.item
    if (!raw) return []
    const items = Array.isArray(raw) ? raw : [raw]
    const out: NewsItem[] = []
    for (const it of items) {
      const title = typeof it.title === 'string' ? it.title.trim() : ''
      const link = typeof it.link === 'string' ? it.link.trim() : ''
      if (!title || !link) continue
      let pubDate = ''
      try { pubDate = new Date(it.pubDate ?? '').toISOString() } catch { continue }
      const source = typeof it.source === 'object' && it.source
        ? (it.source['#text'] ?? '').toString()
        : (typeof it.source === 'string' ? it.source : '')
      out.push({ title, link, pubDate, source })
    }
    return out
  } catch {
    return []
  }
}

/**
 * Fetch news for many search terms in parallel chunks.
 *
 * Stops launching new chunks once `budget` expires and returns what it has —
 * callers order `queries` staleness-first so the rows that miss are the ones
 * that were refreshed most recently.
 */
export async function fetchNewsForMany(
  queries: Array<{ id: string; query: string }>,
  chunkSize = 10,
  budget?: Budget,
): Promise<Map<string, NewsItem[]>> {
  const out = new Map<string, NewsItem[]>()
  for (let i = 0; i < queries.length; i += chunkSize) {
    if (budget?.expired()) break
    const chunk = queries.slice(i, i + chunkSize)
    const res = await Promise.all(chunk.map(async (q) => ({ id: q.id, news: await fetchGoogleNewsRss(q.query) })))
    for (const r of res) out.set(r.id, r.news)
  }
  return out
}

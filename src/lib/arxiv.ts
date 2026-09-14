import { XMLParser } from 'fast-xml-parser'
import { upstreamSignal, type Budget } from './cron-budget'

const UA = 'compute-circuit (research tool) luigui.h2002@gmail.com'

export interface ArxivPaperInfo {
  arxivId: string
  title: string
  summary: string
  authors: string[]
  primaryCategory: string
  publishedDate: Date
  url: string
}

export interface ArxivSnapshotInfo {
  companyId: string
  snapshotDate: string
  papers30d: number
  papers7d: number
  topPaperArxivId: string | null
  topPaperTitle: string | null
  yoyPct: number | null
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export async function fetchPapersForAffiliation(
  affiliation: string,
  sinceDate: Date
): Promise<ArxivPaperInfo[]> {
  const names = affiliation.split(' || ').map(n => n.trim())
  const parts = names.map(name => `all:"${name}"`)
  const terms = parts.length > 1 ? `(${parts.join(' OR ')})` : parts[0]
  const searchQuery = `${terms} AND cat:cs.LG`

  const url = `http://export.arxiv.org/api/query?search_query=${encodeURIComponent(
    searchQuery
  )}&start=0&max_results=100&sortBy=submittedDate&sortOrder=descending`

  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: upstreamSignal(12_000) })
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[arxiv] Fetch failed with status ${res.status} for affiliation: ${affiliation}`)
      return []
    }

    const xml = await res.text()
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@',
      removeNSPrefix: true,
    })

    const parsed = parser.parse(xml)
    if (!parsed.feed || !parsed.feed.entry) return []

    const rawEntries = parsed.feed.entry
    const entries = Array.isArray(rawEntries) ? rawEntries : [rawEntries]
    const papers: ArxivPaperInfo[] = []

    for (const entry of entries) {
      const idUrl = typeof entry.id === 'string' ? entry.id : ''
      const absIndex = idUrl.indexOf('/abs/')
      const arxivId = absIndex !== -1 ? idUrl.slice(absIndex + 5).replace(/v\d+$/, '') : ''
      if (!arxivId) continue

      const title = typeof entry.title === 'string' ? entry.title.replace(/\s+/g, ' ').trim() : ''
      const summary = typeof entry.summary === 'string' ? entry.summary.replace(/\s+/g, ' ').trim() : ''
      
      const rawAuthors = entry.author
      const authorArr = Array.isArray(rawAuthors) ? rawAuthors : (rawAuthors ? [rawAuthors] : [])
      const authors = authorArr
        .map((a: unknown) => {
          if (typeof a === 'object' && a !== null) {
            const obj = a as { name?: unknown }
            return typeof obj.name === 'string' ? obj.name : ''
          }
          return typeof a === 'string' ? a : ''
        })
        .filter((name): name is string => typeof name === 'string' && !!name.trim())
        .map((name: string) => name.trim())

      const primaryCategory = (
        entry.primary_category?.['@term'] ||
        entry.primary_category?.['term'] ||
        entry.category?.['@term'] ||
        entry.category?.['term'] ||
        ''
      ).toString()

      const published = typeof entry.published === 'string' ? entry.published : (typeof entry.updated === 'string' ? entry.updated : '')
      if (!published) continue

      const publishedDate = new Date(published)
      if (publishedDate.getTime() < sinceDate.getTime()) {
        continue
      }

      const urlLink = `https://arxiv.org/abs/${arxivId}`

      papers.push({
        arxivId,
        title,
        summary,
        authors,
        primaryCategory,
        publishedDate,
        url: urlLink,
      })
    }

    return papers
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[arxiv] Error parsing papers for ${affiliation}:`, err)
    return []
  }
}

export async function fetchAllArxivSnapshots(
  entries: Array<{ companyId: string; affiliation: string }>,
  budget?: Budget,
): Promise<Array<{ companyId: string; snap: ArxivSnapshotInfo | null; papers: ArxivPaperInfo[] }>> {
  const out: Array<{ companyId: string; snap: ArxivSnapshotInfo | null; papers: ArxivPaperInfo[] }> = []
  
  const today = new Date()
  const sinceDate = new Date(Date.now() - 395 * 24 * 60 * 60 * 1000)
  const snapshotDate = today.toISOString().slice(0, 10)

  // Process in parallel batches of 3
  const batchSize = 3
  for (let i = 0; i < entries.length; i += batchSize) {
    if (budget?.expired()) break
    const batch = entries.slice(i, i + batchSize)
    const batchRes = await Promise.all(
      batch.map(async (entry) => {
        const papers = await fetchPapersForAffiliation(entry.affiliation, sinceDate)
        
        if (papers.length === 0) {
          return { companyId: entry.companyId, snap: null, papers: [] }
        }

        const date30dAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        const date7dAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

        // YoY date ranges (T-365 to T-365-30)
        const date365dAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
        const date395dAgo = new Date(Date.now() - 395 * 24 * 60 * 60 * 1000)

        let papers30d = 0
        let papers7d = 0
        let papersPrior30d = 0

        for (const p of papers) {
          const t = p.publishedDate.getTime()
          if (t >= date30dAgo.getTime()) papers30d++
          if (t >= date7dAgo.getTime()) papers7d++
          if (t >= date395dAgo.getTime() && t <= date365dAgo.getTime()) papersPrior30d++
        }

        let yoyPct: number | null = null
        if (papersPrior30d > 0) {
          yoyPct = parseFloat((((papers30d - papersPrior30d) / papersPrior30d) * 100).toFixed(2))
        }

        // Top paper is the most recently published paper
        const sorted = papers.slice().sort((a, b) => b.publishedDate.getTime() - a.publishedDate.getTime())
        const top = sorted[0] || null

        const snap: ArxivSnapshotInfo = {
          companyId: entry.companyId,
          snapshotDate,
          papers30d,
          papers7d,
          topPaperArxivId: top ? top.arxivId : null,
          topPaperTitle: top ? top.title : null,
          yoyPct
        }

        return { companyId: entry.companyId, snap, papers }
      })
    )

    out.push(...batchRes)
    if (i + batchSize < entries.length) {
      await sleep(3000) // Sleep 3s to respect rate-limiting
    }
  }

  return out
}

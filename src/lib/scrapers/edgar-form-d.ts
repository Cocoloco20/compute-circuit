/**
 * Discover portfolio companies via SEC EDGAR Form D full-text search.
 *
 * Why Form D, not VC websites:
 *   * VC marketing pages are JS-rendered, change layouts frequently, and
 *     deliberately hide stealth investments.
 *   * Every private company that does a US-securities-exempt fundraising
 *     round files a Form D with the SEC, which lists related persons /
 *     investors. That's a SEC-verified, machine-readable source of truth.
 *
 * EDGAR full-text search endpoint:
 *   https://efts.sec.gov/LATEST/search-index?q=<term>&forms=D&hits=100
 *
 * Hits include filings where the term appears anywhere in the document.
 * The issuer of each filing is the company that raised money — that's what
 * we want. We filter out filings where the issuer itself looks like the VC
 * (their own fund vehicles file Form Ds too).
 */

const UA = 'compute-circuit (research tool) luigui.h2002@gmail.com'
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export interface DiscoveredCompany {
  /** Issuer name as it appears on the Form D (sanitized). */
  name: string
  /** SEC CIK of the issuer — globally unique stable id. */
  cik: string
  /** Source filing for traceability (accession number). */
  accession: string
  /** Filing date, ISO. */
  date: string
  /** Which VC's Form-D search surfaced this. */
  via: string
}

interface EdgarHit {
  _source?: {
    ciks?: string[]
    display_names?: string[]
    file_date?: string
    adsh?: string
    root_forms?: string[]
  }
}

/**
 * Search Form D filings mentioning `term` (typically a VC firm name) and
 * return one row per unique issuer.
 */
export async function discoverViaFormD(opts: {
  term: string
  via: string
  hitsCap?: number
}): Promise<DiscoveredCompany[]> {
  const cap = opts.hitsCap ?? 100
  const url = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(
    `"${opts.term}"`,
  )}&forms=D&hits=${cap}`
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  })
  if (!r.ok) throw new Error(`EDGAR FTS ${r.status} for "${opts.term}"`)
  const data = (await r.json()) as { hits?: { hits?: EdgarHit[] } }
  const hits = data.hits?.hits ?? []

  // Dedup by CIK — same issuer often files multiple Form Ds.
  const byCik = new Map<string, DiscoveredCompany>()
  const termLower = opts.term.toLowerCase()
  for (const hit of hits) {
    const src = hit._source ?? {}
    const cik = src.ciks?.[0]
    if (!cik) continue
    const rawName = src.display_names?.[0] ?? ''
    // Strip "(CIK 0001234567)" suffix that EDGAR appends.
    const name = rawName.replace(/\s*\(CIK[^)]*\)\s*$/, '').trim()
    if (!name) continue
    // Skip the VC's OWN fund vehicles — they file Form Ds for the LP itself.
    // Heuristic: issuer name contains the VC's name.
    if (name.toLowerCase().includes(termLower)) continue
    if (byCik.has(cik)) continue
    byCik.set(cik, {
      name,
      cik,
      accession: src.adsh ?? '',
      date: src.file_date ?? '',
      via: opts.via,
    })
  }
  return Array.from(byCik.values())
}

/** Drive Form-D discovery sequentially across N VCs with SEC-friendly spacing. */
export async function discoverAcrossInvestors(
  configs: Array<{ id: string; term: string }>,
): Promise<DiscoveredCompany[]> {
  const all: DiscoveredCompany[] = []
  for (const c of configs) {
    try {
      const rows = await discoverViaFormD({ term: c.term, via: c.id })
      all.push(...rows)
    } catch (err) {
      console.error(`[scraper] ${c.id} failed:`, err instanceof Error ? err.message : err)
    }
    await sleep(200) // ~5 req/sec — well under SEC's 10/sec ceiling
  }
  return all
}

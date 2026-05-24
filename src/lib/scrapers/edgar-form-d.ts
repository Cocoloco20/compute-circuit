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
  const firstWordUpper = opts.term.split(/\s+/)[0]?.toUpperCase() ?? ''
  for (const hit of hits) {
    const src = hit._source ?? {}
    const cik = src.ciks?.[0]
    if (!cik) continue
    const rawName = src.display_names?.[0] ?? ''
    // Strip "(CIK 0001234567)" suffix that EDGAR appends.
    const name = rawName.replace(/\s*\(CIK[^)]*\)\s*$/, '').trim()
    if (!name) continue
    if (isLikelyVcShell(name, termLower, firstWordUpper)) continue
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

/**
 * Heuristic SPV / fund-vehicle filter.
 *
 * Catches the noise patterns observed in 2026-05 backfill:
 *   - "Coatue CT 100 LLC"  (Coatue per-investment SPVs)
 *   - "Coatue Asia Fund LP", "Coatue Climate Tech Fund II LP"
 *   - "Claremount IV/V/VI/VII Associates L.P." (Thrive's fund family)
 *   - "North River Angel Investments IX LP" (Thrive angel vehicle)
 *   - "Lindenwood Ltd" (Greenoaks fund — won't catch w/o context, but rare)
 *   - "Spark Capital Founders Fund III LP" etc. (Founders Fund-named co-invest vehicles)
 *
 * Rules:
 *  1) Issuer name contains the VC's search term (lowercase substring) → already-VC's-own.
 *  2) Issuer name's first word equals the VC's first word — catches "Coatue *", "Thrive *".
 *  3) Common shell patterns: ".. Fund (II|III|...) L.P.", ".. SPV ..", ".. Holdings LLC",
 *     ".. Feeder Fund ..", "* CT \\d+ LLC", "* Associates L.P.".
 */
function isLikelyVcShell(issuerName: string, vcTermLower: string, vcFirstWordUpper: string): boolean {
  const lc = issuerName.toLowerCase()
  if (lc.includes(vcTermLower)) return true
  if (vcFirstWordUpper) {
    const firstWord = issuerName.toUpperCase().split(/\s+/)[0] ?? ''
    if (firstWord === vcFirstWordUpper) return true
  }
  // Common fund-vehicle suffix patterns
  if (/\b(Fund|Feeder|SPV|Onshore|Offshore|Holdings|Holdco|Associates|Partners)\b.*\b(L\.?P\.?|LLC|Ltd)\b/i.test(issuerName)) return true
  if (/\bCT[\s-]?(\d+|[IVXLC]+)\b/i.test(issuerName)) return true // "CT 100", "CT XXI"
  return false
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

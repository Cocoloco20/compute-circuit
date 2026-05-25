/**
 * USPTO Open Data Portal (ODP) Patent File Wrapper client.
 *
 * Replaces the old PatentsView API (api.patentsview.org), which was deprecated
 * March 2026 and migrated into ODP. Endpoint shape verified from the official
 * connector reference + the patent-dev/uspto-odp Go client (auto-generated from
 * USPTO's swagger.yaml).
 *
 *   Base URL: https://api.uspto.gov/api/v1
 *   Search:   GET /patent/applications/search?q=...&filters=...&limit=...
 *   Auth:     X-API-KEY header (case-insensitive; ODP accepts x-api-key too)
 *
 * Free, but requires an API key obtained from https://data.uspto.gov/myodp
 * (ID.me identity verification → linked USPTO account → key on My ODP page).
 * Set USPTO_API_KEY in env. Rate limit per ODP docs: ~100 requests / 60s.
 *
 * Query syntax follows the ODP Simplified Query Spec
 * (https://data.uspto.gov/documents/documents/ODP-API-Query-Spec.pdf):
 *   - Boolean: AND, OR, NOT
 *   - Wildcards: *
 *   - Exact phrase: "quoted string"
 *   - Field qualifier: fieldPath:value
 *   - Range filter: rangeFilters=filingDate 2024-05-25:2025-05-25
 *
 * For assignee/applicant search we hit firstApplicantName, which is the
 * indexed top-level field on applicationMetaData — applicantBag.applicantNameText
 * also works but firstApplicantName is faster and is the field the search
 * relevance ranker uses. We also OR in inventionTitle as a fallback for the
 * handful of cos (Cerebras, Groq) whose published apps may credit an
 * inventor-individual rather than the corp on early filings.
 *
 * Response shape (PatentDataResponse):
 *   {
 *     count: number,
 *     patentFileWrapperDataBag: [{
 *       applicationNumberText: string,           // e.g. "18/123,456"
 *       applicationMetaData: {
 *         inventionTitle: string,
 *         filingDate: string,                    // "YYYY-MM-DD"
 *         firstApplicantName: string,
 *         firstInventorName: string,
 *         applicantBag: [{ applicantNameText, ... }],
 *         inventorBag:  [{ inventorNameText, firstName, lastName, ... }],
 *         cpcClassificationBag: string[],        // ["G06N3/04", "G06F9/30", ...]
 *         ...
 *       }
 *     }, ...],
 *     requestIdentifier: string
 *   }
 */

export interface PatentRecord {
  applicationNumber: string
  title: string
  filingDate: string       // YYYY-MM-DD
  cpcCodes: string[]       // e.g. ['G06N3/04', 'G06F9/30']
  inventors: string[]
}

export interface PatentSnapshot {
  assignee: string
  ttmCount: number
  topCpcSubclasses: Array<{ code: string; count: number }> // top 3 by 4-char subclass (e.g. 'G06N')
  recentTitles: Array<{ title: string; filingDate: string }> // top 3, most recent first
}

const BASE = 'https://api.uspto.gov/api/v1'
const UA = 'compute-circuit (research tool) luigui.h2002@gmail.com'

// PatentDataResponse — minimal shape we read. Everything optional because USPTO
// applications routinely omit fields on still-pending filings.
interface OdpApplicant {
  applicantNameText?: string
}
interface OdpInventor {
  inventorNameText?: string
  firstName?: string
  lastName?: string
}
interface OdpApplicationMetaData {
  inventionTitle?: string
  filingDate?: string
  firstApplicantName?: string
  firstInventorName?: string
  applicantBag?: OdpApplicant[]
  inventorBag?: OdpInventor[]
  cpcClassificationBag?: string[]
}
interface OdpRecord {
  applicationNumberText?: string
  applicationMetaData?: OdpApplicationMetaData
}
interface OdpSearchResponse {
  count?: number
  patentFileWrapperDataBag?: OdpRecord[]
  // Some endpoint variants flatten the payload as `response: [...]` instead;
  // we accept either to be defensive.
  response?: Array<{
    applicationNumberText?: string
    filingDate?: string
    inventionTitle?: string
    inventorName?: string
    assigneeName?: string
    cpcClassificationBag?: string[]
  }>
  totalCount?: number
}

function ttmStartDate(): string {
  const d = new Date()
  d.setUTCFullYear(d.getUTCFullYear() - 1)
  return d.toISOString().slice(0, 10)
}
function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Extract the 4-char CPC subclass (e.g. 'G06N3/04' → 'G06N'). */
function cpcSubclass(code: string): string | null {
  // CPC format: <section><class><subclass> [+ group] e.g. G06N 3/04
  // Subclass is the first 4 chars. Defensive: must start with a letter.
  if (!code || typeof code !== 'string') return null
  const trimmed = code.trim().toUpperCase()
  if (trimmed.length < 4) return null
  if (!/^[A-Z]\d{2}[A-Z]/.test(trimmed)) return null
  return trimmed.slice(0, 4)
}

function normalizeRecord(r: OdpRecord): PatentRecord | null {
  const meta = r.applicationMetaData
  if (!meta) return null
  const title = (meta.inventionTitle ?? '').trim()
  const filingDate = (meta.filingDate ?? '').slice(0, 10)
  const applicationNumber = (r.applicationNumberText ?? '').trim()
  if (!applicationNumber || !filingDate) return null

  const cpcCodes = Array.isArray(meta.cpcClassificationBag)
    ? meta.cpcClassificationBag.filter((c): c is string => typeof c === 'string')
    : []

  const inventors = Array.isArray(meta.inventorBag)
    ? meta.inventorBag
        .map(i => i.inventorNameText
          ?? [i.firstName, i.lastName].filter(Boolean).join(' ')
          ?? '')
        .filter(Boolean)
    : []
  if (inventors.length === 0 && meta.firstInventorName) inventors.push(meta.firstInventorName)

  return {
    applicationNumber,
    title: title || '(untitled)',
    filingDate,
    cpcCodes,
    inventors,
  }
}

interface FetchOpts {
  apiKey?: string         // defaults to process.env.USPTO_API_KEY
  limit?: number          // max records to pull (default 200; ODP per-call cap is 100)
  signal?: AbortSignal
}

/**
 * Fetch up to `limit` recent applications for an assignee. Paginates in
 * 100-record pages (ODP per-call max) and stops when either we hit `limit`
 * or the API stops returning records.
 *
 * Returns null on auth or transport failure so callers can decide whether
 * to skip (cron) or surface the error (UI).
 */
async function fetchApplicationsOnce(name: string, opts: FetchOpts = {}): Promise<OdpRecord[] | null> {
  const apiKey = opts.apiKey ?? process.env.USPTO_API_KEY
  if (!apiKey) {
    // eslint-disable-next-line no-console
    console.warn('[uspto] USPTO_API_KEY not set — skipping fetch for', name)
    return null
  }
  const limit = opts.limit ?? 200
  // 25/page = ~6KB/page, well under USPTO's per-response payload cap. Larger
  // pages (100) returned HTTP 413 for high-volume assignees like Google LLC
  // (678 TTM) and Qualcomm (1824 TTM). Smaller pages are slower but bulletproof.
  const pageSize = 25
  const since = ttmStartDate()
  const today = todayIso()

  // Use only firstApplicantName (the indexed top-level field). The earlier OR
  // fallback to applicantBag.applicantNameText doubled the hit count, which
  // pushed high-volume cos like Google/Qualcomm past USPTO's response-size
  // limit and triggered HTTP 413. Big corps file under their corp name —
  // they don't need the fallback path.
  const q = `applicationMetaData.firstApplicantName:"${name}"`
  // Range-filter on filing date so TTM count is computed server-side, not
  // by post-filtering a giant set. `rangeFilters` syntax is `<field> <from>:<to>`.
  const rangeFilters = `applicationMetaData.filingDate ${since}:${today}`

  const all: OdpRecord[] = []
  for (let offset = 0; offset < limit; offset += pageSize) {
    const params = new URLSearchParams({
      q,
      rangeFilters,
      sort: 'applicationMetaData.filingDate desc',
      offset: String(offset),
      limit: String(Math.min(pageSize, limit - offset)),
    })
    const url = `${BASE}/patent/applications/search?${params.toString()}`
    let resp: Response
    try {
      resp = await fetch(url, {
        method: 'GET',
        headers: {
          'X-API-KEY': apiKey,
          Accept: 'application/json',
          'User-Agent': UA,
        },
        signal: opts.signal,
      })
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[uspto] fetch error for', name, err)
      return null
    }
    if (resp.status === 401 || resp.status === 403) {
      // eslint-disable-next-line no-console
      console.warn(`[uspto] auth failed (${resp.status}) for`, name, '— check USPTO_API_KEY')
      return null
    }
    if (resp.status === 429) {
      // eslint-disable-next-line no-console
      console.warn('[uspto] rate-limited for', name, '— returning partial results')
      break
    }
    if (!resp.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[uspto] HTTP ${resp.status} for`, name)
      return null
    }
    let body: OdpSearchResponse
    try {
      body = (await resp.json()) as OdpSearchResponse
    } catch {
      return null
    }
    const bag = body.patentFileWrapperDataBag
      ?? (body.response ?? []).map((r) => ({
        applicationNumberText: r.applicationNumberText,
        applicationMetaData: {
          inventionTitle: r.inventionTitle,
          filingDate: r.filingDate,
          firstApplicantName: r.assigneeName,
          firstInventorName: r.inventorName,
          cpcClassificationBag: r.cpcClassificationBag,
        },
      }))
    if (!Array.isArray(bag) || bag.length === 0) break
    all.push(...bag)
    if (bag.length < pageSize) break
  }
  return all
}

/**
 * Wraps fetchApplicationsOnce with one retry on transient failure.
 *
 * USPTO returns intermittent timeouts/500s when hit from Vercel egress IPs,
 * especially for high-volume assignees (Microsoft Technology Licensing, Avago
 * Technologies). A simple retry-after-2s recovers most of these.
 */
async function fetchApplications(name: string, opts: FetchOpts = {}): Promise<OdpRecord[] | null> {
  const first = await fetchApplicationsOnce(name, opts)
  if (first !== null) return first
  // 2s backoff then one more attempt
  await new Promise(r => setTimeout(r, 2000))
  return fetchApplicationsOnce(name, opts)
}

export async function fetchPatentsForAssignee(name: string): Promise<PatentSnapshot | null> {
  const raw = await fetchApplications(name)
  if (raw === null) return null

  const recs = raw.map(normalizeRecord).filter((r): r is PatentRecord => r !== null)

  // CPC subclass aggregation: each record contributes once per distinct subclass.
  // A patent with both G06N3/04 and G06N3/08 counts G06N once, not twice — we
  // want "how many patents touch G06N", not "how many CPC codes are in G06N".
  const subclassCounts = new Map<string, number>()
  for (const r of recs) {
    const distinct = new Set<string>()
    for (const code of r.cpcCodes) {
      const sub = cpcSubclass(code)
      if (sub) distinct.add(sub)
    }
    for (const sub of distinct) {
      subclassCounts.set(sub, (subclassCounts.get(sub) ?? 0) + 1)
    }
  }
  const topCpcSubclasses = Array.from(subclassCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([code, count]) => ({ code, count }))

  // Recent titles: already sorted desc by filingDate from the API but resort
  // defensively in case the OR query mixed ordering across pages.
  const recentTitles = recs
    .slice()
    .sort((a, b) => (a.filingDate < b.filingDate ? 1 : a.filingDate > b.filingDate ? -1 : 0))
    .slice(0, 3)
    .map(r => ({ title: r.title, filingDate: r.filingDate }))

  return {
    assignee: name,
    ttmCount: recs.length,
    topCpcSubclasses,
    recentTitles,
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Fetch snapshots for many assignees sequentially with the 200ms ODP-friendly
 * sleep between calls (well under the ~100 req/min cap, leaves headroom for
 * pagination inside each company).
 */
export async function fetchAllPatentSnapshots(
  assignees: Array<{ companyId: string; name: string }>
): Promise<Array<{ companyId: string; snap: PatentSnapshot | null }>> {
  const out: Array<{ companyId: string; snap: PatentSnapshot | null }> = []
  for (const a of assignees) {
    const snap = await fetchPatentsForAssignee(a.name)
    out.push({ companyId: a.companyId, snap })
    await sleep(200)
  }
  return out
}

// CPC subclass labels for the AI-compute domain. Kept here (not in the cron)
// so the drawer can format `G06N` → 'ML' without round-tripping through SQL.
//
// Expanded after observing real cron output — added H10B (3D memory) for
// Micron, C23C (vapor deposition) for AMAT, etc.
export const CPC_SUBCLASS_LABELS: Record<string, string> = {
  // Computation / AI
  G06N: 'ML',
  G06F: 'Compute arch',
  G06T: 'Image proc',
  G06V: 'Image recognition',
  G06Q: 'Business methods',

  // Memory + storage
  G11C: 'Memory',          // SRAM/DRAM/NAND patents — Micron, KLA, AMAT
  H10B: '3D memory',       // newer CPC for 3D NAND / HBM stacks — Micron, SK Hynix

  // Networking
  H04L: 'Networking',      // Broadcom, Marvell, NVIDIA NIC patents
  H04W: 'Wireless',        // Qualcomm modems
  H04N: 'Video coding',    // Qualcomm, Sony video codecs

  // Fab / chip physical
  H01L: 'Chip fab',        // Intel, AMAT, TSMC physical structure
  H10D: 'Semi devices',    // newer CPC for transistors / diodes
  H01J: 'Electron beam',   // ASML EUV source, KLA inspection
  H01Q: 'Antennas',
  H10K: 'Organic semis',   // OLED, organic transistors

  // Lithography / equipment
  G03F: 'Photolithography',// ASML mask/exposure
  G02B: 'Optics',          // ASML, TSM lithography optics
  G02F: 'Optical switches',
  C23C: 'Vapor deposition',// AMAT, Lam CVD/PVD tools
  C30B: 'Crystal growth',  // SiC/GaN substrate growth — Wolfspeed, Coherent

  // Power / energy storage
  H02J: 'Power systems',   // VRT, ETN power distribution
  H02M: 'Power conversion',// GaN/SiC drivers — Navitas, Wolfspeed
  H01M: 'Batteries',
}

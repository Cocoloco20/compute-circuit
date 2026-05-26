/**
 * Thin SEC EDGAR client.
 *
 * Two endpoints we care about:
 *   1) /files/company_tickers.json — canonical ticker→CIK map. ~10k rows.
 *      Used once by the CIK backfill script.
 *   2) /submissions/CIK{padded}.json — recent filings for one company.
 *      Used by the cron, polled once per CIKed company per day.
 *
 * SEC compliance:
 *   - User-Agent MUST include contact info (email). Plain "Mozilla/5.0" gets
 *     you a 403 within a few requests.
 *   - Rate limit: 10 req/sec. We sleep 150ms between calls (≈6 req/sec) to
 *     stay comfortably under.
 *   - All endpoints respond with permissive CORS, so server-side fetch works
 *     without a proxy.
 */

const UA = 'compute-circuit (research tool) luigui.h2002@gmail.com'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function pad10(cik: string | number): string {
  return String(cik).padStart(10, '0')
}

// ---------- ticker → CIK mapping ----------

export interface TickerCikRow {
  cik_str: number
  ticker: string
  title: string
}

export async function fetchTickerCikMap(): Promise<Map<string, TickerCikRow>> {
  const r = await fetch('https://www.sec.gov/files/company_tickers.json', {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  })
  if (!r.ok) throw new Error(`company_tickers.json HTTP ${r.status}`)
  // Returned shape: { "0": { cik_str, ticker, title }, "1": {...}, ... }
  const raw = (await r.json()) as Record<string, TickerCikRow>
  const map = new Map<string, TickerCikRow>()
  for (const row of Object.values(raw)) {
    map.set(row.ticker.toUpperCase(), row)
  }
  return map
}

// ---------- per-company filings ----------

export interface EdgarFiling {
  accessionNumber: string
  filingDate: string         // YYYY-MM-DD
  reportDate: string | null  // event date — often the *real* date for 8-K
  form: string               // '8-K' | '10-Q' | ...
  primaryDocument: string
  primaryDocDescription: string
  items: string              // '1.01,2.02,9.01' for 8-Ks; empty otherwise
}

export interface CompanySubmissions {
  cik: string
  name: string
  filings: EdgarFiling[]
}

export async function fetchCompanyFilings(cik: string): Promise<CompanySubmissions> {
  const padded = pad10(cik)
  const r = await fetch(`https://data.sec.gov/submissions/CIK${padded}.json`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  })
  if (!r.ok) throw new Error(`submissions CIK${padded} HTTP ${r.status}`)
  const data = (await r.json()) as {
    name?: string
    filings?: { recent?: Record<string, (string | null)[]> }
  }
  const recent = data.filings?.recent ?? {}
  const accs = (recent.accessionNumber ?? []) as string[]
  const filings: EdgarFiling[] = accs.map((acc, i) => ({
    accessionNumber: acc,
    filingDate: (recent.filingDate?.[i] ?? '') as string,
    reportDate: (recent.reportDate?.[i] as string) || null,
    form: (recent.form?.[i] ?? '') as string,
    primaryDocument: (recent.primaryDocument?.[i] ?? '') as string,
    primaryDocDescription: (recent.primaryDocDescription?.[i] ?? '') as string,
    items: (recent.items?.[i] ?? '') as string,
  }))
  return { cik: padded, name: data.name ?? '', filings }
}

/** Drive fetchCompanyFilings across many CIKs sequentially with rate-limit-friendly spacing. */
export async function fetchAllCompanyFilings(ciks: string[]): Promise<CompanySubmissions[]> {
  const out: CompanySubmissions[] = []
  for (const cik of ciks) {
    try {
      out.push(await fetchCompanyFilings(cik))
    } catch (err) {
      console.error(`[edgar] CIK ${cik} failed:`, err instanceof Error ? err.message : err)
    }
    await sleep(150) // ~6 req/sec, well under SEC's 10/sec ceiling
  }
  return out
}

// ---------- 8-K helpers ----------

// Map common 8-K item codes to a short human label. The list is intentionally
// short — we want a glanceable headline, not encyclopedia coverage. Anything
// unmapped falls through to its raw code.
const ITEM_LABELS: Record<string, string> = {
  '1.01': 'Material agreement',
  '1.02': 'Agreement terminated',
  '2.01': 'Acquisition/disposition',
  '2.02': 'Earnings results',
  '2.03': 'Debt obligation',
  '2.04': 'Triggering event',
  '2.05': 'Costs / restructuring',
  '3.02': 'Unregistered equity sale',
  '5.02': 'Officer / director change',
  '5.07': 'Vote of security holders',
  '7.01': 'Reg FD disclosure',
  '8.01': 'Other event',
  '9.01': 'Financial statements / exhibits',
}

/** Build a glanceable headline from a filing's item codes + company name. */
export function headlineFor8K(companyName: string, items: string): string {
  if (!items.trim()) return `${companyName} 8-K filed`
  const codes = items.split(/[,\s]+/).filter(Boolean)
  const labels = codes
    .map((c) => ITEM_LABELS[c])
    .filter(Boolean)
    .filter((l, i, a) => a.indexOf(l) === i) // de-dupe (e.g. multiple sub-items of same topic)
  if (labels.length === 0) return `${companyName} 8-K — items ${codes.join(', ')}`
  return `${companyName} 8-K — ${labels.join(' · ')}`
}

/** URL of the filing index page (cleaner than linking the raw primaryDocument). */
export function filingIndexUrl(cik: string, accession: string): string {
  const cikInt = parseInt(cik, 10) // strip leading zeros for the URL path
  const accNoDashes = accession.replace(/-/g, '')
  return `https://www.sec.gov/Archives/edgar/data/${cikInt}/${accNoDashes}/`
}

// ---------- 13F holdings ----------

import { XMLParser } from 'fast-xml-parser'

export interface ParsedHolding {
  cusip: string
  nameOfIssuer: string
  titleOfClass: string | null
  shares: number | null
  valueUsd: number | null   // converted from $1000s
}

/**
 * Find the most-recent 13F-HR for a CIK. Returns null if none on record
 * (e.g. the filer hasn't crossed the $100M AUM threshold).
 */
export function findLatest13F(filings: EdgarFiling[]): EdgarFiling | null {
  return filings.find(f => f.form === '13F-HR') ?? null
}

/**
 * Locate the INFORMATION TABLE xml file inside a 13F filing folder.
 * Different filers use different naming conventions, but the SEC's filing
 * index always lists files; we filter to ones whose name looks like the
 * holdings table.
 */
export async function fetchInformationTableUrl(cik: string, accession: string): Promise<string | null> {
  const cikInt = parseInt(cik, 10)
  const accNoDashes = accession.replace(/-/g, '')
  const indexUrl = `https://www.sec.gov/Archives/edgar/data/${cikInt}/${accNoDashes}/index.json`
  const r = await fetch(indexUrl, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
  if (!r.ok) return null
  const data = (await r.json()) as { directory?: { item?: Array<{ name: string; type?: string }> } }
  const items = data.directory?.item ?? []
  // Prefer items explicitly typed "INFORMATION TABLE"; fall back to filename heuristic.
  const byType = items.find(i => (i.type ?? '').toUpperCase() === 'INFORMATION TABLE')
  const byName = items.find(i => /info(rmation)?[_-]?table.*\.xml$/i.test(i.name))
  const pick = byType ?? byName
  if (!pick) return null
  return `https://www.sec.gov/Archives/edgar/data/${cikInt}/${accNoDashes}/${pick.name}`
}

/**
 * Parse the SEC 13F INFORMATION TABLE XML.
 * The schema is rigid but uses different namespace prefixes per filer
 * (ns1:, n1:, none) — fast-xml-parser's removeNSPrefix handles that.
 */
export function parseInformationTable(xml: string): ParsedHolding[] {
  const parser = new XMLParser({
    ignoreAttributes: true,
    removeNSPrefix: true,
    parseTagValue: false, // keep everything as string; we'll cast deliberately
  })
  const parsed = parser.parse(xml) as { informationTable?: { infoTable?: unknown } }
  const it = parsed.informationTable?.infoTable
  if (!it) return []
  const rows = Array.isArray(it) ? it : [it]
  const out: ParsedHolding[] = []
  for (const row of rows as Array<Record<string, unknown>>) {
    const cusip = String(row.cusip ?? '').trim()
    if (!cusip) continue
    // Per the SEC 2022 amendment (effective Jan 2023), `value` is reported
    // in WHOLE DOLLARS. Older filings used $1000s, but we don't backfill
    // pre-2023 13Fs, so no conversion needed.
    const value = Number(row.value ?? 0)
    const shareInfo = row.shrsOrPrnAmt as Record<string, unknown> | undefined
    const shares = shareInfo ? Number(shareInfo.sshPrnamt ?? 0) : null
    out.push({
      cusip,
      nameOfIssuer: String(row.nameOfIssuer ?? '').trim(),
      titleOfClass: row.titleOfClass ? String(row.titleOfClass) : null,
      shares: Number.isFinite(shares) ? shares : null,
      valueUsd: Number.isFinite(value) ? value : null,
    })
  }
  return out
}

/**
 * High-level: fetch a 13F's full holdings list given the filer CIK + accession.
 * Returns the parsed rows (CUSIP-keyed) plus the reportDate of the filing,
 * which is the quarter-end period for storage.
 */
export async function fetch13FHoldings(cik: string, filing: EdgarFiling): Promise<{ period: string; holdings: ParsedHolding[] }> {
  const xmlUrl = await fetchInformationTableUrl(cik, filing.accessionNumber)
  if (!xmlUrl) return { period: filing.reportDate ?? filing.filingDate, holdings: [] }
  const r = await fetch(xmlUrl, { headers: { 'User-Agent': UA, Accept: 'application/xml' } })
  if (!r.ok) return { period: filing.reportDate ?? filing.filingDate, holdings: [] }
  const xml = await r.text()
  return {
    period: filing.reportDate ?? filing.filingDate,
    holdings: parseInformationTable(xml),
  }
}

// ---------- Form 4 (insider transactions) ----------

export interface ParsedInsiderTx {
  transactionDate: string | null     // YYYY-MM-DD
  reportingOwner: string             // person/entity name
  reportingOwnerRole: string | null  // e.g. "Chief Executive Officer"
  isOfficer: boolean
  isDirector: boolean
  isTenPercentOwner: boolean
  securityTitle: string | null
  shares: number | null
  pricePerShare: number | null
  valueUsd: number | null            // shares * price (always positive; direction in acquiredOrDisposed)
  transactionCode: string | null     // 'S' sale, 'P' purchase, 'M' exempt, 'G' gift, 'F' tax, etc.
  acquiredOrDisposed: string | null  // 'A' or 'D'
}

/** Build the URL for a Form 4 filing's raw XML document.
 *
 * Subtle: submissions.json's primaryDocument field for Form 4 includes the
 * XSL stylesheet folder, e.g. "xslF345X06/wk-form4_1774386816.xml". That
 * path returns the HTML-rendered version (with embedded XSL), not raw XML.
 * We need the bare filename — strip any leading directory.
 *
 * - With prefix → HTTP 200, content-type: text/html (parser gets nothing)
 * - Without prefix → HTTP 200, content-type: text/xml (what we want) */
export function form4PrimaryDocUrl(cik: string, accession: string, primaryDocument: string): string {
  const cikInt = parseInt(cik, 10)
  const accNoDashes = accession.replace(/-/g, '')
  const bareFilename = primaryDocument.split('/').pop() ?? primaryDocument
  return `https://www.sec.gov/Archives/edgar/data/${cikInt}/${accNoDashes}/${bareFilename}`
}

/**
 * Parse a Form 4 / Form 4/A ownership XML document into ParsedInsiderTx rows.
 * Handles single transaction and multi-transaction filings.
 *
 * Schema highlights:
 *   <ownershipDocument>
 *     <reportingOwner>
 *       <reportingOwnerId><rptOwnerName>...</rptOwnerName></reportingOwnerId>
 *       <reportingOwnerRelationship>
 *         <isOfficer>1</isOfficer>
 *         <officerTitle>Chief Executive Officer</officerTitle>
 *         <isDirector>1</isDirector>
 *         <isTenPercentOwner>0</isTenPercentOwner>
 *       </reportingOwnerRelationship>
 *     </reportingOwner>
 *     <nonDerivativeTable>
 *       <nonDerivativeTransaction>
 *         <transactionDate><value>2026-05-15</value></transactionDate>
 *         <securityTitle><value>Common Stock</value></securityTitle>
 *         <transactionAmounts>
 *           <transactionShares><value>5000</value>
 *           <transactionPricePerShare><value>215.33</value>
 *           <transactionAcquiredDisposedCode><value>D</value>
 *         <transactionCoding>
 *           <transactionCode>S</transactionCode>    <!-- no <value> wrapper here -->
 */
export function parseForm4(xml: string): ParsedInsiderTx[] {
  const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, parseTagValue: false })
  const root = parser.parse(xml) as { ownershipDocument?: Record<string, unknown> }
  const doc = root.ownershipDocument
  if (!doc) return []

  // Owner can be single object or array (multiple reporting owners). Take the first
  // (most filings have one; for joint filings we just attribute to the primary).
  const ownerRaw = doc.reportingOwner
  const owner = Array.isArray(ownerRaw) ? ownerRaw[0] : ownerRaw
  if (!owner || typeof owner !== 'object') return []

  const ownerId = (owner as Record<string, unknown>).reportingOwnerId as Record<string, unknown> | undefined
  const reportingOwner = String(ownerId?.rptOwnerName ?? '').trim()

  const rel = (owner as Record<string, unknown>).reportingOwnerRelationship as Record<string, unknown> | undefined
  const isOfficer = String(rel?.isOfficer ?? '0').trim() === '1' || rel?.isOfficer === 1 || rel?.isOfficer === true
  const isDirector = String(rel?.isDirector ?? '0').trim() === '1' || rel?.isDirector === 1 || rel?.isDirector === true
  const isTenPercentOwner = String(rel?.isTenPercentOwner ?? '0').trim() === '1' || rel?.isTenPercentOwner === 1
  const reportingOwnerRole = (rel?.officerTitle != null ? String(rel.officerTitle).trim() :
                              isDirector ? 'Director' :
                              isTenPercentOwner ? '10% Owner' :
                              isOfficer ? 'Officer' : null) || null

  // nonDerivativeTable.nonDerivativeTransaction can be missing, single, or array.
  const ndt = doc.nonDerivativeTable as Record<string, unknown> | undefined
  const txnRaw = ndt?.nonDerivativeTransaction
  if (!txnRaw) return []
  const txns = Array.isArray(txnRaw) ? txnRaw : [txnRaw]

  const out: ParsedInsiderTx[] = []
  for (const t of txns as Array<Record<string, unknown>>) {
    const transactionDate = unwrapValue(t.transactionDate)
    const securityTitle = unwrapValue(t.securityTitle)

    const amounts = t.transactionAmounts as Record<string, unknown> | undefined
    const sharesStr = unwrapValue(amounts?.transactionShares)
    const priceStr = unwrapValue(amounts?.transactionPricePerShare)
    const adCode = unwrapValue(amounts?.transactionAcquiredDisposedCode)

    const coding = t.transactionCoding as Record<string, unknown> | undefined
    // transactionCoding.transactionCode comes through as a raw string (no <value> wrapper)
    const codeRaw = coding?.transactionCode
    const transactionCode = codeRaw != null ? String(codeRaw).trim() : null

    const shares = sharesStr != null ? Number(sharesStr) : null
    const price = priceStr != null ? Number(priceStr) : null
    const valueUsd = shares != null && price != null && Number.isFinite(shares) && Number.isFinite(price)
      ? shares * price
      : null

    out.push({
      transactionDate,
      reportingOwner,
      reportingOwnerRole,
      isOfficer, isDirector, isTenPercentOwner,
      securityTitle,
      shares: Number.isFinite(shares as number) ? (shares as number) : null,
      pricePerShare: Number.isFinite(price as number) ? (price as number) : null,
      valueUsd,
      transactionCode,
      acquiredOrDisposed: adCode,
    })
  }
  return out
}

// Helper for the <wrapper><value>x</value></wrapper> pattern XBRL uses.
function unwrapValue(node: unknown): string | null {
  if (node == null) return null
  if (typeof node === 'string' || typeof node === 'number') return String(node).trim() || null
  if (typeof node === 'object' && 'value' in (node as Record<string, unknown>)) {
    const v = (node as Record<string, unknown>).value
    if (v == null) return null
    return String(v).trim() || null
  }
  return null
}

/** Pull a single Form 4 XML + parse it. */
export async function fetchForm4(cik: string, accession: string, primaryDocument: string): Promise<ParsedInsiderTx[]> {
  const url = form4PrimaryDocUrl(cik, accession, primaryDocument)
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/xml' } })
    if (!r.ok) return []
    const xml = await r.text()
    return parseForm4(xml)
  } catch {
    return []
  }
}

// ---------- Form D (private-co fundraising) ----------

export interface FundingRoundData {
  accession: string
  filedDate: string                       // YYYY-MM-DD
  totalAmountSoldUsd: number | null       // null when "Indefinite" or absent
  totalOfferingAmountUsd: number | null
  totalAmountRemainingUsd: number | null
  hasAmountIndefinite: boolean            // any of the three amount fields was the literal "Indefinite"
  investorsNamed: string[]                // related-person names
  sourceUrl: string
}

/** Build the primary_doc.xml URL for a Form D filing.
 *
 * Form D filings always name the primary document "primary_doc.xml" — no
 * XSL-prefix gymnastics needed (unlike Form 4). Both D and D/A use the
 * same filename. */
export function formDPrimaryDocUrl(cik: string, accession: string): string {
  const cikInt = parseInt(cik, 10)
  const accNoDashes = accession.replace(/-/g, '')
  return `https://www.sec.gov/Archives/edgar/data/${cikInt}/${accNoDashes}/primary_doc.xml`
}

/**
 * Parse a Form D primary_doc.xml document (X0708 schema).
 *
 * Critical nuance: the amount fields can be the literal string "Indefinite"
 * for blank-check / continuous offerings — there is NO separate
 * <isAmountIndefinite> element in the schema. We detect "Indefinite" and
 * set hasAmountIndefinite=true while leaving the numeric value null. The
 * UI can then render "$Xm raised + ongoing" instead of a misleading zero.
 *
 * Schema highlights:
 *   <edgarSubmission>
 *     <relatedPersonsList>
 *       <relatedPersonInfo>
 *         <relatedPersonName><firstName>...</firstName><lastName>...</lastName></relatedPersonName>
 *         <relatedPersonRelationshipList><relationship>Executive Officer</relationship>...
 *       </relatedPersonInfo>
 *       ...
 *     </relatedPersonsList>
 *     <offeringData>
 *       <offeringSalesAmounts>
 *         <totalOfferingAmount>3555000</totalOfferingAmount>      <!-- or "Indefinite" -->
 *         <totalAmountSold>3545000</totalAmountSold>
 *         <totalRemaining>10000</totalRemaining>
 *       </offeringSalesAmounts>
 */
export function parseFormD(xml: string): {
  totalAmountSoldUsd: number | null
  totalOfferingAmountUsd: number | null
  totalAmountRemainingUsd: number | null
  hasAmountIndefinite: boolean
  investorsNamed: string[]
} {
  const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, parseTagValue: false })
  const root = parser.parse(xml) as { edgarSubmission?: Record<string, unknown> }
  const sub = root.edgarSubmission
  if (!sub) {
    return {
      totalAmountSoldUsd: null,
      totalOfferingAmountUsd: null,
      totalAmountRemainingUsd: null,
      hasAmountIndefinite: false,
      investorsNamed: [],
    }
  }

  // ----- offering amounts -----
  const offeringData = sub.offeringData as Record<string, unknown> | undefined
  const salesAmounts = offeringData?.offeringSalesAmounts as Record<string, unknown> | undefined
  const totalOfferingRaw = salesAmounts?.totalOfferingAmount
  const totalSoldRaw = salesAmounts?.totalAmountSold
  const totalRemainingRaw = salesAmounts?.totalRemaining

  const parseAmount = (raw: unknown): { amount: number | null; indefinite: boolean } => {
    if (raw == null) return { amount: null, indefinite: false }
    const s = String(raw).trim()
    if (!s) return { amount: null, indefinite: false }
    if (s.toLowerCase() === 'indefinite') return { amount: null, indefinite: true }
    const n = Number(s)
    return Number.isFinite(n) ? { amount: n, indefinite: false } : { amount: null, indefinite: false }
  }

  const offering = parseAmount(totalOfferingRaw)
  const sold = parseAmount(totalSoldRaw)
  const remaining = parseAmount(totalRemainingRaw)
  const hasAmountIndefinite = offering.indefinite || sold.indefinite || remaining.indefinite

  // ----- related persons -----
  const relList = sub.relatedPersonsList as Record<string, unknown> | undefined
  const relRaw = relList?.relatedPersonInfo
  const relArr = relRaw == null ? [] : Array.isArray(relRaw) ? relRaw : [relRaw]
  const investorsNamed: string[] = []
  for (const r of relArr as Array<Record<string, unknown>>) {
    const nameNode = r.relatedPersonName as Record<string, unknown> | undefined
    if (!nameNode) continue
    const parts = [nameNode.firstName, nameNode.middleName, nameNode.lastName]
      .map(p => (p == null ? '' : String(p).trim()))
      .filter(Boolean)
    const full = parts.join(' ').trim()
    if (full) investorsNamed.push(full)
  }

  return {
    totalAmountSoldUsd: sold.amount,
    totalOfferingAmountUsd: offering.amount,
    totalAmountRemainingUsd: remaining.amount,
    hasAmountIndefinite,
    investorsNamed,
  }
}

/**
 * High-level: pull submissions.json for a CIK, filter to recent (last 90 days)
 * Form D / D/A filings, fetch each primary_doc.xml, and return the parsed
 * offering data per filing.
 *
 * Caller is responsible for rate-limit pacing across many CIKs — this fn
 * just sleeps 150ms between XML fetches inside a single CIK to stay under
 * SEC's 10 req/sec ceiling.
 */
export async function fetchFormDOfferingForCik(
  cik: string,
  opts: { lookbackDays?: number } = {},
): Promise<FundingRoundData[]> {
  const lookbackDays = opts.lookbackDays ?? 90
  const cutoff = new Date(Date.now() - lookbackDays * 86400_000).toISOString().slice(0, 10)

  let subs: CompanySubmissions
  try {
    subs = await fetchCompanyFilings(cik)
  } catch {
    return []
  }
  const recentFormDs = subs.filings.filter(f =>
    (f.form === 'D' || f.form === 'D/A') && f.filingDate >= cutoff,
  )

  const out: FundingRoundData[] = []
  for (const f of recentFormDs) {
    const url = formDPrimaryDocUrl(cik, f.accessionNumber)
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/xml' } })
      if (!r.ok) {
        await sleep(150)
        continue
      }
      const xml = await r.text()
      const parsed = parseFormD(xml)
      out.push({
        accession: f.accessionNumber,
        filedDate: f.filingDate,
        ...parsed,
        sourceUrl: filingIndexUrl(cik, f.accessionNumber),
      })
    } catch {
      // skip — partial result is still useful
    }
    await sleep(150)
  }
  return out
}

// ---------- 8-K earnings-release fetcher ----------

/**
 * Filter a company's filings to 8-Ks with item 2.02 ("Results of Operations").
 *
 * Those are the earnings filings — the press release attached as exhibit
 * 99.1 (and sometimes a supplemental slide deck) is the closest thing to
 * an "earnings transcript" we can pull from EDGAR. Real Q&A transcripts
 * live on third-party sites and aren't scrape-friendly.
 *
 * The `items` field on a filing is a comma-or-space-separated list like
 * "2.02,9.01" — we split + trim + match. Returns sorted newest-first
 * (by reportDate fall-back filingDate), capped to `limit`.
 */
export function filterEarningsResults8Ks(filings: EdgarFiling[], limit = 4): EdgarFiling[] {
  const earnings = filings.filter((f) => {
    if (f.form !== '8-K' && f.form !== '8-K/A') return false
    const items = (f.items ?? '').split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
    return items.includes('2.02')
  })
  earnings.sort((a, b) => {
    const da = a.reportDate || a.filingDate
    const db = b.reportDate || b.filingDate
    return db.localeCompare(da)
  })
  return earnings.slice(0, limit)
}

/**
 * Build the URL for an 8-K's primary document (the press release for
 * item-2.02 filings).
 *
 * Like Form 4, the `primaryDocument` field can include a directory prefix
 * (e.g. "xslF345X06/wk-form4...") — we want the bare filename.
 */
export function eightKPrimaryDocUrl(cik: string, accession: string, primaryDocument: string): string {
  const cikInt = parseInt(cik, 10)
  const accNoDashes = accession.replace(/-/g, '')
  const bareFilename = primaryDocument.split('/').pop() ?? primaryDocument
  return `https://www.sec.gov/Archives/edgar/data/${cikInt}/${accNoDashes}/${bareFilename}`
}

/**
 * Fetch an 8-K filing's earnings exhibit and return { url, text }.
 *
 * Resolution is layered because filer templates vary widely — the press
 * release for an 8-K item 2.02 lives in a file whose name we can only
 * pattern-match heuristically:
 *
 *   filer        → naming convention                  matches
 *   ─────────────────────────────────────────────────────────
 *   Vertiv       → vrt-20260211xex991.htm             ✓ contains "ex991"
 *   Microsoft    → msft-ex99_1.htm                    ✓ contains "ex99_1"
 *   Meta         → meta-03312026xexhibit991.htm       ✓ contains "exhibit991"
 *   Amazon       → amzn-20260331xex991.htm            ✓ contains "ex991"
 *   Alphabet     → googexhibit991q12026.htm           ✓ contains "exhibit991"
 *   NVIDIA       → q1fy27pr.htm                       ⨯ no ex99 — uses "pr"
 *
 * The previous "^ex…" anchored regex only caught Vertiv-style names and
 * silently fell back to primaryDocument for the rest. primaryDocument for
 * an 8-K is the COVER PAGE — XBRL boilerplate with no press-release prose —
 * so the lexicon scorer returned all-zero counts and the cron skipped them.
 *
 * Strategy in priority order:
 *   1. Filename matches ex(hibit)?[\s_.-]*99[\s_.-]*1 anywhere
 *   2. Filename matches press-release / earnings-release / *pr.htm (NVDA)
 *   3. Largest non-cover, non-Rxx.htm file > 30 KB (cover docs sit at 25-65 KB
 *      filled with XBRL; press releases for major cos run 200 KB-1 MB).
 *   4. Fall back to primaryDocument as a last resort.
 *
 * Returns null on any error (404, parse failure, oversize) so the caller
 * just continues with the next filing.
 */
export async function fetchEarningsExhibitText(
  cik: string,
  accession: string,
  primaryDocument: string,
): Promise<{ url: string; text: string } | null> {
  const cikInt = parseInt(cik, 10)
  const accNoDashes = accession.replace(/-/g, '')
  const indexUrl = `https://www.sec.gov/Archives/edgar/data/${cikInt}/${accNoDashes}/index.json`
  let exhibitUrl: string | null = null
  try {
    const r = await fetch(indexUrl, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
    if (r.ok) {
      const data = (await r.json()) as { directory?: { item?: Array<{ name: string; size?: string }> } }
      const items = data.directory?.item ?? []
      exhibitUrl = pickEarningsExhibit(items, primaryDocument, cikInt, accNoDashes)
    }
  } catch {
    // index fetch failed — fall through to primaryDocument
  }
  if (!exhibitUrl && primaryDocument) {
    exhibitUrl = eightKPrimaryDocUrl(cik, accession, primaryDocument)
  }
  if (!exhibitUrl) return null
  try {
    const r = await fetch(exhibitUrl, { headers: { 'User-Agent': UA, Accept: 'text/html,text/plain' } })
    if (!r.ok) return null
    const lenHeader = r.headers.get('content-length')
    if (lenHeader && Number(lenHeader) > 2_000_000) return null
    const text = await r.text()
    return { url: exhibitUrl, text }
  } catch {
    return null
  }
}

/**
 * Heuristic exhibit-99.1 picker. Walks the index.json items list and returns
 * an absolute URL to the best candidate, or null if nothing matches.
 *
 * Exposed for testing (scripts/debug-transcripts.ts) — the cron just calls
 * fetchEarningsExhibitText.
 */
export function pickEarningsExhibit(
  items: Array<{ name: string; size?: string }>,
  primaryDocument: string,
  cikInt: number,
  accNoDashes: string,
): string | null {
  const coverName = (primaryDocument.split('/').pop() ?? '').toLowerCase()
  // Eligible files: .htm/.html/.txt, not index-headers, not the auto-generated Rxx.htm
  // XBRL viewer files (they're <table> dumps with no prose).
  const candidates = items.filter((i) => {
    const n = i.name.toLowerCase()
    if (!/\.(htm|html|txt)$/i.test(n)) return false
    if (n.startsWith('0001')) return false                  // accession-named txt index
    if (/^r\d+\.htm$/i.test(n)) return false               // viewer-generated tables
    if (n.includes('index-headers') || n.endsWith('index.html')) return false
    return true
  })
  const build = (name: string) => `https://www.sec.gov/Archives/edgar/data/${cikInt}/${accNoDashes}/${name}`

  // Strategy 1: explicit exhibit-99.1 naming anywhere in the name.
  const ex991 = candidates.find((i) =>
    /ex(?:hibit)?[\s_.-]*99[\s_.-]*1/i.test(i.name),
  )
  if (ex991) return build(ex991.name)

  // Strategy 2: press-release naming — common for cos that don't use the
  // ex99 convention. NVIDIA uses q{N}fy{NN}pr.htm; some smaller cos
  // use earnings-release.htm or simply pressrelease.htm.
  const pr = candidates.find((i) =>
    /(?:^|[^a-z])(?:pr|press[\s_.-]?release|earnings[\s_.-]?release|release)\.(?:htm|html|txt)$/i.test(i.name),
  )
  if (pr) return build(pr.name)

  // Strategy 3: largest non-cover .htm > 30 KB. Cover docs are typically
  // 25-65 KB of XBRL boilerplate; press releases are 200 KB-1 MB. If the
  // biggest non-cover file is ≤ 30 KB the filing probably ships nothing
  // we can score, and we'd rather fall back to primaryDocument than guess.
  const sized = candidates
    .filter((i) => i.name.toLowerCase() !== coverName)
    .map((i) => ({ name: i.name, size: Number(i.size) || 0 }))
    .filter((i) => i.size > 30_000)
    .sort((a, b) => b.size - a.size)
  if (sized[0]) return build(sized[0].name)

  return null
}

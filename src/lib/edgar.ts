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

/**
 * Free-tier market data layer.
 *
 *   * Prices: Yahoo Finance chart endpoint
 *     https://query1.finance.yahoo.com/v8/finance/chart/<ticker>
 *     - No signup, no auth
 *     - Returns price + prevClose + 52w high/low + currency in the response meta
 *     - User-Agent needs to look browser-ish; bare "node-fetch" gets rate-limited
 *
 *   * Fundamentals: SEC EDGAR companyfacts (XBRL)
 *     https://data.sec.gov/api/xbrl/companyfacts/CIK<padded>.json
 *     - No signup, requires polite User-Agent with email
 *     - Returns every fact a US filer has ever reported
 *     - We pick a handful of revenue/profitability metrics and store the latest 50
 */

const SEC_UA = 'compute-circuit (research tool) luigui.h2002@gmail.com'
/** Per-request cap. Yahoo either answers fast or not at all. */
const YAHOO_TIMEOUT_MS = 4_000

const YAHOO_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15'

// ----- Yahoo Finance -----

export interface YahooQuote {
  price: number
  prevClose: number
  high52w: number | null
  low52w: number | null
  currency: string
  /** Last ≤90 daily closes, ascending by date. [['2026-02-24', 142.31], ...]. */
  history: Array<[string, number]>
}

export async function fetchYahooQuote(ticker: string): Promise<YahooQuote | null> {
  // range=3mo gives ~63 trading days — enough for a 90-day sparkline and the
  // meta fields we already use.
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=3mo`
  try {
    // Hard per-request timeout. Without it a single hung call blocks the
    // caller's whole wall-clock budget, and fetchAllYahooQuotes' deadline —
    // which is only checked BETWEEN calls — never gets a chance to fire.
    // Yahoo answers in ~350ms from a residential IP but stalls indefinitely
    // from datacenter egress, so "slow" here means "never".
    const r = await fetch(url, {
      headers: { 'User-Agent': YAHOO_UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(YAHOO_TIMEOUT_MS),
    })
    if (!r.ok) return null
    const data = (await r.json()) as {
      chart?: {
        result?: Array<{
          meta?: Record<string, unknown>
          timestamp?: number[]
          indicators?: { quote?: Array<{ close?: Array<number | null> }> }
        }>
      }
    }
    const res = data?.chart?.result?.[0]
    const m = res?.meta
    if (!m) return null
    const price = Number(m.regularMarketPrice)
    if (!Number.isFinite(price)) return null

    // Parse history: zip timestamps[] with close[], drop nulls, ISO-date format.
    const timestamps = res?.timestamp ?? []
    const closes = res?.indicators?.quote?.[0]?.close ?? []
    const history: Array<[string, number]> = []
    for (let i = 0; i < timestamps.length; i++) {
      const ts = timestamps[i]
      const close = closes[i]
      if (typeof ts !== 'number' || typeof close !== 'number' || !Number.isFinite(close)) continue
      const iso = new Date(ts * 1000).toISOString().slice(0, 10)
      history.push([iso, Math.round(close * 100) / 100])
    }
    // history is already ascending from Yahoo, but be defensive.
    history.sort((a, b) => a[0].localeCompare(b[0]))

    return {
      price,
      prevClose: Number(m.chartPreviousClose ?? m.previousClose ?? 0),
      high52w: m.fiftyTwoWeekHigh != null ? Number(m.fiftyTwoWeekHigh) : null,
      low52w: m.fiftyTwoWeekLow != null ? Number(m.fiftyTwoWeekLow) : null,
      currency: (m.currency as string) ?? 'USD',
      history,
    }
  } catch {
    return null
  }
}

// ----- SEC companyfacts (XBRL) -----

// Map XBRL tag → our normalized metric key. Multiple XBRL tags can map to the
// same metric — e.g. older filings use `Revenues`, newer ones use the longer
// ASC-606 name `RevenueFromContractWithCustomerExcludingAssessedTax`.
const METRIC_MAP: Record<string, string> = {
  Revenues: 'revenue',
  RevenueFromContractWithCustomerExcludingAssessedTax: 'revenue',
  SalesRevenueNet: 'revenue',
  GrossProfit: 'gross_profit',
  OperatingIncomeLoss: 'operating_income',
  NetIncomeLoss: 'net_income',
  PaymentsToAcquirePropertyPlantAndEquipment: 'capex',
  PaymentsToAcquireProductiveAssets: 'capex',
  PaymentsForCapitalImprovements: 'capex',
  PaymentsToAcquirePropertyPlantAndEquipmentAndIntangibleAssets: 'capex',
  NetCashProvidedByUsedInOperatingActivities: 'operating_cash_flow',
  Assets: 'total_assets',
  StockholdersEquity: 'total_equity',
  CashAndCashEquivalentsAtCarryingValue: 'cash',
  ResearchAndDevelopmentExpense: 'rd_expense',
}

export interface ParsedFundamental {
  period: string         // YYYY-MM-DD
  period_type: 'Q' | 'FY'
  metric: string
  value: number
  unit: string
}

interface XbrlUnit {
  end: string
  val: number
  fp?: string    // 'FY' | 'Q1' | 'Q2' | 'Q3' | 'Q4'
  fy?: number
  form?: string
  /**
   * SEC-normalized period identifier. Critical for disambiguation:
   *   'CY2026Q1'   = standalone calendar-Q1 (e.g. 3 months of capex)
   *   'CY2025'     = standalone calendar year
   *   undefined/'' = some other aggregation — most often a lifetime cumulative
   *                  total (Amazon's PaymentsToAcquireProductiveAssets does this)
   *                  or a fiscal-YTD value that overlaps with periods we've
   *                  already counted elsewhere.
   * SEC documents `frame` as the value to use for cross-co comparability.
   * Picking framed values means TTM math stops compounding cumulative totals.
   */
  frame?: string
}

export async function fetchEdgarFundamentals(cik: string, maxPerMetric = 12): Promise<ParsedFundamental[]> {
  const padded = String(cik).padStart(10, '0')
  const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${padded}.json`
  try {
    const r = await fetch(url, { headers: { 'User-Agent': SEC_UA, Accept: 'application/json' } })
    if (!r.ok) return []
    const data = (await r.json()) as {
      facts?: { 'us-gaap'?: Record<string, { units?: Record<string, XbrlUnit[]> }> }
    }
    const usGaap = data?.facts?.['us-gaap'] ?? {}

    // Bucket by metric so multiple XBRL tags don't double-up — prefer whichever
    // tag has more recent data per period.
    const byMetric = new Map<string, Map<string, ParsedFundamental>>()
    for (const [xbrlTag, metric] of Object.entries(METRIC_MAP)) {
      const fact = usGaap[xbrlTag]
      if (!fact) continue
      const units = fact.units?.USD ?? []
      // First pass: keep only valid values, then sort newest first.
      const valid = units
        .filter(u => u.end && Number.isFinite(u.val))
        .sort((a, b) => b.end.localeCompare(a.end))
      // For each (end, period_type) key, prefer the unit with a non-empty
      // `frame` field. SEC sets `frame` only on the canonical standalone
      // value for that period; values without a frame are typically lifetime
      // cumulative totals or fiscal-YTD aggregates that double-count when
      // summed across quarters. Picking the framed value matches what the
      // co's earnings release headlines.
      const dedupByKey = new Map<string, XbrlUnit>()
      for (const u of valid) {
        const period_type: 'Q' | 'FY' = u.fp === 'FY' ? 'FY' : 'Q'
        const key = `${u.end}|${period_type}`
        const existing = dedupByKey.get(key)
        if (!existing) { dedupByKey.set(key, u); continue }
        const existingHasFrame = !!existing.frame
        const candidateHasFrame = !!u.frame
        // Replace only if candidate is framed and existing isn't.
        if (candidateHasFrame && !existingHasFrame) dedupByKey.set(key, u)
      }
      const sorted = Array.from(dedupByKey.values())
        .sort((a, b) => b.end.localeCompare(a.end))
        .slice(0, maxPerMetric)
      const bucket = byMetric.get(metric) ?? new Map<string, ParsedFundamental>()
      for (const u of sorted) {
        const period_type: 'Q' | 'FY' = u.fp === 'FY' ? 'FY' : 'Q'
        const key = `${u.end}|${period_type}`
        // Only overwrite if not already set (first XBRL tag in METRIC_MAP wins)
        if (!bucket.has(key)) {
          bucket.set(key, {
            period: u.end,
            period_type,
            metric,
            value: u.val,
            unit: 'USD',
          })
        }
      }
      byMetric.set(metric, bucket)
    }

    return Array.from(byMetric.values()).flatMap((bucket) => Array.from(bucket.values()))
  } catch {
    return []
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Sequential, polite — Yahoo throttles aggressively. */
export async function fetchAllYahooQuotes(
  tickers: string[],
  /**
   * Wall-clock budget in ms. When it runs out the loop STOPS and returns what
   * it has instead of running to the end of the list.
   *
   * This matters more than it looks. The caller is a Vercel function with a
   * hard 60s cap, and on timeout the platform kills the lambda before any
   * upsert runs — so an over-budget batch wrote ZERO rows, every night,
   * forever. A table that is behind can then never catch up, because each
   * attempt to catch up is exactly the attempt that times out. Partial
   * progress is strictly better: the stalest-first ordering means the rows
   * we do get are the ones that needed it most.
   */
  deadlineMs?: number,
): Promise<Map<string, YahooQuote>> {
  const out = new Map<string, YahooQuote>()
  const started = Date.now()
  for (const t of tickers) {
    if (deadlineMs != null && Date.now() - started > deadlineMs) break
    const q = await fetchYahooQuote(t)
    if (q) out.set(t, q)
    await sleep(120) // ~8 req/sec
  }
  return out
}

/** Sequential SEC fetches at ~6 req/sec to stay under the 10/sec limit. */
export async function fetchAllEdgarFundamentals(
  ciks: Array<{ companyId: string; cik: string }>,
  maxPerMetric = 12
): Promise<Array<{ companyId: string; rows: ParsedFundamental[] }>> {
  const results: Array<{ companyId: string; rows: ParsedFundamental[] }> = []
  for (const c of ciks) {
    const rows = await fetchEdgarFundamentals(c.cik, maxPerMetric)
    results.push({ companyId: c.companyId, rows })
    await sleep(150)
  }
  return results
}

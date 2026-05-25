/**
 * EIA Open Data API client — regional electricity demand.
 *
 * Endpoint: https://api.eia.gov/v2/electricity/rto/region-data/data/
 *   - Free, requires API key from https://www.eia.gov/opendata/register.php
 *   - Documented rate limit: 5,000 requests per hour per key
 *   - JSON response cap: 5,000 rows per request (we ask for ~400 hours = ~17 days)
 *   - Source: EIA Form 930 "Hourly Electric Grid Monitor"
 *   - Data lags ~1-2 hours behind real-time
 *
 * Region (`respondent`) IDs we use:
 *   - PJM  — PJM Interconnection (Mid-Atlantic; covers CEG's TMI, TLN's Susquehanna)
 *   - ERCO — Electric Reliability Council of Texas (VST's Comanche Peak + gas fleet)
 *   - FLA  — Florida (NEE's FPL service territory)
 *   - US48 — United States Lower 48 (proxy for VRT/EQIX/DLR national exposure)
 *
 * Metric type filter: `type=D` selects "Demand" (vs. DF=Demand Forecast,
 * NG=Net Generation, TI=Interchange). Units are megawatthours per hour
 * (i.e. average MW over that hour).
 *
 * Snapshot we compute per region:
 *   - last 7-day rolling avg of hourly demand (MWh/h)
 *   - YoY change pct vs. the same calendar week 365 days ago
 *   - most recent hour's value + ISO timestamp
 *
 * The function returns null on any error rather than throwing — the cron
 * loop treats null as "skip this region this run" and moves on.
 */

const EIA_API_KEY = process.env.EIA_API_KEY ?? ''
const EIA_BASE = 'https://api.eia.gov/v2/electricity/rto/region-data/data/'
const UA = 'compute-circuit (research tool) luigui.h2002@gmail.com'

export interface GridDemandSnapshot {
  region: string                // 'PJM' | 'ERCO' | 'FLA' | 'US48' | ...
  current_7d_avg_mwh: number
  yoy_change_pct: number
  last_hourly_mwh: number
  last_hour: string             // ISO timestamp (UTC, hour-precision)
}

interface EiaRow {
  period: string                // 'YYYY-MM-DDTHH'
  respondent: string
  type: string
  value: string | number
}

interface EiaResponse {
  response?: {
    data?: EiaRow[]
    total?: string
  }
  error?: string
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** EIA wants UTC hour-precision strings like '2026-05-24T18'. */
function eiaHour(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}`
}

/** Subtract `days` calendar days from `d` (returns a new Date). */
function daysAgo(d: Date, days: number): Date {
  const out = new Date(d.getTime())
  out.setUTCDate(out.getUTCDate() - days)
  return out
}

async function fetchHourly(region: string, start: Date, end: Date): Promise<EiaRow[] | null> {
  if (!EIA_API_KEY) return null
  const params = new URLSearchParams()
  params.set('api_key', EIA_API_KEY)
  params.set('frequency', 'hourly')
  params.append('data[0]', 'value')
  params.append('facets[respondent][]', region)
  params.append('facets[type][]', 'D')
  params.set('start', eiaHour(start))
  params.set('end', eiaHour(end))
  params.append('sort[0][column]', 'period')
  params.append('sort[0][direction]', 'desc')
  params.set('length', '5000')

  try {
    const r = await fetch(`${EIA_BASE}?${params.toString()}`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    })
    if (!r.ok) return null
    const data = (await r.json()) as EiaResponse
    return data?.response?.data ?? null
  } catch {
    return null
  }
}

/** Mean of an array of numbers; returns NaN for empty input. */
function mean(xs: number[]): number {
  if (xs.length === 0) return NaN
  let s = 0
  for (const x of xs) s += x
  return s / xs.length
}

export async function fetchGridDemand(region: string): Promise<GridDemandSnapshot | null> {
  if (!EIA_API_KEY) return null

  const now = new Date()

  // Window 1: most recent ~8 days. We ask 8 to be safe; the API lags 1-2h
  // so the most-recent row will be ~2h old, and we'll still have ≥168 hours.
  const recentStart = daysAgo(now, 8)
  const recent = await fetchHourly(region, recentStart, now)
  if (!recent || recent.length === 0) return null

  // Coerce + sort desc by period (API returns desc already, but be defensive)
  const recentRows = recent
    .map(r => ({ period: r.period, value: Number(r.value) }))
    .filter(r => Number.isFinite(r.value))
    .sort((a, b) => b.period.localeCompare(a.period))
  if (recentRows.length === 0) return null

  const last = recentRows[0]
  // Trailing 7 days = most recent 168 hours
  const last7d = recentRows.slice(0, 24 * 7).map(r => r.value)
  const current_7d_avg_mwh = mean(last7d)

  // Window 2: same 7-day window 365 days ago for YoY comparison
  const yoyEnd = daysAgo(now, 365)
  const yoyStart = daysAgo(yoyEnd, 7)
  const yoy = await fetchHourly(region, yoyStart, yoyEnd)
  // YoY is best-effort — older data sometimes has gaps in Form-930 backfills
  let yoy_change_pct = 0
  if (yoy && yoy.length > 0) {
    const yoyVals = yoy
      .map(r => Number(r.value))
      .filter(v => Number.isFinite(v))
      .slice(0, 24 * 7)
    const yoyAvg = mean(yoyVals)
    if (Number.isFinite(yoyAvg) && yoyAvg > 0) {
      yoy_change_pct = ((current_7d_avg_mwh - yoyAvg) / yoyAvg) * 100
    }
  }

  return {
    region,
    current_7d_avg_mwh: Math.round(current_7d_avg_mwh * 10) / 10,
    yoy_change_pct: Math.round(yoy_change_pct * 100) / 100,
    last_hourly_mwh: last.value,
    last_hour: `${last.period}:00:00Z`,
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Sequential fetcher — EIA has plenty of rate-limit headroom but be polite. */
export async function fetchAllGridDemand(
  regions: Array<{ companyId: string; region: string }>,
): Promise<Array<{ companyId: string; snap: GridDemandSnapshot | null }>> {
  const out: Array<{ companyId: string; snap: GridDemandSnapshot | null }> = []
  for (const r of regions) {
    const snap = await fetchGridDemand(r.region)
    out.push({ companyId: r.companyId, snap })
    await sleep(150) // 2 calls per region × 7 regions × 150ms < 3s total
  }
  return out
}

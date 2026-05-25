/**
 * Hyperscaler capex run-rate derivation.
 *
 * Reads from the `fundamentals` table only (already wired via /api/cron/fundamentals).
 * The XBRL `PaymentsToAcquirePropertyPlantAndEquipment` tag is reported YTD-cumulative
 * within each fiscal year — i.e. Q1 = 3 months, Q2 = 6 months, Q3 = 9 months, FY = 12 months.
 * Fiscal years differ across cos: MSFT ends Jun, ORCL ends May, the rest end Dec.
 *
 * TTM strategy:
 *   1. Find the latest FY row (FY_t) and the prior FY row (FY_{t-1}).
 *   2. Look for the latest Q row dated AFTER FY_t.period (a partial year into FY_{t+1}).
 *   3. If no newer Q exists → TTM = FY_t.value, YoY = (FY_t − FY_{t-1}) / FY_{t-1}.
 *   4. If a newer Q exists at period P (Q_current):
 *        - Find the Q row in fiscal year FY_t at the same months-since-FY-start (Q_match).
 *        - TTM = FY_t + Q_current − Q_match.
 *        - Prior TTM ≈ FY_{t-1} (the full year ending one year before today's TTM cutoff).
 *          We don't have enough historical quarterlies cached (12-period cap in market.ts)
 *          to compute the true prior TTM via the same FY+ΔQ formula, so we approximate.
 *
 * Staleness guard: if the latest capex period is older than 18 months, return null
 * (companyfacts dropped the tag — see AMZN/NVDA which migrated to newer XBRL tags).
 */
import type { Fundamental } from '@/types/db'
import type { GraphData } from './graph-data'

const STALE_AFTER_MS = 540 * 86_400_000 // ~18 months

export interface CapexTTM {
  ttm: number | null
  yoy_pct: number | null
  latest_period: string | null
}

/**
 * Compute TTM capex + YoY% for a single company from the fundamentals table.
 * Returns null fields when the data is missing or stale.
 */
export function computeCapexTTM(rows: Fundamental[], companyId: string): CapexTTM {
  const empty: CapexTTM = { ttm: null, yoy_pct: null, latest_period: null }
  const capex = rows
    .filter(r => r.company_id === companyId && r.metric === 'capex')
    .slice()
    .sort((a, b) => b.period.localeCompare(a.period))
  if (capex.length === 0) return empty

  const latestPeriodMs = Date.parse(capex[0].period)
  if (Number.isFinite(latestPeriodMs) && Date.now() - latestPeriodMs > STALE_AFTER_MS) {
    return empty
  }

  const fys = capex.filter(r => r.period_type === 'FY')
  const qs = capex.filter(r => r.period_type === 'Q')
  const fyT = fys[0] ?? null
  const fyPrev = fys[1] ?? null
  if (!fyT) {
    // No FY anchor — fall back to latest Q value but skip YoY.
    return { ttm: capex[0].value, yoy_pct: null, latest_period: capex[0].period }
  }

  const newerQ = qs.find(q => q.period > fyT.period) ?? null
  if (!newerQ) {
    // No partial-year update yet → TTM is the latest FY.
    const ttm = fyT.value
    const yoy = fyPrev ? pctChange(ttm, fyPrev.value) : null
    return { ttm, yoy_pct: yoy, latest_period: fyT.period }
  }

  // Find the Q in FY_t at the same months-since-FY-start as newerQ.
  // FY_t ends on fyT.period; FY_t starts the day after (fyT.period − 1 year).
  // newerQ.period is in FY_{t+1}, which starts the day after fyT.period.
  // We want the Q row at the same elapsed months within FY_t.
  const monthsIntoFy = monthsSince(fyT.period, newerQ.period)
  const fyTStartDate = addYears(fyT.period, -1)
  const targetMatchPeriod = addMonths(fyTStartDate, monthsIntoFy)
  const qMatch = closestQ(qs, targetMatchPeriod, fyT.period, fyTStartDate)

  if (!qMatch) {
    // Can't compute the YTD comparable — TTM falls back to FY_t value.
    const ttm = fyT.value
    const yoy = fyPrev ? pctChange(ttm, fyPrev.value) : null
    return { ttm, yoy_pct: yoy, latest_period: fyT.period }
  }

  const ttm = fyT.value + newerQ.value - qMatch.value
  // Prior TTM approximation, in order of preference:
  //   1. FY_{t-1} value — true year-ago TTM (same calendar window, shifted 12mo).
  //   2. FY_t value — the TTM ending fyT.period (qMatch.period months earlier).
  //      Less ideal (shifted ~9mo instead of 12mo) but lets cos with only one
  //      FY row cached still surface a growth signal.
  const priorTtm = fyPrev?.value ?? fyT.value
  const yoy = pctChange(ttm, priorTtm)
  return { ttm, yoy_pct: yoy, latest_period: newerQ.period }
}

export interface CapexRunRateRow {
  companyId: string
  ttm: number
  yoy_pct: number | null
  latestPeriod: string
}

/**
 * Return the top-N companies by absolute TTM capex (descending).
 * Skips companies with null TTM (missing or stale data).
 */
export function topCapexRunRate(data: GraphData, n = 5): CapexRunRateRow[] {
  const rows: CapexRunRateRow[] = []
  for (const co of data.companies) {
    const r = computeCapexTTM(data.fundamentals, co.id)
    if (r.ttm == null || r.latest_period == null) continue
    rows.push({
      companyId: co.id,
      ttm: r.ttm,
      yoy_pct: r.yoy_pct,
      latestPeriod: r.latest_period,
    })
  }
  return rows.sort((a, b) => b.ttm - a.ttm).slice(0, n)
}

// ---------- helpers ----------

function pctChange(curr: number, prev: number): number | null {
  if (!Number.isFinite(prev) || prev === 0) return null
  return ((curr - prev) / prev) * 100
}

function addYears(isoDate: string, years: number): string {
  const d = new Date(isoDate + 'T00:00:00Z')
  d.setUTCFullYear(d.getUTCFullYear() + years)
  return d.toISOString().slice(0, 10)
}

function addMonths(isoDate: string, months: number): string {
  const d = new Date(isoDate + 'T00:00:00Z')
  d.setUTCMonth(d.getUTCMonth() + months)
  return d.toISOString().slice(0, 10)
}

function monthsSince(startIso: string, endIso: string): number {
  const s = new Date(startIso + 'T00:00:00Z')
  const e = new Date(endIso + 'T00:00:00Z')
  return (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + (e.getUTCMonth() - s.getUTCMonth())
}

/**
 * Find the Q row whose period is the closest match to `targetIso` (within ±45 days)
 * AND lies within the fiscal year window (fyStart, fyEnd].
 */
function closestQ(
  qs: Fundamental[],
  targetIso: string,
  fyEndIso: string,
  fyStartIso: string,
): Fundamental | null {
  const targetMs = Date.parse(targetIso)
  const fyEndMs = Date.parse(fyEndIso)
  const fyStartMs = Date.parse(fyStartIso)
  if (!Number.isFinite(targetMs)) return null
  let best: Fundamental | null = null
  let bestDelta = Infinity
  for (const q of qs) {
    const qMs = Date.parse(q.period)
    if (!Number.isFinite(qMs)) continue
    if (qMs <= fyStartMs || qMs > fyEndMs) continue
    const delta = Math.abs(qMs - targetMs)
    if (delta < bestDelta) { bestDelta = delta; best = q }
  }
  if (best && bestDelta <= 45 * 86_400_000) return best
  return null
}

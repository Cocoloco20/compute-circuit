/**
 * Signal prioritization for the drawer's Overview tab.
 *
 * With ~14 data sources feeding the entity drawer (price, news, 8-Ks, insider,
 * holdings, hf, patents, jobs, transcripts, capex, github, funding,
 * leaderboard, etc.), the Overview tab is overwhelming. This module ranks the
 * signals per-company so the drawer can surface the 3 most relevant
 * "right now" cards at the top, and hide the rest behind a disclosure.
 *
 * The ranker is a pure function over GraphData — no fetches, no React. It can
 * be unit-tested or run in scripts/probe_signals without booting Next.
 *
 * Scoring rubric (from the strategic-roadmap UX brief):
 *   +30  big event today / past 7d (8-K, funding, large insider, price ±5%,
 *                                   hiring delta ≥ +50)
 *   +20  persistent strong signal (patents TTM > 100, top-3 LMArena,
 *                                  capex YoY > +20%)
 *   +10  data exists in that category (presence vs absence)
 *   +5   recent (within 14d) but not today
 *   +0   no data
 *
 * Tie-break: alphabetical by `kind` so re-renders don't reshuffle stable data.
 */

import type {
  Company,
  FundingRound,
  GithubActivity,
  GridDemandSnapshot,
  HfActivity,
  InsiderTransaction,
  JobSnapshotRow,
  ModelLeaderboardEntry,
  PatentSnapshotRow,
  Signal,
  SocialMention,
  TranscriptSignal,
} from '@/types/db'
import type { GraphData, SignalCompanyLink } from './graph-data'
import { computeCapexTTM } from './capex'

/**
 * The render component is a string key that the drawer maps to an actual
 * React component. Keeping it a string keeps this module side-effect-free
 * (no JSX) and lets it be reused outside of React (tests, scripts, future
 * server-side rendering of "top signals" digests).
 */
export type RenderKind =
  | 'price-move'
  | 'eight-k'
  | 'insider-burst'
  | 'funding-round'
  | 'hiring-pulse'
  | 'patent-velocity'
  | 'github-activity'
  | 'hf-activity'
  | 'grid-pressure'
  | 'capex-runrate'
  | 'leaderboard-top'
  | 'transcript-digest'
  | 'news-burst'
  | 'buzz-mentions'

export interface RankedSignal {
  /** Stable identifier for the signal category — used by the drawer to pick
   *  the right chip component. Two ranked entries should not share a kind. */
  kind: RenderKind
  /** Total points awarded by the rubric. Higher = more important right now. */
  score: number
  /** Short human-readable headline (e.g. "Patents TTM 200 · +12% vs 30d ago").
   *  Optional — the chip itself shows the full content; this is for debug,
   *  analytics, and "more signals" labels. */
  headline: string
}

const TODAY_MS = 86_400_000
const SEVEN_DAYS_MS = 7 * TODAY_MS

function daysAgo(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return Math.floor((now - t) / TODAY_MS)
}

/** Was the event within the last 24h? */
function isToday(iso: string | null | undefined, now = Date.now()): boolean {
  const d = daysAgo(iso, now)
  return d != null && d <= 0
}

/** Was the event within the last N days (inclusive)? */
function withinDays(iso: string | null | undefined, n: number, now = Date.now()): boolean {
  const d = daysAgo(iso, now)
  return d != null && d <= n
}

/** Pick latest row by snapshot_date string compare (ISO). */
function latestBy<T>(rows: T[], getDate: (r: T) => string): T | null {
  if (rows.length === 0) return null
  let best: T = rows[0]
  let bestD = getDate(rows[0])
  for (let i = 1; i < rows.length; i++) {
    const d = getDate(rows[i])
    if (d > bestD) { best = rows[i]; bestD = d }
  }
  return best
}

/** Closest row to N days before a target date, within ±4d tolerance. */
function closestToDelta<T>(
  rows: T[],
  anchorDate: string,
  daysBack: number,
  getDate: (r: T) => string,
): T | null {
  const target = Date.parse(anchorDate) - daysBack * TODAY_MS
  if (!Number.isFinite(target)) return null
  let best: T | null = null
  let bestDelta = Infinity
  for (const r of rows) {
    const t = Date.parse(getDate(r))
    if (!Number.isFinite(t)) continue
    const d = Math.abs(t - target)
    if (d < bestDelta) { best = r; bestDelta = d }
  }
  return bestDelta < 4 * TODAY_MS ? best : null
}

// ---------------- individual category scorers ----------------

interface ScoredCategory {
  score: number
  headline: string
}

function scorePrice(company: Company): ScoredCategory | null {
  if (company.last_price == null || company.prev_close == null || company.prev_close === 0) {
    return null
  }
  const pct = ((company.last_price - company.prev_close) / company.prev_close) * 100
  const abs = Math.abs(pct)
  let score = 10  // presence
  if (abs >= 5) score = 30
  const sign = pct >= 0 ? '+' : ''
  return {
    score,
    headline: `Price ${sign}${pct.toFixed(2)}% today (${company.ticker ?? company.id})`,
  }
}

function scoreEightK(
  signals: Signal[],
  links: SignalCompanyLink[],
  companyId: string,
): ScoredCategory | null {
  const myIds = new Set(links.filter(l => l.company_id === companyId).map(l => l.signal_id))
  const filings = signals.filter(s => myIds.has(s.id) && s.form_type === '8-K')
  if (filings.length === 0) return null
  const latest = filings.slice().sort((a, b) => b.date.localeCompare(a.date))[0]
  let score = 10
  if (isToday(latest.date)) score = 30
  else if (withinDays(latest.date, 7)) score = 30  // brief: "8-K filed today" intent covers the last-week material-event window
  else if (withinDays(latest.date, 14)) score = 5
  return {
    score,
    headline: `8-K ${latest.date} — ${latest.headline.slice(0, 70)}`,
  }
}

function scoreNewsBurst(
  signals: Signal[],
  links: SignalCompanyLink[],
  companyId: string,
): ScoredCategory | null {
  const myIds = new Set(links.filter(l => l.company_id === companyId).map(l => l.signal_id))
  const news = signals.filter(s => myIds.has(s.id) && s.form_type === 'news')
  if (news.length === 0) return null
  const sevenAgo = new Date(Date.now() - SEVEN_DAYS_MS).toISOString().slice(0, 10)
  const recent = news.filter(s => s.date >= sevenAgo)
  // News is noisy. Suppress entirely when there's nothing recent enough to be
  // a "decision-ready glance" — the Activity tab still has the full feed.
  if (recent.length === 0 && !withinDays(news[0].date, 14)) return null
  let score = 10
  if (recent.length >= 10) score = 30
  else if (recent.length >= 3) score = 20
  else if (recent.length === 0 && withinDays(news[0].date, 14)) score = 5
  return {
    score,
    headline: `${recent.length} news mention${recent.length === 1 ? '' : 's'} in last 7d`,
  }
}

function scoreInsiderBurst(txns: InsiderTransaction[]): ScoredCategory | null {
  if (txns.length === 0) return null
  const sevenAgo = new Date(Date.now() - SEVEN_DAYS_MS).toISOString().slice(0, 10)
  const recent = txns.filter(t => t.filing_date >= sevenAgo)
  let totalAbsUsd = 0
  for (const t of recent) totalAbsUsd += Math.abs(t.value_usd ?? 0)
  let score = 10
  if (totalAbsUsd >= 5_000_000) score = 30
  else if (withinDays(txns[0].filing_date, 14)) score = 5
  return {
    score,
    headline: recent.length > 0
      ? `Insider ${recent.length} txn${recent.length === 1 ? '' : 's'} · ~$${(totalAbsUsd / 1_000_000).toFixed(1)}M in 7d`
      : `Last insider filing ${txns[0].filing_date}`,
  }
}

function scoreFundingRound(rounds: FundingRound[]): ScoredCategory | null {
  if (rounds.length === 0) return null
  const sorted = rounds.slice().sort((a, b) => b.filed_date.localeCompare(a.filed_date))
  const latest = sorted[0]
  let score = 10
  if (withinDays(latest.filed_date, 7)) score = 30
  else if (withinDays(latest.filed_date, 14)) score = 5
  const amt = latest.total_amount_sold_usd ?? latest.total_offering_amount_usd
  const amtStr = amt != null
    ? (amt >= 1e9 ? `$${(amt / 1e9).toFixed(1)}B` : `$${(amt / 1e6).toFixed(0)}M`)
    : '—'
  return {
    score,
    headline: `Funding ${latest.filed_date} — ${amtStr}`,
  }
}

function scoreHiring(jobs: JobSnapshotRow[]): ScoredCategory | null {
  if (jobs.length === 0) return null
  const sorted = jobs.slice().sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date))
  const latest = sorted[0]
  const prior7 = closestToDelta(sorted, latest.snapshot_date, 7, r => r.snapshot_date)
  const delta7 = prior7 ? latest.total_open - prior7.total_open : null
  let score = 10
  // Big event: 7d hiring surge ≥ +50 (brief threshold).
  if (delta7 != null && delta7 >= 50) score = 30
  // Persistent strong: ≥ +20 in 7d (clear ramp, not just noise).
  else if (delta7 != null && delta7 >= 20) score = 20
  // Presence with a high open count (e.g. 500+) is still useful.
  return {
    score,
    headline: `Hiring ${latest.total_open} open${delta7 != null ? ` (${delta7 >= 0 ? '+' : ''}${delta7} in 7d)` : ''}`,
  }
}

function scorePatents(patents: PatentSnapshotRow[]): ScoredCategory | null {
  if (patents.length === 0) return null
  const latest = latestBy(patents, p => p.snapshot_date)
  if (!latest) return null
  let score = 10
  if (latest.ttm_count > 100) score = 20  // brief: persistent strong (TTM > 100)
  // 30d momentum bump to top if growing fast.
  const prior = closestToDelta(patents, latest.snapshot_date, 30, p => p.snapshot_date)
  if (prior && latest.ttm_count - prior.ttm_count >= 20) score = 30
  return {
    score,
    headline: `Patents TTM ${latest.ttm_count}`,
  }
}

function scoreGithub(rows: GithubActivity[]): ScoredCategory | null {
  if (rows.length === 0) return null
  const latest = latestBy(rows, r => r.snapshot_date)
  if (!latest) return null
  let score = 10
  // 50+ merged PRs in 30d is the "hot" threshold the existing chip uses.
  if (latest.prs_30d_merged >= 50) score = 20
  if (latest.prs_30d_merged >= 100) score = 30
  if (withinDays(latest.last_release_date, 7)) score = Math.max(score, 30)
  return {
    score,
    headline: `GitHub ${latest.stars.toLocaleString()}★ · +${latest.prs_30d_merged} PRs/30d`,
  }
}

function scoreHf(rows: HfActivity[]): ScoredCategory | null {
  if (rows.length === 0) return null
  const latest = latestBy(rows, r => r.snapshot_date)
  if (!latest || latest.model_count === 0) return null
  let score = 10
  // 1M+ downloads in 30d signals real adoption.
  if (latest.total_downloads_30d >= 1_000_000) score = 20
  if (latest.total_downloads_30d >= 10_000_000) score = 30
  if (withinDays(latest.last_release_date, 7)) score = Math.max(score, 30)
  return {
    score,
    headline: `HF ${latest.model_count} models · ${formatCount(latest.total_downloads_30d)} dl/30d`,
  }
}

function scoreGrid(rows: GridDemandSnapshot[]): ScoredCategory | null {
  if (rows.length === 0) return null
  const latest = latestBy(rows, r => r.snapshot_date)
  if (!latest || latest.current_7d_avg_mwh == null) return null
  let score = 10
  // Tight grid = YoY > +5%, a meaningful pressure signal for power-constrained
  // infrastructure cos. >+15% is a "right now" event.
  const yoy = latest.yoy_change_pct ?? 0
  if (yoy >= 15) score = 30
  else if (yoy >= 5) score = 20
  return {
    score,
    headline: `Power ${latest.region} ${(latest.current_7d_avg_mwh / 1000).toFixed(1)}GWh · ${yoy >= 0 ? '+' : ''}${yoy.toFixed(1)}% YoY`,
  }
}

function scoreCapex(data: GraphData, companyId: string): ScoredCategory | null {
  const { ttm, yoy_pct, latest_period } = computeCapexTTM(data.fundamentals, companyId)
  if (ttm == null || latest_period == null) return null
  let score = 10
  if (yoy_pct != null && yoy_pct > 20) score = 20  // brief: persistent strong
  if (yoy_pct != null && yoy_pct > 50) score = 30  // a real "ramp" event
  const ttmStr = ttm >= 1e9 ? `$${(ttm / 1e9).toFixed(1)}B` : `$${(ttm / 1e6).toFixed(0)}M`
  return {
    score,
    headline: `Capex ${ttmStr} TTM${yoy_pct != null ? ` · ${yoy_pct >= 0 ? '+' : ''}${yoy_pct.toFixed(1)}% YoY` : ''}`,
  }
}

function scoreLeaderboard(rows: ModelLeaderboardEntry[]): ScoredCategory | null {
  if (rows.length === 0) return null
  const dates = Array.from(new Set(rows.map(r => r.snapshot_date))).sort((a, b) => b.localeCompare(a))
  if (dates.length === 0) return null
  const latestDate = dates[0]
  const latestRows = rows.filter(r => r.snapshot_date === latestDate)
  latestRows.sort((a, b) => a.elo_rank - b.elo_rank)
  const top = latestRows[0]
  let score = 10
  if (top.elo_rank <= 3) score = 20  // brief: persistent strong (top-3 LMArena)
  if (top.elo_rank <= 1) score = 30  // #1 is a real event
  return {
    score,
    headline: `LMArena ${top.model_name} · rank #${top.elo_rank}`,
  }
}

function scoreBuzz(rows: SocialMention[]): ScoredCategory | null {
  if (rows.length === 0) return null
  // Sum the latest 24h mention counts across all sources (HN + Reddit).
  let total24h = 0
  let total7d = 0
  for (const r of rows) {
    total24h += r.mentions_24h ?? 0
    total7d  += r.mentions_7d ?? 0
  }
  if (total7d === 0) return null
  let score = 10
  // Brief: "big event" thresholds are domain-specific. Treat 50+ mentions/7d
  // as material (cf. typical HN/Reddit baseline of 0-5/day for any one co).
  if (total7d >= 50) score = 20
  if (total24h >= 25) score = 30
  return {
    score,
    headline: `Buzz ${total7d} mentions in 7d (${total24h} in 24h)`,
  }
}

function scoreTranscript(rows: TranscriptSignal[]): ScoredCategory | null {
  if (rows.length === 0) return null
  const latest = rows.slice().sort((a, b) => b.filed_date.localeCompare(a.filed_date))[0]
  let score = 10
  // Within 7d of an earnings release with material AI/GPU/capex mentions.
  if (withinDays(latest.filed_date, 7)) score = 20
  if (withinDays(latest.filed_date, 14)) score = Math.max(score, 5)
  const total = latest.ai_mentions + latest.gpu_mentions + latest.capex_mentions
  if (total >= 30 && withinDays(latest.filed_date, 14)) score = 30
  return {
    score,
    headline: `Transcript ${latest.filed_date} · AI×${latest.ai_mentions} GPU×${latest.gpu_mentions}`,
  }
}

// ---------------- public API ----------------

/**
 * Rank all relevant signals for a single company. Top 5 returned, sorted by
 * score DESC, then `kind` alphabetical (stable). Categories with no data
 * are omitted (score 0).
 *
 * The drawer's Overview tab uses the top 3 as full-width cards and folds the
 * rest behind a "More signals" disclosure.
 */
export function rankSignalsForCo(companyId: string, data: GraphData): RankedSignal[] {
  const company = data.companies.find(c => c.id === companyId)
  if (!company) return []

  const jobs = data.jobs.filter(j => j.company_id === companyId)
  const patents = data.patents.filter(p => p.company_id === companyId)
  const github = data.githubActivity.filter(g => g.company_id === companyId)
  const hf = data.hfActivity.filter(h => h.company_id === companyId)
  const grid = data.gridDemand.filter(g => g.company_id === companyId)
  const insider = data.insiders.filter(t => t.company_id === companyId)
  const funding = data.fundingRounds.filter(r => r.company_id === companyId)
  const transcripts = data.transcripts.filter(t => t.company_id === companyId)
  const leaderboard = data.modelLeaderboard.filter(e => e.company_id === companyId)
  const social = (data.socialMentions ?? []).filter(s => s.company_id === companyId)

  const candidates: Array<{ kind: RenderKind; result: ScoredCategory | null }> = [
    { kind: 'price-move',        result: scorePrice(company) },
    { kind: 'eight-k',           result: scoreEightK(data.signals, data.signalCompanies, companyId) },
    { kind: 'news-burst',        result: scoreNewsBurst(data.signals, data.signalCompanies, companyId) },
    { kind: 'insider-burst',     result: scoreInsiderBurst(insider) },
    { kind: 'funding-round',     result: scoreFundingRound(funding) },
    { kind: 'hiring-pulse',      result: scoreHiring(jobs) },
    { kind: 'patent-velocity',   result: scorePatents(patents) },
    { kind: 'github-activity',   result: scoreGithub(github) },
    { kind: 'hf-activity',       result: scoreHf(hf) },
    { kind: 'grid-pressure',     result: scoreGrid(grid) },
    { kind: 'capex-runrate',     result: scoreCapex(data, companyId) },
    { kind: 'leaderboard-top',   result: scoreLeaderboard(leaderboard) },
    { kind: 'transcript-digest', result: scoreTranscript(transcripts) },
    { kind: 'buzz-mentions',     result: scoreBuzz(social) },
  ]

  const ranked: RankedSignal[] = candidates
    .filter((c): c is { kind: RenderKind; result: ScoredCategory } => c.result != null && c.result.score > 0)
    .map(c => ({ kind: c.kind, score: c.result.score, headline: c.result.headline }))

  // Deterministic sort: score DESC, kind ASC alphabetical for tiebreak.
  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.kind.localeCompare(b.kind)
  })

  return ranked.slice(0, 5)
}

// ---------- helpers ----------

function formatCount(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`
  return n.toString()
}

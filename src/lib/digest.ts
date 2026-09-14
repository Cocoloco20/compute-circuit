/**
 * src/lib/digest.ts
 *
 * Core digest computation + HTML email renderer.
 *
 * buildDigest(data, watchedCoIds)
 *   Scans the already-fetched GraphData for each watched company and
 *   computes a structured DigestEntry covering the 8 signal categories
 *   documented in the feature spec.
 *
 * renderEmailHtml(digest)
 *   Converts the Digest into inline-CSS HTML suitable for Gmail / Outlook.
 *   Design tokens are inlined as hex values from design-tokens.ts.
 *   Width: 600 px, dark theme.
 */

import type { GraphData } from './graph-data'
import type {
  Company,
  Signal,
  InsiderTransaction,
  FundingRound,
  ModelLeaderboardEntry,
  JobSnapshotRow,
} from '@/types/db'
import { TOKENS } from './design-tokens'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DigestPriceEntry {
  lastPrice: number | null
  prevClose: number | null
  pctChange: number | null   // null = no data
}

export interface DigestFilingEntry {
  count: number
  titles: string[]
}

export interface DigestNewsEntry {
  count: number
  topHeadline: string | null
  topUrl: string | null
}

export interface DigestInsiderEntry {
  netValueUsd: number       // positive = net buy, negative = net sell
  transactionCount: number
}

export interface DigestHiringEntry {
  current: number | null
  yesterday: number | null
  delta: number | null
}

export interface DigestFundingEntry {
  found: boolean
  amountUsd: number | null
  investors: string[]
  filedDate: string | null
}

export interface DigestEloEntry {
  found: boolean
  modelName: string | null
  currentRank: number | null
  prevRank: number | null
  rankDelta: number | null
}

export interface DigestCompanyEntry {
  companyId: string
  name: string
  ticker: string | null
  price: DigestPriceEntry
  filings: DigestFilingEntry
  news: DigestNewsEntry
  insider: DigestInsiderEntry
  hiring: DigestHiringEntry
  funding: DigestFundingEntry
  elo: DigestEloEntry
  // Future: irDiff, regulatory — added when those crons ship
}

export interface Digest {
  generatedAt: string        // ISO timestamp
  watchedCoIds: string[]
  entries: DigestCompanyEntry[]
  anySignals: boolean        // true if at least one entry has something interesting
}

// ---------------------------------------------------------------------------
// buildDigest
// ---------------------------------------------------------------------------

export function buildDigest(data: GraphData, watchedCoIds: string[]): Digest {
  const now = new Date()
  const cutoff24h = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const cutoff7d  = new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000)

  const cut24 = cutoff24h.toISOString().slice(0, 10)
  const cut7d = cutoff7d.toISOString().slice(0, 10)

  // Index by company id for fast lookup
  const coMap = new Map<string, Company>(data.companies.map(c => [c.id, c]))

  // Signal company index: signal_id → company_ids[]
  const sigCoIdx = new Map<string, string[]>()
  for (const link of data.signalCompanies) {
    const arr = sigCoIdx.get(link.signal_id) ?? []
    arr.push(link.company_id)
    sigCoIdx.set(link.signal_id, arr)
  }

  // Company → signals index
  const coSigIdx = new Map<string, Signal[]>()
  for (const sig of data.signals) {
    const coIds = sigCoIdx.get(sig.id) ?? []
    for (const coId of coIds) {
      const arr = coSigIdx.get(coId) ?? []
      arr.push(sig)
      coSigIdx.set(coId, arr)
    }
  }

  const entries: DigestCompanyEntry[] = []

  for (const coId of watchedCoIds) {
    const co = coMap.get(coId)
    if (!co) continue

    // ── Price ──────────────────────────────────────────────────────────────
    const last = co.last_price
    const prev = co.prev_close
    const pctChange = (last != null && prev != null && prev !== 0)
      ? ((last - prev) / prev) * 100
      : null
    const price: DigestPriceEntry = { lastPrice: last, prevClose: prev, pctChange }

    // ── 8-K Filings (last 24h) ─────────────────────────────────────────────
    const coSignals = coSigIdx.get(coId) ?? []
    const recentFilings = coSignals.filter(s =>
      s.source === 'sec-edgar' &&
      s.form_type === '8-K' &&
      s.date >= cut24
    )
    const filings: DigestFilingEntry = {
      count: recentFilings.length,
      titles: recentFilings.slice(0, 3).map(s => s.headline),
    }

    // ── News (last 24h) ────────────────────────────────────────────────────
    const recentNews = coSignals.filter(s =>
      s.source === 'google-news' &&
      s.date >= cut24
    ).sort((a, b) => b.date.localeCompare(a.date))

    const news: DigestNewsEntry = {
      count: recentNews.length,
      topHeadline: recentNews[0]?.headline ?? null,
      topUrl: recentNews[0]?.url ?? null,
    }

    // ── Insider transactions (last 24h) ────────────────────────────────────
    const recentInsiders: InsiderTransaction[] = data.insiders.filter(
      t => t.company_id === coId && t.filing_date >= cut24
    )
    let netValue = 0
    for (const t of recentInsiders) {
      if (t.value_usd == null) continue
      // acquired_or_disposed 'A' = buy, 'D' = sell
      netValue += t.acquired_or_disposed === 'D' ? -(t.value_usd) : t.value_usd
    }
    const insider: DigestInsiderEntry = {
      netValueUsd: netValue,
      transactionCount: recentInsiders.length,
    }

    // ── Hiring delta (vs yesterday) ────────────────────────────────────────
    const coJobs: JobSnapshotRow[] = data.jobs
      .filter(j => j.company_id === coId)
      .sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date))
    const todayJobs   = coJobs[0] ?? null
    const yesterdayJobs = coJobs[1] ?? null
    const hiring: DigestHiringEntry = {
      current:   todayJobs?.total_open   ?? null,
      yesterday: yesterdayJobs?.total_open ?? null,
      delta: (todayJobs != null && yesterdayJobs != null)
        ? todayJobs.total_open - yesterdayJobs.total_open
        : null,
    }

    // ── Funding round (last 7d) ────────────────────────────────────────────
    const recentFunding: FundingRound[] = data.fundingRounds.filter(
      r => r.company_id === coId && r.filed_date >= cut7d
    ).sort((a, b) => b.filed_date.localeCompare(a.filed_date))
    const latestRound = recentFunding[0]
    const funding: DigestFundingEntry = {
      found: !!latestRound,
      amountUsd: latestRound?.total_amount_sold_usd ?? null,
      investors: latestRound?.investors_named ?? [],
      filedDate: latestRound?.filed_date ?? null,
    }

    // ── Model ELO (top model change vs prior snapshot) ─────────────────────
    const coLeaderboard: ModelLeaderboardEntry[] = data.modelLeaderboard.filter(
      e => e.company_id === coId
    ).sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date))

    // Group by model_name, take the latest two snapshots per model
    const byModel = new Map<string, ModelLeaderboardEntry[]>()
    for (const e of coLeaderboard) {
      const arr = byModel.get(e.model_name) ?? []
      arr.push(e)
      byModel.set(e.model_name, arr)
    }

    // Find the top-ranked model on the most recent snapshot date
    const latestDate = coLeaderboard[0]?.snapshot_date ?? null
    const latestEntries = latestDate
      ? coLeaderboard.filter(e => e.snapshot_date === latestDate)
      : []
    const topLatest = latestEntries.sort((a, b) => a.elo_rank - b.elo_rank)[0]

    let rankDelta: number | null = null
    if (topLatest) {
      const history = byModel.get(topLatest.model_name) ?? []
      const prev = history.find(e => e.snapshot_date < topLatest.snapshot_date)
      if (prev) rankDelta = prev.elo_rank - topLatest.elo_rank  // positive = improved
    }

    const elo: DigestEloEntry = {
      found: !!topLatest,
      modelName: topLatest?.model_name ?? null,
      currentRank: topLatest?.elo_rank ?? null,
      prevRank: topLatest ? (byModel.get(topLatest.model_name)?.find(e => e.snapshot_date < topLatest.snapshot_date)?.elo_rank ?? null) : null,
      rankDelta,
    }

    entries.push({
      companyId: coId,
      name: co.name,
      ticker: co.ticker,
      price,
      filings,
      news,
      insider,
      hiring,
      funding,
      elo,
    })
  }

  const anySignals = entries.some(e =>
    e.filings.count > 0 ||
    e.news.count > 0 ||
    e.insider.transactionCount > 0 ||
    e.funding.found ||
    e.elo.rankDelta !== null ||
    (e.price.pctChange !== null && Math.abs(e.price.pctChange) >= 2)
  )

  return {
    generatedAt: now.toISOString(),
    watchedCoIds,
    entries,
    anySignals,
  }
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmtPct(n: number): string {
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}%`
}

function fmtDollars(n: number): string {
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : '+'
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`
  return `${sign}$${abs.toFixed(0)}`
}

function fmtPrice(n: number | null): string {
  if (n == null) return '—'
  return n >= 1000
    ? `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
    : `$${n.toFixed(2)}`
}

function pctColor(pct: number | null): string {
  if (pct == null) return TOKENS.fg.secondary
  if (pct >= 2) return TOKENS.signal.healthy
  if (pct <= -2) return TOKENS.signal.alert
  return TOKENS.fg.secondary
}

// ---------------------------------------------------------------------------
// renderEmailHtml
// ---------------------------------------------------------------------------

const BASE_URL = 'https://compute-circuit.vercel.app'

export function renderEmailHtml(digest: Digest): string {
  const T = TOKENS
  const date = new Date(digest.generatedAt).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    timeZone: 'America/New_York',
  })

  const companyRows = digest.entries.map(entry => renderCompanyBlock(entry)).join('\n')

  // If nothing interesting, show a quiet note
  const bodyContent = digest.anySignals
    ? companyRows
    : `<tr><td style="padding:40px 32px;text-align:center;color:${T.fg.muted};font-size:14px;">
        All quiet overnight — no major price moves, filings, or insider activity on your watchlist.
       </td></tr>`

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Offtake Digest – ${date}</title>
</head>
<body style="margin:0;padding:0;background-color:${T.bg.canvas};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">

<!-- Outer wrapper -->
<table width="100%" cellpadding="0" cellspacing="0" border="0"
  style="background-color:${T.bg.canvas};min-height:100vh;">
<tr><td align="center" style="padding:32px 16px;">

<!-- Email card – 600px max -->
<table width="600" cellpadding="0" cellspacing="0" border="0"
  style="max-width:600px;width:100%;background-color:${T.bg.surface};border-radius:12px;
         border:1px solid ${T.border.default};overflow:hidden;">

  <!-- Header -->
  <tr>
    <td style="padding:28px 32px 20px;border-bottom:1px solid ${T.border.default};">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td>
            <div style="font-size:11px;font-weight:600;letter-spacing:0.12em;
              color:${T.accent.primary};text-transform:uppercase;margin-bottom:4px;">
              COMPUTE CIRCUIT
            </div>
            <div style="font-size:22px;font-weight:700;color:${T.fg.primary};
              line-height:1.2;">
              Overnight Digest
            </div>
            <div style="font-size:13px;color:${T.fg.muted};margin-top:4px;">
              ${date} · 8 AM ET
            </div>
          </td>
          <td align="right" valign="top">
            <a href="${BASE_URL}" style="font-size:12px;color:${T.accent.primary};
              text-decoration:none;font-weight:500;">
              Open App →
            </a>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Company rows -->
  ${bodyContent}

  <!-- Footer -->
  <tr>
    <td style="padding:20px 32px;border-top:1px solid ${T.border.default};">
      <div style="font-size:11px;color:${T.fg.dim};line-height:1.6;">
        You're receiving this because <strong style="color:${T.fg.muted};">DIGEST_EMAIL</strong>
        is set in your Vercel environment. To stop, remove that env var.<br />
        Data sources: SEC EDGAR · Yahoo Finance · Google News · USPTO · Greenhouse / Lever · LMArena
      </div>
    </td>
  </tr>

</table>
<!-- /card -->

</td></tr>
</table>
<!-- /outer -->

</body>
</html>`
}

// ---------------------------------------------------------------------------
// Per-company block
// ---------------------------------------------------------------------------

function renderCompanyBlock(e: DigestCompanyEntry): string {
  const T = TOKENS

  const priceColor = pctColor(e.price.pctChange)
  const priceLabel = e.price.pctChange != null
    ? fmtPct(e.price.pctChange)
    : '—'
  const priceSub = e.price.lastPrice != null
    ? `${fmtPrice(e.price.lastPrice)}`
    : 'N/A'

  // Hiring delta badge
  const hiringLabel = e.hiring.delta != null
    ? (e.hiring.delta > 0 ? `+${e.hiring.delta}` : `${e.hiring.delta}`)
    : e.hiring.current != null ? `${e.hiring.current}` : '—'
  const hiringColor = e.hiring.delta != null
    ? (e.hiring.delta > 0 ? T.signal.healthy : (e.hiring.delta < 0 ? T.signal.alert : T.fg.secondary))
    : T.fg.secondary

  // Insider net
  const insiderLabel = e.insider.transactionCount > 0
    ? fmtDollars(e.insider.netValueUsd)
    : '—'
  const insiderColor = e.insider.netValueUsd > 0
    ? T.signal.healthy
    : (e.insider.netValueUsd < 0 ? T.signal.alert : T.fg.secondary)

  // ELO rank
  const eloLabel = e.elo.found
    ? (e.elo.rankDelta != null
      ? (e.elo.rankDelta > 0 ? `↑${e.elo.rankDelta}` : (e.elo.rankDelta < 0 ? `↓${Math.abs(e.elo.rankDelta)}` : '='))
      : `#${e.elo.currentRank}`)
    : '—'
  const eloColor = e.elo.rankDelta != null
    ? (e.elo.rankDelta > 0 ? T.signal.healthy : (e.elo.rankDelta < 0 ? T.signal.alert : T.fg.secondary))
    : T.fg.muted

  // Funding badge
  const fundingLabel = e.funding.found
    ? (e.funding.amountUsd != null ? `$${(e.funding.amountUsd / 1_000_000).toFixed(0)}M round` : 'Round filed')
    : '—'

  // Stat mini-grid: 4 cells × 2 rows
  const stats: Array<{ label: string; value: string; color: string; sub?: string }> = [
    {
      label: 'Price Chg',
      value: priceLabel,
      color: priceColor,
      sub: priceSub,
    },
    {
      label: '8-K Filings',
      value: e.filings.count > 0 ? `${e.filings.count} new` : '—',
      color: e.filings.count > 0 ? T.feed.filings : T.fg.muted,
    },
    {
      label: 'News',
      value: e.news.count > 0 ? `${e.news.count} articles` : '—',
      color: e.news.count > 0 ? T.feed.news : T.fg.muted,
    },
    {
      label: 'Insider Net',
      value: insiderLabel,
      color: insiderColor,
      sub: e.insider.transactionCount > 0 ? `${e.insider.transactionCount} txn` : undefined,
    },
    {
      label: 'Open Roles',
      value: hiringLabel,
      color: hiringColor,
      sub: e.hiring.current != null ? `total ${e.hiring.current}` : undefined,
    },
    {
      label: 'Funding (7d)',
      value: fundingLabel,
      color: e.funding.found ? T.accent.secondary : T.fg.muted,
    },
    {
      label: 'Top ELO',
      value: eloLabel,
      color: eloColor,
      sub: e.elo.modelName ? truncate(e.elo.modelName, 18) : undefined,
    },
  ]


  // Split into rows of 4
  const row1Cells = stats.slice(0, 4)
  const row2Cells = stats.slice(4)

  function rowHtml(cells: typeof stats) {
    return `<table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        ${cells.map(s => `
        <td width="${Math.floor(100 / cells.length)}%" style="padding:10px 8px;vertical-align:top;">
          <div style="font-size:10px;font-weight:600;letter-spacing:0.08em;
            color:${T.fg.muted};text-transform:uppercase;margin-bottom:4px;">
            ${esc(s.label)}
          </div>
          <div style="font-size:17px;font-weight:700;color:${s.color};line-height:1.1;">
            ${esc(s.value)}
          </div>
          ${s.sub ? `<div style="font-size:10px;color:${T.fg.dim};margin-top:2px;">${esc(s.sub)}</div>` : ''}
        </td>`).join('')}
      </tr>
    </table>`
  }

  // Supplemental: top headline + 8-K title
  const suppLines: string[] = []
  if (e.news.topHeadline) {
    const newsLink = e.news.topUrl
      ? `<a href="${esc(e.news.topUrl)}" style="color:${T.feed.news};text-decoration:none;">${esc(truncate(e.news.topHeadline, 90))}</a>`
      : esc(truncate(e.news.topHeadline, 90))
    suppLines.push(`<div style="font-size:12px;color:${T.fg.secondary};padding:6px 0 0;">
      <span style="color:${T.feed.news};font-weight:600;">NEWS</span>
      &nbsp;${newsLink}
    </div>`)
  }
  if (e.filings.titles.length > 0) {
    suppLines.push(`<div style="font-size:12px;color:${T.fg.secondary};padding:4px 0 0;">
      <span style="color:${T.feed.filings};font-weight:600;">8-K</span>
      &nbsp;${esc(truncate(e.filings.titles[0], 90))}
    </div>`)
  }
  if (e.funding.found && e.funding.investors.length > 0) {
    suppLines.push(`<div style="font-size:12px;color:${T.fg.secondary};padding:4px 0 0;">
      <span style="color:${T.accent.secondary};font-weight:600;">FUNDING</span>
      &nbsp;Investors: ${esc(e.funding.investors.slice(0, 3).join(', '))}
    </div>`)
  }

  const suppHtml = suppLines.length > 0
    ? `<td style="padding:0 16px 14px;">
        <div style="border-top:1px solid ${T.border.subtle};padding-top:10px;">
          ${suppLines.join('\n')}
        </div>
       </td>`
    : ''

  const focusUrl = `${BASE_URL}/?focus=${encodeURIComponent(e.companyId)}`

  return `
  <!-- Company: ${esc(e.name)} -->
  <tr>
    <td style="padding:16px 16px 0;border-top:1px solid ${T.border.default};">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td>
            <a href="${esc(focusUrl)}" style="text-decoration:none;">
              <span style="font-size:15px;font-weight:700;color:${T.fg.primary};">
                ${esc(e.name)}
              </span>
              ${e.ticker ? `<span style="font-size:11px;color:${T.fg.muted};margin-left:6px;font-weight:500;">${esc(e.ticker)}</span>` : ''}
            </a>
          </td>
          <td align="right">
            <a href="${esc(focusUrl)}" style="font-size:11px;color:${T.accent.primary};
              text-decoration:none;font-weight:500;">
              Focus →
            </a>
          </td>
        </tr>
      </table>
      <div style="margin:10px -8px 0;">
        ${rowHtml(row1Cells)}
        ${row2Cells.length > 0 ? rowHtml(row2Cells) : ''}
      </div>
    </td>
  </tr>
  ${suppHtml ? `<tr>${suppHtml}</tr>` : ''}
`
}

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function truncate(s: string, maxLen: number): string {
  return s.length <= maxLen ? s : s.slice(0, maxLen - 1) + '…'
}

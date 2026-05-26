/**
 * Three-question data verification report.
 *
 * Answers open tasks:
 *   #84  Verify mention counts for NVDA, MSFT, GOOGL, META, AMZN
 *   #95  Fetch actual GPU spot prices and report
 *   #100 Report TTM capex + YoY% for MSFT, GOOGL, AMZN, META, NVDA
 *
 * Writes a markdown report to /tmp/data-verification-2026-05.md so the
 * findings persist outside the console buffer.
 *
 * Usage: node scripts/data-verify-2026-05.js
 */

const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}
const sb = createClient(url, key)

const WATCH = ['nvda', 'msft', 'googl', 'meta', 'amzn']
const REPORT_PATH = '/tmp/data-verification-2026-05.md'

function fmtUsd(n) {
  if (n == null || !Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toFixed(2)}`
}

function fmtPct(prev, curr) {
  if (prev == null || curr == null || prev === 0) return '—'
  const pct = ((curr - prev) / Math.abs(prev)) * 100
  const sign = pct >= 0 ? '+' : ''
  return `${sign}${pct.toFixed(1)}%`
}

async function q1Mentions() {
  const onEightyDaysAgo = new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10)
  const lines = []
  lines.push('## Q1 — Transcript mention counts (last 180 days)')
  lines.push('')
  lines.push('| Ticker | Rows | Σ mention_count (ai_mention) | Latest filed_date |')
  lines.push('|---|---:|---:|---|')

  for (const t of WATCH) {
    // Find company by ticker (case-insensitive)
    const { data: cos, error: ce } = await sb
      .from('companies')
      .select('id, name, ticker')
      .ilike('ticker', t)
    if (ce) { lines.push(`| ${t} | ERR | — | ${ce.message} |`); continue }
    if (!cos || cos.length === 0) { lines.push(`| ${t} | NO_CO | — | — |`); continue }
    const co = cos[0]

    const { data: ts, error: te } = await sb
      .from('transcript_signals')
      .select('id, mention_count, signal_kind, filed_date, url')
      .eq('company_id', co.id)
      .gte('filed_date', onEightyDaysAgo)
      .order('filed_date', { ascending: false })
    if (te) { lines.push(`| ${t} | ERR | — | ${te.message} |`); continue }

    const rows = ts ?? []
    const sumAi = rows
      .filter(r => r.signal_kind === 'ai_mention')
      .reduce((acc, r) => acc + (r.mention_count ?? 0), 0)
    const latest = rows.length > 0 ? rows[0].filed_date : '—'
    lines.push(`| **${t.toUpperCase()}** (${co.name}) | ${rows.length} | ${sumAi} | ${latest} |`)
  }
  return lines.join('\n')
}

async function q2GpuSpot() {
  const lines = []
  lines.push('## Q2 — GPU spot pricing (latest vs 7d ago)')
  lines.push('')

  const models = ['H100 80GB SXM5', 'H100 80GB PCIe', 'H200', 'B200', 'A100 80GB']
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)

  // Pull last 14 days, then derive latest and ~7d-ago snapshot per model.
  const fourteenDaysAgo = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10)
  const { data, error } = await sb
    .from('gpu_spot_prices')
    .select('model, median_usd_per_hr, snapshot_date, sample_count')
    .gte('snapshot_date', fourteenDaysAgo)
    .order('snapshot_date', { ascending: false })
  if (error) { return `## Q2 — GPU spot pricing\n\nERROR: ${error.message}` }

  lines.push('| Model | Latest median $/hr | n | 7d-ago median | Δ % |')
  lines.push('|---|---:|---:|---:|---:|')

  for (const model of models) {
    const rows = (data ?? []).filter(r => r.model === model)
    if (rows.length === 0) {
      lines.push(`| ${model} | — | — | — | NO DATA |`)
      continue
    }
    const latest = rows[0]
    // Find first row with snapshot_date <= 7d ago.
    const old = rows.find(r => r.snapshot_date <= sevenDaysAgo)
    const pct = old ? ((latest.median_usd_per_hr - old.median_usd_per_hr) / old.median_usd_per_hr) * 100 : null
    const flag = pct != null && Math.abs(pct) > 15 ? ' ⚠️' : ''
    lines.push(`| ${model} | $${latest.median_usd_per_hr.toFixed(3)} | ${latest.sample_count} | ${old ? `$${old.median_usd_per_hr.toFixed(3)}` : '—'} | ${pct != null ? pct.toFixed(1) + '%' : '—'}${flag} |`)
  }
  lines.push('')
  lines.push('_⚠️ flags movements > ±15% over the trailing week._')
  return lines.join('\n')
}

async function q3Capex() {
  const lines = []
  lines.push('## Q3 — TTM capex + YoY% (latest 4Q vs prior 4Q)')
  lines.push('')
  lines.push('| Ticker | TTM capex | Prior TTM | YoY % |')
  lines.push('|---|---:|---:|---:|')

  for (const t of WATCH) {
    const { data: cos, error: ce } = await sb
      .from('companies')
      .select('id, name, ticker')
      .ilike('ticker', t)
    if (ce || !cos || cos.length === 0) {
      lines.push(`| ${t} | ERR/NO_CO | — | — |`); continue
    }
    const co = cos[0]

    const { data: rows, error: fe } = await sb
      .from('fundamentals')
      .select('period, metric, value')
      .eq('company_id', co.id)
      .eq('metric', 'capex')
      .order('period', { ascending: false })
      .limit(20)
    if (fe) { lines.push(`| ${t} | ERR | — | ${fe.message} |`); continue }

    const capRows = (rows ?? []).filter(r => Number.isFinite(r.value))
    if (capRows.length < 8) {
      lines.push(`| **${t.toUpperCase()}** | ${capRows.length}Q only | — | — |`); continue
    }
    // Capex on the SEC companyfacts feed is reported as a NEGATIVE cashflow
    // line; we take absolute value to express it as a positive spend.
    const ttm = capRows.slice(0, 4).reduce((a, r) => a + Math.abs(r.value), 0)
    const prior = capRows.slice(4, 8).reduce((a, r) => a + Math.abs(r.value), 0)
    lines.push(`| **${t.toUpperCase()}** (${co.name}) | ${fmtUsd(ttm)} | ${fmtUsd(prior)} | ${fmtPct(prior, ttm)} |`)
  }
  return lines.join('\n')
}

async function main() {
  const stamp = new Date().toISOString()
  const sections = [
    `# Data verification report`,
    `_Generated ${stamp} — compute-circuit Supabase_`,
    '',
    await q1Mentions(),
    '',
    await q2GpuSpot(),
    '',
    await q3Capex(),
    '',
    '---',
    '_Re-run anytime: `node scripts/data-verify-2026-05.js`_',
  ]
  const md = sections.join('\n')
  fs.writeFileSync(REPORT_PATH, md)
  console.log(md)
  console.log(`\n— written to ${REPORT_PATH}`)
}

main().catch(e => { console.error(e); process.exit(1) })

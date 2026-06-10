/**
 * Zero-dependency test runner for the pure-function core.
 *
 * No vitest/jest — `npx tsx scripts/run-tests.ts` (aliased as `npm test`).
 * Each case here encodes a bug that actually shipped and got fixed; if one
 * fails, you are about to re-ship a known regression:
 *
 *   - rotatingWindow coverage hole (fixed-slot wrap duplicated window 0)
 *   - pickEarningsExhibit anchored-regex bug (Mag5 8-K cover pages scored
 *     as zero-mention press releases for weeks)
 *   - extractTranscriptSignal vendor-term lexicon (Mag5 counts 5-10x low)
 *   - computeCapexTTM YTD-cumulative semantics
 */
import { rotatingWindow } from '../src/lib/cron-window'
import { pickEarningsExhibit } from '../src/lib/edgar'
import { extractTranscriptSignal, stripHtml, totalMentions } from '../src/lib/transcripts'
import { computeCapexTTM } from '../src/lib/capex'
import type { Fundamental } from '../src/types/db'

let passed = 0
let failed = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

// ---------- rotatingWindow ----------
console.log('cron-window')
{
  const items = Array.from({ length: 363 }, (_, i) => ({ id: `co${String(i).padStart(3, '0')}` }))
  let allCovered = true
  for (const phase of [0, 1, 2, 3, 7, 100, 9999]) {
    const seen = new Set<string>()
    for (let d = phase; d < phase + Math.ceil(363 / 120); d++) {
      rotatingWindow(items, 120, new Date(d * 86_400_000)).forEach(x => seen.add(x.id))
    }
    if (seen.size !== 363) allCovered = false
  }
  check('any ⌈N/size⌉ consecutive days cover every item', allCovered)
  check('window size is exact', rotatingWindow(items, 120, new Date(0)).length === 120)
  check('small sets pass through whole', rotatingWindow([{ id: 'a' }, { id: 'b' }], 120).length === 2)
  const w1 = rotatingWindow(items, 120, new Date(5 * 86_400_000))
  const w2 = rotatingWindow([...items].reverse(), 120, new Date(5 * 86_400_000))
  check('window is stable regardless of input order', JSON.stringify(w1) === JSON.stringify(w2))
}

// ---------- pickEarningsExhibit ----------
console.log('edgar.pickEarningsExhibit')
{
  const pick = (names: Array<{ name: string; size?: string }>, primary: string) =>
    pickEarningsExhibit(names, primary, 123, '000123')?.split('/').pop() ?? null

  // Each filer's real-world naming convention (all previously fell through
  // the anchored ^ex regex to the XBRL cover page).
  check('Vertiv ex991', pick([{ name: 'vrt-20260211xex991.htm' }, { name: 'vrt-20260211.htm' }], 'vrt-20260211.htm') === 'vrt-20260211xex991.htm')
  check('MSFT ex99_1', pick([{ name: 'msft-ex99_1.htm' }, { name: 'msft-20260128.htm' }], 'msft-20260128.htm') === 'msft-ex99_1.htm')
  check('META exhibit991', pick([{ name: 'meta-03312026xexhibit991.htm' }, { name: 'meta-20260429.htm' }], 'meta-20260429.htm') === 'meta-03312026xexhibit991.htm')
  check('GOOGL exhibit991', pick([{ name: 'googexhibit991q12026.htm' }, { name: 'goog-20260429.htm' }], 'goog-20260429.htm') === 'googexhibit991q12026.htm')
  check('NVDA pr.htm (no ex99 at all)', pick([{ name: 'q1fy27pr.htm' }, { name: 'nvda-20260520.htm' }, { name: 'q1fy27cfocommentary.htm' }], 'nvda-20260520.htm') === 'q1fy27pr.htm')
  // Largest-non-cover fallback: no ex99, no pr — pick the big file.
  check('largest non-cover fallback', pick([
    { name: 'cover-20260101.htm', size: '40000' },
    { name: 'bigrelease.htm', size: '400000' },
  ], 'cover-20260101.htm') === 'bigrelease.htm')
  // Viewer-generated Rxx.htm files must never win.
  check('R-files excluded', pick([
    { name: 'r1.htm', size: '900000' },
    { name: 'cover.htm', size: '40000' },
  ], 'cover.htm') === null)
}

// ---------- transcripts lexicon ----------
console.log('transcripts')
{
  const text = `Azure AI revenue grew 40%. Copilot adoption accelerated across Microsoft 365.
    We deployed GB200 racks and additional H100 capacity in our data centers.
    Llama and Gemini competition intensified; Bedrock usage doubled. Capital expenditures were $19.0 billion.`
  const sig = extractTranscriptSignal(text)
  check('vendor terms count as AI mentions (Copilot/Llama/Gemini/Bedrock/Azure AI)', sig.ai_mentions >= 5, `got ${sig.ai_mentions}`)
  check('GB200 + H100 count as GPU mentions', sig.gpu_mentions >= 2, `got ${sig.gpu_mentions}`)
  check('capex counted', sig.capex_mentions >= 1)
  check('data centers counted', sig.data_center_mentions >= 1)
  check('capex+$ phrase extracted', sig.extracted_phrases.some(p => p.phrase.includes('19.0 billion')))

  const xbrlCover = '8-K 0000789019 false 0000789019 msft:NotesThreePointOneTwoFivePercent 2026-04-29'
  check('XBRL cover page scores zero', totalMentions(extractTranscriptSignal(xbrlCover)) === 0)
  check('stripHtml removes script/style', stripHtml('<style>p{}</style><p>AI &amp; GPUs</p><script>x()</script>') === 'AI & GPUs')
}

// ---------- computeCapexTTM ----------
console.log('capex')
{
  // SEC XBRL capex is YTD-cumulative within each fiscal year:
  // FY2025 (ends 12-31) = 40B. Q1-2026 YTD = 12B; Q1-2025 YTD was 8B.
  // TTM at Q1-2026 = FY25 + Q1'26 − Q1'25 = 44B.
  const now = new Date()
  const y = now.getUTCFullYear()
  const rows = [
    { company_id: 'x', period: `${y - 1}-12-31`, period_type: 'FY', metric: 'capex', value: 40e9 },
    { company_id: 'x', period: `${y}-03-31`, period_type: 'Q', metric: 'capex', value: 12e9 },
    { company_id: 'x', period: `${y - 1}-03-31`, period_type: 'Q', metric: 'capex', value: 8e9 },
    { company_id: 'x', period: `${y - 2}-12-31`, period_type: 'FY', metric: 'capex', value: 30e9 },
  ] as Fundamental[]
  const r = computeCapexTTM(rows, 'x')
  check('TTM = FY + newest-YTD − year-ago-YTD', r.ttm === 44e9, `got ${r.ttm}`)
  check('YoY vs prior FY', r.yoy_pct !== null && Math.abs(r.yoy_pct - (44 - 30) / 30 * 100) < 0.01, `got ${r.yoy_pct}`)
  check('empty input → nulls', computeCapexTTM([], 'x').ttm === null)
  const stale = [{ company_id: 'x', period: '2020-12-31', period_type: 'FY', metric: 'capex', value: 1e9 }] as Fundamental[]
  check('stale data (>18mo) → nulls', computeCapexTTM(stale, 'x').ttm === null)
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

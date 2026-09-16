/**
 * Zero-dependency test runner for the pure-function core.
 *
 * No vitest/jest — `npx tsx scripts/run-tests.ts` (aliased as `npm test`).
 * Each case here encodes a bug that actually shipped and got fixed; if one
 * fails, you are about to re-ship a known regression:
 *
 *   - pickEarningsExhibit anchored-regex bug (Mag5 8-K cover pages scored
 *     as zero-mention press releases for weeks)
 *   - extractTranscriptSignal vendor-term lexicon (Mag5 counts 5-10x low)
 */
import { pickEarningsExhibit } from '../src/lib/edgar'
import { extractTranscriptSignal, stripHtml, totalMentions } from '../src/lib/transcripts'
import { isPrivateAddr } from '../src/lib/ssrf-guard'
import { startBudget } from '../src/lib/cron-budget'
import { sampleRows, resolveId, formatReviewCard, wrap, type ReviewableRow } from '../src/lib/contracts/review'
import { splitLedgerByRole, lastNDaysRows, concentrationHistory, type LedgerRow } from '../src/lib/contract-ledger-data'
import { hasQuantityInfo, looksLikeCryptoMining, type ExtractedContract } from '../src/lib/contracts/extract'
import { shapeRow, dedupeByKey, type DisclosureRow } from '../src/lib/contracts/ledger'
import { formatAlertMessage } from '../src/lib/contracts/alerts'
import { clientIp, hourWindow } from '../src/lib/rate-limit'
import { escapeXml, toRfc822 } from '../src/lib/rss'

let passed = 0
let failed = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

// ---------- ssrf-guard.isPrivateAddr ----------
// Shipped bug: ipv4ToUint used signed `<<`, so every address >= 128.0.0.0
// went negative and read as 0.0.0.0/8. /api/logo returned 400 "forbidden
// domain" for anthropic.com, arm.com, greylock.com and roughly half the
// company table. The IPv6 prefix check was also reading 8 bits, not 16.
console.log('ssrf-guard.isPrivateAddr')
{
  const publicV4 = ['160.79.104.10', '217.140.110.36', '216.150.1.1', '8.8.8.8', '17.253.144.10', '223.255.255.254']
  const privateV4 = ['10.0.0.5', '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '100.64.0.1', '198.18.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255']
  check('public IPv4 (incl. first octet >= 128) is NOT private', publicV4.every(a => !isPrivateAddr(a)),
    publicV4.filter(isPrivateAddr).join(','))
  check('private/reserved IPv4 IS private', privateV4.every(isPrivateAddr),
    privateV4.filter(a => !isPrivateAddr(a)).join(','))
  const publicV6 = ['2606:4700::6812:1234', '2a00:1450:4001:80b::200e', '2001:db8::1']
  const privateV6 = ['::1', '::', 'fe80::1', 'fec0::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '::ffff:10.0.0.1', '::ffff:169.254.169.254']
  check('public IPv6 is NOT private', publicV6.every(a => !isPrivateAddr(a)), publicV6.filter(isPrivateAddr).join(','))
  check('loopback/link-local/ULA/multicast/mapped-private IPv6 IS private', privateV6.every(isPrivateAddr),
    privateV6.filter(a => !isPrivateAddr(a)).join(','))
  check('IPv4-mapped public v6 is NOT private', !isPrivateAddr('::ffff:160.79.104.10'))
  check('garbage is private (default deny)', isPrivateAddr('not-an-ip') && isPrivateAddr(''))
}

// ---------- cron-budget ----------
console.log('cron-budget')
{
  let t = 1_000
  const b = startBudget(500, () => t)
  check('fresh budget is not expired', !b.expired() && b.remaining() === 500 && b.elapsed() === 0)
  t = 1_499
  check('1ms before deadline still live', !b.expired() && b.remaining() === 1)
  t = 1_500
  check('expires exactly at deadline', b.expired() && b.remaining() === 0)
  t = 9_999
  check('remaining never goes negative', b.remaining() === 0 && b.elapsed() === 8_999)
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

// ---------- contracts/review ----------
console.log('contracts/review')
{
  const rows = Array.from({ length: 100 }, (_, i) => i)
  const a = sampleRows(rows, 30, 7)
  const b = sampleRows(rows, 30, 7)
  check('sample is deterministic per seed', a.join() === b.join())
  check('sample has no duplicates and right size', new Set(a).size === 30)
  check('different seed → different sample', sampleRows(rows, 30, 8).join() !== a.join())
  check('sample larger than population returns everything once', sampleRows([1, 2, 3], 10, 1).sort().join() === '1,2,3')
  const ids = ['3f9a1c2e-0000', '3f9a1c2f-0000', '91ee0000-0000']
  check('resolveId: unique prefix resolves', resolveId('91ee', ids) === '91ee0000-0000')
  let threw = ''
  try { resolveId('3f9a1c2', ids) } catch (e) { threw = (e as Error).message }
  check('resolveId: ambiguous prefix throws', /ambiguous/.test(threw), threw)
  try { resolveId('zzzz', ids) } catch (e) { threw = (e as Error).message }
  check('resolveId: unknown prefix throws', /no row/.test(threw), threw)
  check('wrap keeps every word and respects width', (() => {
    const w = wrap('a '.repeat(200).trim(), 40, '')
    return w.split('\n').every(l => l.length <= 40) && w.replace(/\n/g, ' ') === 'a '.repeat(200).trim()
  })())
  const row = {
    id: 'abcdef12-3456', provider_id: 'crwv', provider_name: 'CoreWeave', customer_id: 'openai', customer_name: 'OpenAI',
    customer_disclosed: true, guarantor_id: null, guarantor_name: null, kind: 'gpu_cloud_capacity', site: null,
    capacity_mw: 250, gpu_count: null, gpu_model: null, term_months: 60, start_date: '2026-01-01', end_date: null,
    total_value_usd: 11.9e9, annual_value_usd: null, prepayment_usd: null, has_extension_option: null, extension_note: null,
    escalator_pct: null, status: 'definitive', source_form: '8-K', source_accession: '0001-26-1', source_url: 'https://www.sec.gov/x',
    source_note: null, filing_date: '2026-03-10', filer_id: 'crwv', excerpt: 'a five-year, $11.9 billion agreement', extractor: 'm',
    confidence: 0.9, review_status: 'auto', dedupe_key: 'k', updated_at: 'now',
  } as ReviewableRow
  const card = formatReviewCard(row, 3)
  check('card carries id prefix, parties, money, term, excerpt and URL',
    card.includes('#3  abcdef12') && card.includes('CoreWeave  →  OpenAI') && card.includes('$11.90B') &&
    card.includes('term 60mo') && card.includes('$11.9 billion agreement') && card.includes('https://www.sec.gov/x'))
}

// ---------- contract-ledger-data.splitLedgerByRole ----------
// /company/[id] shows a company's rows as provider and as customer. A filer
// that discloses its own purchase (provider_id === customer_id) must appear
// once, not in both tables, or its MW and $ would be double-counted.
console.log('contract-ledger-data.splitLedgerByRole')
{
  const mk = (id: string, p: string | null, c: string | null, g: string | null = null) =>
    ({ id, provider_id: p, customer_id: c, guarantor_id: g } as unknown as LedgerRow)
  const rows = [mk('a', 'crwv', 'openai'), mk('b', 'corz', 'crwv'), mk('c', 'crwv', 'crwv'), mk('d', 'apld', 'x', 'crwv'), mk('e', 'nbis', 'msft')]
  const s = splitLedgerByRole(rows, 'crwv')
  check('provider rows', s.asProvider.map(r => r.id).join() === 'a,c')
  check('customer rows exclude self-dealing duplicate', s.asCustomer.map(r => r.id).join() === 'b')
  check('guarantor rows', s.asGuarantor.map(r => r.id).join() === 'd')
  check('unrelated rows dropped', s.asProvider.length + s.asCustomer.length + s.asGuarantor.length === 4)
  check('unknown company → all empty', (() => { const e = splitLedgerByRole(rows, 'nobody'); return !e.asProvider.length && !e.asCustomer.length && !e.asGuarantor.length })())
}

// ---------- contracts/extract.hasQuantityInfo ----------
// A named party with no MW, GPU count, term, or dollar figure at all isn't
// a contract disclosure -- often a marketing "customer wins" bullet lifted
// into a row by mistake. Reject it before it reaches the ledger.
console.log('contracts/extract.hasQuantityInfo')
{
  const mkContract = (overrides: Partial<ExtractedContract> = {}): ExtractedContract => ({
    provider_name: 'CoreWeave', customer_name: 'OpenAI', guarantor_name: null,
    kind: 'gpu_cloud_capacity', site: null, capacity_mw: null, gpu_count: null, gpu_model: null,
    term_months: null, start_date: null, end_date: null, total_value_usd: null, annual_value_usd: null,
    prepayment_usd: null, has_extension_option: null, extension_note: null, escalator_pct: null,
    status: 'definitive', excerpt: 'a five-year agreement', confidence: 0.9, ...overrides,
  })
  check('bare name, no numbers → rejected', hasQuantityInfo(mkContract()) === false)
  check('capacity_mw alone → kept', hasQuantityInfo(mkContract({ capacity_mw: 250 })))
  check('total_value_usd alone → kept', hasQuantityInfo(mkContract({ total_value_usd: 1e9 })))
  check('gpu_count alone → kept', hasQuantityInfo(mkContract({ gpu_count: 1000 })))
}

// ---------- contracts/extract.looksLikeCryptoMining ----------
// Backstop for the crypto-mining scope exclusion: a 252-row manual review
// found ASIC-miner and bitcoin-hosting content leaking through tagged as
// equipment_purchase, power_supply, hosting_services, colocation_lease,
// financing and other -- every kind, not just the "other" loophole fixed
// earlier. This filter rejects on the excerpt/party text itself, so it
// catches a leak regardless of what kind the model assigned.
console.log('contracts/extract.looksLikeCryptoMining')
{
  const mkContract = (overrides: Partial<ExtractedContract> = {}): ExtractedContract => ({
    provider_name: 'CoreWeave', customer_name: 'OpenAI', guarantor_name: null,
    kind: 'gpu_cloud_capacity', site: null, capacity_mw: null, gpu_count: null, gpu_model: null,
    term_months: null, start_date: null, end_date: null, total_value_usd: null, annual_value_usd: null,
    prepayment_usd: null, has_extension_option: null, extension_note: null, escalator_pct: null,
    status: 'definitive', excerpt: 'a five-year agreement', confidence: 0.9, ...overrides,
  })
  check('AI/HPC contract → not flagged', !looksLikeCryptoMining(mkContract()))
  check('Bitmain in excerpt → flagged', looksLikeCryptoMining(mkContract({ excerpt: '27,000 Bitmain S19J XP miners' })))
  check('Antminer in excerpt → flagged', looksLikeCryptoMining(mkContract({ excerpt: 'purchase of Antminer units' })))
  check('MicroBT provider name → flagged', looksLikeCryptoMining(mkContract({ provider_name: 'MicroBT' })))
  check('Blockware customer name → flagged', looksLikeCryptoMining(mkContract({ customer_name: 'Blockware Solutions' })))
  check('"bitcoin mining" phrase → flagged', looksLikeCryptoMining(mkContract({ excerpt: 'expand its bitcoin mining fleet' })))
  check('EH/s hashrate unit → flagged', looksLikeCryptoMining(mkContract({ excerpt: 'adding 5.2 EH/s of hashrate' })))
  check('kind=equipment_purchase does not exempt a crypto excerpt', looksLikeCryptoMining(mkContract({ kind: 'equipment_purchase', excerpt: 'Bitmain Antminer purchase agreement' })))
  check('unrelated equipment purchase → not flagged', !looksLikeCryptoMining(mkContract({ kind: 'equipment_purchase', excerpt: 'purchase of NVIDIA GB300 NVL72 servers' })))
  // Real leak found by the 102-row review pass (2026-09-16): "digital asset
  // mining" is a euphemism for bitcoin mining that slipped past every
  // existing marker.
  check('"digital asset mining" euphemism → flagged', looksLikeCryptoMining(mkContract({ excerpt: 'development of a 100 megawatt digital asset mining operation' })))
}

// ---------- contracts/ledger.shapeRow & dedupeByKey ----------
console.log('contracts/ledger.shapeRow & dedupeByKey')
{
  const ctx = { filerId: 'crwv', form: '8-K', accession: '0001-26-1', filingDate: '2026-03-10', sourceUrl: 'https://www.sec.gov/x', extractor: 'm' }
  const named = shapeRow({
    provider_name: 'CoreWeave', customer_name: 'OpenAI', guarantor_name: null, kind: 'gpu_cloud_capacity',
    site: null, capacity_mw: 250, gpu_count: null, gpu_model: null, term_months: 60, start_date: null, end_date: null,
    total_value_usd: 11.9e9, annual_value_usd: null, prepayment_usd: null, has_extension_option: null,
    extension_note: null, escalator_pct: null, status: 'definitive', excerpt: 'x', confidence: 0.9,
  }, ctx)
  check('customer_disclosed derived true when customer_name present', named.customer_disclosed === true)
  check('customer_id resolved when customer_name present', named.customer_id === 'openai')
  const undisclosed = shapeRow({
    provider_name: 'CoreWeave', customer_name: null, guarantor_name: null, kind: 'gpu_cloud_capacity',
    site: null, capacity_mw: 250, gpu_count: null, gpu_model: null, term_months: 60, start_date: null, end_date: null,
    total_value_usd: null, annual_value_usd: null, prepayment_usd: null, has_extension_option: null,
    extension_note: null, escalator_pct: null, status: 'definitive', excerpt: 'x', confidence: 0.9,
  }, ctx)
  check('customer_disclosed derived false when customer_name null', undisclosed.customer_disclosed === false)
  check('customer_id null when customer_name null', undisclosed.customer_id === null)

  const mkRow = (key: string, updated_at: string) => ({ ...named, dedupe_key: key, updated_at } as DisclosureRow)
  const deduped = dedupeByKey([mkRow('k1', 't1'), mkRow('k2', 't1'), mkRow('k1', 't2')])
  check('same-key rows collapse to the last occurrence', deduped.length === 2 && deduped.find(r => r.dedupe_key === 'k1')?.updated_at === 't2')
}

// ---------- contracts/alerts.formatAlertMessage ----------
console.log('contracts/alerts.formatAlertMessage')
{
  const mkRow = (overrides: Partial<DisclosureRow> = {}): DisclosureRow => ({
    provider_id: 'crwv', provider_name: 'CoreWeave', customer_id: 'openai', customer_name: 'OpenAI',
    customer_disclosed: true, guarantor_id: null, guarantor_name: null, kind: 'gpu_cloud_capacity', site: null,
    capacity_mw: 250, gpu_count: null, gpu_model: null, term_months: 60, start_date: null, end_date: null,
    total_value_usd: 11.9e9, annual_value_usd: null, prepayment_usd: null, has_extension_option: null,
    extension_note: null, escalator_pct: null, status: 'definitive', source_form: '8-K', source_accession: 'a1',
    source_url: 'https://www.sec.gov/x', source_note: null, filing_date: '2026-03-10', filer_id: 'crwv',
    excerpt: 'x', extractor: 'm', confidence: 0.9, review_status: 'auto', dedupe_key: 'k',
    updated_at: 'now', ...overrides,
  })
  const one = formatAlertMessage([mkRow()])
  check('singular row count in header', one.startsWith('1 new contract disclosure in'))
  check('includes provider, customer, kind and value', one.includes('CoreWeave → OpenAI (gpu_cloud_capacity)') && one.includes('$11.90B'))

  const undisclosed = formatAlertMessage([mkRow({ customer_disclosed: false, customer_name: null })])
  check('undisclosed customer rendered as "undisclosed"', undisclosed.includes('→ undisclosed'))

  const plural = formatAlertMessage([mkRow(), mkRow()])
  check('plural row count in header', plural.startsWith('2 new contract disclosures in'))

  const many = formatAlertMessage(Array.from({ length: 13 }, () => mkRow()))
  check('caps at 10 lines with an overflow note', many.includes('…and 3 more') && many.split('\n').filter(l => l.startsWith('•')).length === 10)
}

// ---------- rate-limit.clientIp & hourWindow ----------
console.log('rate-limit.clientIp & hourWindow')
{
  check('first entry of x-forwarded-for wins', clientIp(new Headers({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' })) === '1.2.3.4')
  check('falls back to x-real-ip', clientIp(new Headers({ 'x-real-ip': '9.9.9.9' })) === '9.9.9.9')
  check('falls back to a constant when neither header is present', clientIp(new Headers()) === 'unknown')
  check('hourWindow floors to the top of the hour', hourWindow(new Date('2026-03-10T14:37:22.123Z')) === '2026-03-10T14:00:00.000Z')
  check('hourWindow is stable within the same hour', hourWindow(new Date('2026-03-10T14:01:00Z')) === hourWindow(new Date('2026-03-10T14:59:59Z')))
}

// ---------- contract-ledger-data.lastNDaysRows ----------
// The /wire page and its RSS feed both window the ledger to "the last 7
// days" — same function, so the page and the feed can never disagree.
console.log('contract-ledger-data.lastNDaysRows')
{
  const mk = (id: string, filing_date: string) => ({ id, filing_date } as unknown as LedgerRow)
  const now = new Date('2026-09-15T12:00:00Z')
  const rows = [
    mk('today', '2026-09-15'),
    mk('6-days-ago', '2026-09-09'),
    mk('8-days-ago', '2026-09-07'),
    mk('old', '2026-01-01'),
  ]
  const win = lastNDaysRows(rows, 7, now)
  check('keeps rows within the window, drops older ones', win.map(r => r.id).join() === 'today,6-days-ago')
  check('sorts newest filing_date first regardless of input order', (() => {
    const shuffled = [mk('a', '2026-09-10'), mk('b', '2026-09-15'), mk('c', '2026-09-12')]
    return lastNDaysRows(shuffled, 7, now).map(r => r.id).join() === 'b,c,a'
  })())
  check('zero matches → empty array, not an error', lastNDaysRows([mk('old', '2020-01-01')], 7, now).length === 0)
}

// ---------- rss.escapeXml / rss.toRfc822 ----------
// Provider/customer names routinely carry `&` ("AT&T", "Bain Capital &
// Co"); an unescaped feed is invalid XML and most readers just drop it.
console.log('rss.escapeXml / rss.toRfc822')
{
  check('escapes the five XML entities', escapeXml(`AT&T <deal> "big" 'co'`) === 'AT&amp;T &lt;deal&gt; &quot;big&quot; &apos;co&apos;')
  check('leaves plain text untouched', escapeXml('CoreWeave to OpenAI') === 'CoreWeave to OpenAI')
  check('RFC 822 date from YYYY-MM-DD', toRfc822('2026-09-10') === 'Thu, 10 Sep 2026 00:00:00 GMT')
}

// ---------- contract-ledger-data.concentrationHistory ----------
// A lender wants to see concentration risk building, not just today's
// number — one snapshot per filing date, cumulative through that date.
console.log('contract-ledger-data.concentrationHistory')
{
  const mk = (overrides: Partial<LedgerRow>): LedgerRow => ({
    id: 'x', provider_id: 'crwv', provider_name: 'CoreWeave', customer_id: null, customer_name: null,
    customer_disclosed: false, guarantor_id: null, guarantor_name: null, kind: 'gpu_cloud_capacity', site: null,
    capacity_mw: null, gpu_count: null, gpu_model: null, term_months: null, start_date: null, end_date: null,
    total_value_usd: null, annual_value_usd: null, prepayment_usd: null, has_extension_option: null,
    extension_note: null, escalator_pct: null, status: 'definitive', source_form: '8-K', source_accession: 'a',
    source_url: null, source_note: null, filing_date: '2026-01-01', filer_id: 'crwv', excerpt: null,
    extractor: 'm', confidence: 0.9, review_status: 'auto', ...overrides,
  })

  // Day 1: OpenAI alone (100% concentrated). Day 2: Meta joins at equal
  // size, diluting OpenAI to 50%.
  const rows = [
    mk({ filing_date: '2026-01-01', customer_id: 'openai', customer_name: 'OpenAI', customer_disclosed: true, total_value_usd: 10e9 }),
    mk({ filing_date: '2026-06-01', customer_id: 'meta', customer_name: 'Meta', customer_disclosed: true, total_value_usd: 10e9 }),
  ]
  const hist = concentrationHistory(rows)
  check('one snapshot per distinct filing date', hist.length === 2)
  check('snapshots are date-ordered', hist[0].asOfDate === '2026-01-01' && hist[1].asOfDate === '2026-06-01')
  check('day 1 is fully concentrated in the only customer', hist[0].topCustomer === 'OpenAI' && hist[0].topShare === 1)
  check('day 2 cumulative value includes both filings', hist[1].valueUsd === 20e9)
  check('day 2 concentration dilutes to 50/50 (topShare 0.5)', hist[1].topShare === 0.5)

  const sameDate = [
    mk({ filing_date: '2026-03-01', customer_id: 'a', customer_name: 'A', customer_disclosed: true, total_value_usd: 1e9 }),
    mk({ filing_date: '2026-03-01', customer_id: 'b', customer_name: 'B', customer_disclosed: true, total_value_usd: 1e9 }),
  ]
  check('rows filed the same day collapse into one snapshot', concentrationHistory(sameDate).length === 1)

  const withTerminated = [...rows, mk({ filing_date: '2026-09-01', status: 'terminated', customer_id: 'x', total_value_usd: 999e9 })]
  check('terminated rows are excluded, matching concentrationByProvider', concentrationHistory(withTerminated).length === 2)

  check('fewer than 2 filing dates → still returns what it has (page hides it, not this function)',
    concentrationHistory([rows[0]]).length === 1)

  const outOfOrder = [rows[1], rows[0]]
  check('input order does not matter — sorted internally', concentrationHistory(outOfOrder).map(s => s.asOfDate).join() === '2026-01-01,2026-06-01')

  // A provider disclosed as its own customer (e.g. an internal
  // restructuring between subsidiaries resolving to the same company)
  // must never show up as its own "top customer" -- meaningless for the
  // credit-risk question this view answers. Real bug found live: TeraWulf
  // appeared as its own top customer on /contracts.
  const selfDealing = [
    mk({ filing_date: '2026-01-01', customer_id: 'crwv', customer_name: 'CoreWeave', customer_disclosed: true, total_value_usd: 999e9 }),
    mk({ filing_date: '2026-02-01', customer_id: 'openai', customer_name: 'OpenAI', customer_disclosed: true, total_value_usd: 1e9 }),
  ]
  const selfHist = concentrationHistory(selfDealing)
  check('self-dealing row excluded from concentration entirely', selfHist[selfHist.length - 1].topCustomer === 'OpenAI')
  check('self-dealing row does not inflate valueUsd', selfHist[selfHist.length - 1].valueUsd === 1e9)
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

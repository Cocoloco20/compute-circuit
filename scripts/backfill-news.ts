/**
 * One-shot news backfill — walks all 2,461 cos in chunks of 25 and pulls
 * Google News RSS for each. Bypasses the Vercel 60s cron cap.
 *
 * The /api/cron/news route fans out all 2,461 in one go (chunkSize=12 parallel,
 * so 2,461/12 = 205 waves × ~1s = 200-400s) which times out at 60s. This
 * script does the same work but with no timeout cap.
 *
 * IDEMPOTENT — signal upserts use source_key = "news:{co_id}:{link}" which
 * dedups on re-run. Old signals stay; only new ones land.
 *
 * Run: npx tsx scripts/backfill-news.ts
 * Optional: --only msft,googl  — scope to specific cos
 */
import { createClient } from '@supabase/supabase-js'
import * as path from 'path'
import { config } from 'dotenv'
import { fetchGoogleNewsRss } from '../src/lib/news'

config({ path: path.join(__dirname, '..', '.env.local') })
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('Missing env'); process.exit(1) }
const sb = createClient(url, key)

const args = process.argv.slice(2)
const ONLY = (() => {
  const i = args.indexOf('--only')
  return i >= 0 ? args[i + 1].split(',').map(s => s.trim()) : null
})()
const PER_COMPANY_CAP = 8
const CHUNK_SIZE = 25
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

interface CoRow { id: string; ticker: string | null; name: string }
interface SignalInsert {
  date: string
  source: string
  headline: string
  url: string
  form_type: string
  source_key: string
  impact: string | null
}

async function fetchAllCompanies(): Promise<CoRow[]> {
  // Paginate — Supabase default cap is 1000 rows per request, which silently
  // truncates queries against the 2,461-row companies table.
  const PAGE = 1000
  let from = 0
  const out: CoRow[] = []
  for (;;) {
    let q = sb.from('companies').select('id, ticker, name').range(from, from + PAGE - 1).order('id')
    if (ONLY) q = q.in('id', ONLY)
    const { data, error } = await q
    if (error) throw error
    const batch = (data ?? []) as CoRow[]
    out.push(...batch)
    if (batch.length < PAGE) break
    from += PAGE
  }
  return out
}

async function main() {
  const cos = await fetchAllCompanies()
  console.log(`Walking ${cos.length} cos in chunks of ${CHUNK_SIZE}...`)

  const signalRows: SignalInsert[] = []
  const linkPairs: Array<{ companyId: string; sourceKey: string }> = []
  let totalFetched = 0
  let chunkN = 0
  const startedAt = Date.now()

  for (let i = 0; i < cos.length; i += CHUNK_SIZE) {
    chunkN++
    const chunk = cos.slice(i, i + CHUNK_SIZE)
    const results = await Promise.all(chunk.map(async (co) => {
      const query = co.ticker ? `${co.ticker} stock` : co.name
      try {
        const news = await fetchGoogleNewsRss(query)
        return { co, news }
      } catch {
        return { co, news: [] }
      }
    }))
    for (const { co, news } of results) {
      totalFetched += news.length
      for (const n of news.slice(0, PER_COMPANY_CAP)) {
        const sourceKey = `news:${co.id}:${n.link}`
        signalRows.push({
          date: n.pubDate.slice(0, 10),
          source: 'google-news',
          headline: n.title,
          url: n.link,
          form_type: 'news',
          source_key: sourceKey,
          impact: n.source || null,
        })
        linkPairs.push({ companyId: co.id, sourceKey })
      }
    }
    if (chunkN % 4 === 0 || i + CHUNK_SIZE >= cos.length) {
      const pct = Math.min(100, Math.round((i + CHUNK_SIZE) / cos.length * 100))
      const ela = ((Date.now() - startedAt) / 1000).toFixed(0)
      console.log(`  chunk ${chunkN} — ${pct}% (${i + CHUNK_SIZE}/${cos.length}) — ${ela}s — ${signalRows.length} signals queued`)
    }
    // Slight pacing between chunks — Google News doesn't love sustained 25-rps.
    await sleep(120)
  }

  if (signalRows.length === 0) { console.log('No news rows.'); return }

  console.log(`\nUpserting ${signalRows.length} signals in chunks of 500...`)

  // Chunked upsert. onConflict on source_key (signals.source_key unique idx).
  let upserted = 0
  const insertedSigIds = new Map<string, string>()  // source_key → id
  const CHUNK_UP = 500
  for (let i = 0; i < signalRows.length; i += CHUNK_UP) {
    const slice = signalRows.slice(i, i + CHUNK_UP)
    const upResp = await (sb.from('signals') as unknown as {
      upsert: (rows: SignalInsert[], opts: { onConflict: string; ignoreDuplicates: boolean }) =>
        { select: (cols: string) => Promise<{ data: Array<{ id: string; source_key: string }> | null; error: { message: string } | null }> }
    }).upsert(slice, { onConflict: 'source_key', ignoreDuplicates: false }).select('id, source_key')
    if (upResp.error) { console.error('upsert err:', upResp.error.message); process.exit(1) }
    for (const r of (upResp.data ?? [])) insertedSigIds.set(r.source_key, r.id)
    upserted += slice.length
  }
  console.log(`✓ Upserted ${upserted} signals.`)

  // Link signals to companies via signal_companies join table.
  const links: Array<{ signal_id: string; company_id: string }> = []
  for (const { companyId, sourceKey } of linkPairs) {
    const sigId = insertedSigIds.get(sourceKey)
    if (sigId) links.push({ signal_id: sigId, company_id: companyId })
  }
  if (links.length > 0) {
    console.log(`Linking ${links.length} signal→company rows...`)
    for (let i = 0; i < links.length; i += CHUNK_UP) {
      const slice = links.slice(i, i + CHUNK_UP)
      const r = await (sb.from('signal_companies') as unknown as {
        upsert: (rows: typeof links, opts: { onConflict: string; ignoreDuplicates: boolean }) =>
          Promise<{ error: { message: string } | null }>
      }).upsert(slice, { onConflict: 'signal_id,company_id', ignoreDuplicates: true })
      if (r.error) console.warn('link err:', r.error.message)
    }
  }

  console.log(`\nDone. Total fetched: ${totalFetched} | Signals upserted: ${upserted} | Time: ${((Date.now() - startedAt) / 1000).toFixed(0)}s`)
}

main().catch(e => { console.error(e); process.exit(1) })

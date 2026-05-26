/**
 * One-shot fundamentals backfill — re-fetches SEC companyfacts for every
 * public CIKed co and re-upserts. Bypasses the Vercel 60s cap on
 * /api/cron/fundamentals.
 *
 * Run after src/lib/market.ts changes (e.g. the `frame`-aware disambiguation
 * fix that prevents AMZN's PaymentsToAcquireProductiveAssets lifetime
 * cumulative from being mistaken for a quarterly).
 *
 * Optionally scope: --only nvda,amzn
 */
import { createClient } from '@supabase/supabase-js'
import * as path from 'path'
import { config } from 'dotenv'
import { fetchEdgarFundamentals } from '../src/lib/market'

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
const MAX_PER_METRIC = 16
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

interface InsertRow {
  company_id: string
  period: string
  period_type: 'Q' | 'FY'
  metric: string
  value: number
  unit: string
  source: string
  updated_at: string
}

async function main() {
  let q = sb.from('companies').select('id, cik, name').eq('private', false).not('cik', 'is', null)
  if (ONLY) q = q.in('id', ONLY)
  const { data, error } = await q
  if (error) { console.error(error); process.exit(1) }
  const cos = (data ?? []).filter((c: { cik: string | null }) => c.cik) as Array<{ id: string; cik: string; name: string }>
  console.log(`Walking ${cos.length} public CIKed cos…`)

  const rows: InsertRow[] = []
  const now = new Date().toISOString()
  for (const co of cos) {
    try {
      const parsed = await fetchEdgarFundamentals(co.cik, MAX_PER_METRIC)
      for (const p of parsed) {
        rows.push({
          company_id: co.id,
          period: p.period,
          period_type: p.period_type,
          metric: p.metric,
          value: p.value,
          unit: p.unit,
          source: 'sec-companyfacts',
          updated_at: now,
        })
      }
      console.log(`  ${co.id.padEnd(20)} ${parsed.length} rows`)
    } catch (e) {
      console.log(`  ⨯ ${co.id}: ${e instanceof Error ? e.message : e}`)
    }
    await sleep(150) // SEC rate-limit politeness
  }
  if (rows.length === 0) { console.log('Nothing to upsert.'); return }

  // Chunked upsert. onConflict on (company_id, period, period_type, metric).
  const CHUNK = 200
  let upserted = 0
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK)
    const { error: upErr } = await (sb.from('fundamentals') as unknown as {
      upsert: (rows: InsertRow[], opts: { onConflict: string; ignoreDuplicates: boolean }) =>
        Promise<{ error: { message: string } | null }>
    }).upsert(slice, { onConflict: 'company_id,period,period_type,metric', ignoreDuplicates: false })
    if (upErr) { console.error('upsert err:', upErr.message); process.exit(1) }
    upserted += slice.length
  }
  console.log(`\n✓ Upserted ${upserted} fundamentals rows.`)
}

main().catch(e => { console.error(e); process.exit(1) })

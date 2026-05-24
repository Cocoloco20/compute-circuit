/**
 * One-time backfill: populate companies.cik from SEC's ticker-CIK map.
 *
 *   npm run backfill:ciks
 *
 * Re-runnable. Only updates rows where cik is currently NULL or stale.
 */

import { config } from 'dotenv'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { fetchTickerCikMap } from '../../src/lib/edgar'
import type { Database } from '../../src/types/db'

config({ path: resolve(process.cwd(), '.env.local') })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const sb = createClient<Database>(url, key, { auth: { persistSession: false } })

async function main() {
  console.log('→ fetching SEC ticker→CIK map…')
  const map = await fetchTickerCikMap()
  console.log(`  got ${map.size} ticker entries`)

  const { data: companies, error } = await sb
    .from('companies')
    .select('id, ticker, name, cik')
    .not('ticker', 'is', null) as { data: Array<{ id: string; ticker: string | null; name: string; cik: string | null }> | null; error: unknown }

  if (error) {
    console.error('Supabase fetch failed:', error)
    process.exit(1)
  }
  if (!companies) {
    console.error('No companies returned')
    process.exit(1)
  }

  const updates: { id: string; cik: string }[] = []
  const misses: string[] = []
  for (const c of companies) {
    if (!c.ticker) continue
    const ticker = c.ticker.toUpperCase()
    const row = map.get(ticker)
    if (!row) {
      misses.push(`${ticker} (${c.name})`)
      continue
    }
    const cik = String(row.cik_str).padStart(10, '0')
    if (c.cik === cik) continue // already populated
    updates.push({ id: c.id, cik })
  }

  console.log(`→ ${updates.length} updates, ${misses.length} misses, ${companies.length - updates.length - misses.length} already set`)

  for (const u of updates) {
    const r = await sb.from('companies').update({ cik: u.cik }).eq('id', u.id)
    if (r.error) console.error(`✗ ${u.id}: ${r.error.message}`)
    else console.log(`✓ ${u.id} → CIK ${u.cik}`)
  }

  if (misses.length > 0) {
    console.log('\nMisses (ticker not in SEC map — likely foreign listings or sub-segments):')
    misses.forEach((m) => console.log(`  - ${m}`))
  }
}

main().catch((err) => { console.error(err); process.exit(1) })

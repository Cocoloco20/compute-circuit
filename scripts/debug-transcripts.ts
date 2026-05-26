/**
 * Diagnostic: walk the same path /api/cron/transcripts walks for the Mag5,
 * but report WHERE each filing falls off (no exhibit URL, no body, zero
 * lexicon match, etc.). The cron just increments a "skipped" counter
 * without telling you why — this surfaces the actual reason.
 *
 * Run: npx tsx scripts/debug-transcripts.ts
 */
import { createClient } from '@supabase/supabase-js'
import * as path from 'path'
import { config } from 'dotenv'
import {
  fetchCompanyFilings,
  filterEarningsResults8Ks,
  fetchEarningsExhibitText,
} from '../src/lib/edgar'
import { extractTranscriptSignal, totalMentions } from '../src/lib/transcripts'

config({ path: path.join(__dirname, '..', '.env.local') })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('Missing env'); process.exit(1) }
const sb = createClient(url, key)

const TICKERS = ['nvda', 'msft', 'googl', 'meta-ai', 'amzn']

async function main() {
  for (const id of TICKERS) {
    const { data: cos } = await sb
      .from('companies')
      .select('id, name, ticker, cik, private')
      .eq('id', id)
    const co = cos?.[0]
    if (!co) { console.log(`\n=== ${id}: COMPANY NOT FOUND ===`); continue }
    console.log(`\n=== ${co.id} | ${co.name} | CIK=${co.cik} | private=${co.private} ===`)

    if (!co.cik) { console.log('  ⨯ no CIK — would be skipped by cron'); continue }
    if (co.private) { console.log('  ⨯ private=true — would be skipped by cron (cron filters .eq("private", false))'); continue }

    let subs
    try {
      subs = await fetchCompanyFilings(co.cik)
    } catch (e) {
      console.log(`  ⨯ fetchCompanyFilings failed: ${e instanceof Error ? e.message : e}`); continue
    }
    const earnings = filterEarningsResults8Ks(subs.filings, 4)
    console.log(`  → ${earnings.length} earnings 8-K(s) (item 2.02) in trailing window:`)
    if (earnings.length === 0) {
      // Show what 8-Ks they DO have, with items field
      const all8K = subs.filings.filter(f => f.form === '8-K' || f.form === '8-K/A').slice(0, 4)
      console.log(`     Most recent 8-Ks (any item):`)
      all8K.forEach(f => console.log(`       ${f.filingDate}  accession=${f.accessionNumber}  items="${f.items ?? ''}"`))
      continue
    }

    for (const f of earnings) {
      console.log(`\n    • ${f.filingDate}  acc=${f.accessionNumber}  primary="${f.primaryDocument}"  items="${f.items ?? ''}"`)
      const exhibit = await fetchEarningsExhibitText(co.cik, f.accessionNumber, f.primaryDocument)
      if (!exhibit) {
        console.log(`      ⨯ fetchEarningsExhibitText returned null → SKIP`)
        continue
      }
      console.log(`      ✓ exhibit URL: ${exhibit.url}`)
      console.log(`      ✓ body size: ${exhibit.text.length} chars`)
      const signal = extractTranscriptSignal(exhibit.text)
      const tot = totalMentions(signal)
      console.log(`      lexicon: ai=${signal.ai_mentions} gpu=${signal.gpu_mentions} capex=${signal.capex_mentions} dc=${signal.data_center_mentions} token=${signal.token_mentions}  →  total=${tot}  ${tot === 0 ? '⨯ SKIP (zero mentions)' : '✓ would upsert'}`)
      if (tot === 0 && exhibit.text.length > 0) {
        // First 200 chars of stripped body, to see if it's an actual earnings release or a junk file
        const snippet = exhibit.text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 240)
        console.log(`      body snippet: "${snippet}…"`)
      }
      // SEC rate-limit politeness
      await new Promise(r => setTimeout(r, 150))
    }
  }
}

main().catch(e => { console.error(e); process.exit(1) })

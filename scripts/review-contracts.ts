/**
 * Human review of the contract ledger.
 *
 *   npx tsx scripts/review-contracts.ts                      # 30 random 'auto' rows
 *   npx tsx scripts/review-contracts.ts --sample=50 --seed=7
 *   npx tsx scripts/review-contracts.ts --hosts=crwv,cifr --all
 *   npx tsx scripts/review-contracts.ts --status=verified    # re-read what was accepted
 *   npx tsx scripts/review-contracts.ts --verified=3f9a1c2e,7b0d --rejected=91ee
 *
 * Print mode prints one card per row: the extracted fields, the verbatim
 * excerpt, and the source URL. Check the numbers against the excerpt; open
 * the URL when the excerpt is not enough.
 *
 * Mark mode (`--verified=` / `--rejected=`, ids or unique id prefixes) sets
 * review_status and nothing else. Rejected rows stay in the table (the
 * ledger's read side excludes them) so a rejection is reversible with
 * `--auto=<id>`. Nothing is ever deleted.
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (.env.local).
 */
import 'dotenv/config'
import { config } from 'dotenv'
config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import { PROVIDER_IDS } from '../src/lib/contracts/universe'
import { formatReviewCard, parseIdList, resolveId, sampleRows, type ReviewableRow, type Verdict } from '../src/lib/contracts/review'

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a)
  return m ? [m[1], m[2] ?? 'true'] : [a, 'true']
}))
const SAMPLE = args.sample ? parseInt(args.sample, 10) : 30
const SEED = args.seed ? parseInt(args.seed, 10) : Math.floor(Date.now() / 86_400_000) // stable within a day
const STATUS = (args.status ?? 'auto') as Verdict
const HOSTS = args.hosts ? args.hosts.split(',') : null
const ALL = args.all === 'true'

const marks: Array<[Verdict, string[]]> = [
  ['verified', parseIdList(args.verified)],
  ['rejected', parseIdList(args.rejected)],
  ['auto', parseIdList(args.auto)],
]
const MARK_MODE = marks.some(([, ids]) => ids.length > 0)

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing')
  const sb = createClient(url, key, { auth: { persistSession: false } })

  if (MARK_MODE) {
    // Resolve prefixes against every id in the table, then update per verdict.
    const ids: string[] = []
    for (let from = 0; ; from += 1000) {
      const r = await sb.from('contract_disclosures').select('id').range(from, from + 999)
      if (r.error) throw new Error(r.error.message)
      const batch = (r.data ?? []) as Array<{ id: string }>
      ids.push(...batch.map(x => x.id))
      if (batch.length < 1000) break
    }
    for (const [verdict, prefixes] of marks) {
      if (!prefixes.length) continue
      const full = prefixes.map(p => resolveId(p, ids))
      const r = await sb.from('contract_disclosures')
        .update({ review_status: verdict, updated_at: new Date().toISOString() })
        .in('id', full).select('id')
      if (r.error) throw new Error(r.error.message)
      console.log(`${verdict}: ${(r.data ?? []).length} row(s) — ${full.map(id => id.slice(0, 8)).join(', ')}`)
    }
    return
  }

  const rows: ReviewableRow[] = []
  for (let from = 0; ; from += 1000) {
    let q = sb.from('contract_disclosures').select('*').eq('review_status', STATUS)
      .order('filing_date', { ascending: false }).range(from, from + 999)
    if (HOSTS) q = q.in('filer_id', HOSTS)
    const r = await q
    if (r.error) throw new Error(r.error.message)
    const batch = (r.data ?? []) as unknown as ReviewableRow[]
    rows.push(...batch)
    if (batch.length < 1000) break
  }
  const unknownHosts = (HOSTS ?? []).filter(h => !PROVIDER_IDS.includes(h))
  if (unknownHosts.length) console.warn(`note: ${unknownHosts.join(', ')} not in PROVIDER_IDS (still queried)`)

  const picked = ALL ? rows : sampleRows(rows, SAMPLE, SEED)
  console.log(`${rows.length} row(s) with review_status=${STATUS}${HOSTS ? ` from ${HOSTS.join(',')}` : ''}; showing ${picked.length}${ALL ? '' : ` (seed ${SEED}; --seed=${SEED} reproduces this sample)`}\n`)
  picked.forEach((r, i) => console.log(formatReviewCard(r, i + 1) + '\n'))

  if (picked.length) {
    console.log('To record verdicts (ids or unique prefixes, comma-separated):')
    console.log(`  npx tsx scripts/review-contracts.ts --verified=${picked[0].id.slice(0, 8)} --rejected=<id>`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })

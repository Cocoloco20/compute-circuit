/**
 * One-shot fundamentals backfill.
 *
 * Runs fetchAllEdgarFundamentals for all companies with CIKs.
 * This will pick up the new capex tags (e.g. PaymentsToAcquireProductiveAssets)
 * mapped in src/lib/market.ts and update them in the fundamentals table.
 *
 * Run: npx tsx scripts/backfill-capex.ts
 */
import { createClient } from '@supabase/supabase-js'
import * as path from 'path'
import { config } from 'dotenv'
import { fetchAllEdgarFundamentals } from '../src/lib/market'

config({ path: path.join(__dirname, '..', '.env.local') })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}
const sb = createClient(url, key)

interface CompanyRow {
  id: string
  cik: string
  name: string
}

async function main() {
  const resp = await sb.from('companies').select('id, cik, name').not('cik', 'is', null)
  if (resp.error) {
    console.error('Error fetching companies:', resp.error.message)
    process.exit(1)
  }

  const companies = ((resp.data ?? []) as CompanyRow[])
    .filter(c => c.cik)
    .map(c => ({ companyId: c.id, cik: c.cik, name: c.name }))

  console.log(`Found ${companies.length} companies with CIKs. Fetching Edgar fundamentals...`)

  const startedAt = Date.now()
  const results = await fetchAllEdgarFundamentals(companies, 40)
  const fetchMs = Date.now() - startedAt
  console.log(`Fetched fundamentals in ${(fetchMs / 1000).toFixed(1)}s. Preparing database rows...`)

  type Row = {
    company_id: string
    period: string
    period_type: string
    metric: string
    value: number
    unit: string
    source: string
  }
  const rows: Row[] = []
  for (const r of results) {
    for (const f of r.rows) {
      rows.push({
        company_id: r.companyId,
        period: f.period,
        period_type: f.period_type,
        metric: f.metric,
        value: f.value,
        unit: f.unit,
        source: 'sec-companyfacts',
      })
    }
  }

  if (rows.length === 0) {
    console.log('No fundamentals found to upsert.')
    return
  }

  console.log(`Upserting ${rows.length} rows to the 'fundamentals' table...`)

  // Bulk upsert keyed on (company_id, period, period_type, metric)
  const upResp = await (sb.from('fundamentals') as unknown as {
    upsert: (rows: Row[], opts: { onConflict: string }) =>
      Promise<{ data: unknown[] | null; error: { message: string } | null }>
  }).upsert(rows, { onConflict: 'company_id,period,period_type,metric' })

  if (upResp.error) {
    console.error('Upsert failed:', upResp.error.message)
    process.exit(1)
  }

  console.log('✓ Fundamentals backfilled successfully.')
  for (const r of results) {
    console.log(`  - ${r.companyId}: ${r.rows.length} rows`)
  }
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})

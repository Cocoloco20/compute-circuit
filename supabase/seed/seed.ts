/**
 * Idempotent seed script — run with `npm run seed`.
 *
 * Reads .env.local, then upserts every row in data.ts into Supabase using the
 * service_role key (which bypasses RLS). Safe to re-run: existing rows are
 * updated, new ones inserted, removed rows are NOT deleted (intentional —
 * use the dashboard if you need to truly wipe state).
 *
 * Insert order matters because of foreign keys:
 *   layers → investors → companies → company_backers
 *                                  → flows
 *                                  → bottlenecks → bottleneck_beneficiaries
 */

import { config } from 'dotenv'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

import {
  layers,
  investors,
  companies,
  companyBackers,
  flows,
  bottlenecks,
  bottleneckBeneficiaries,
} from './data'
import type { Database } from '../../src/types/db'

config({ path: resolve(process.cwd(), '.env.local') })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const sb = createClient<Database>(url, key, { auth: { persistSession: false } })

async function upsert<T extends object>(table: string, rows: T[], onConflict: string) {
  if (rows.length === 0) return
  const { error, count } = await sb.from(table as any).upsert(rows as any, { onConflict, count: 'exact' })
  if (error) {
    console.error(`✗ ${table}: ${error.message}`)
    throw error
  }
  console.log(`✓ ${table}: ${count ?? rows.length} rows`)
}

// Flows have no natural key — wipe and reinsert each run. Cheap because the
// edge count is small and avoids stale flow rows accumulating.
async function replaceFlows() {
  const del = await sb.from('flows').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  if (del.error) {
    console.error(`✗ flows delete: ${del.error.message}`)
    throw del.error
  }
  const ins = await sb.from('flows').insert(flows).select('id')
  if (ins.error) {
    console.error(`✗ flows insert: ${ins.error.message}`)
    throw ins.error
  }
  console.log(`✓ flows: ${ins.data?.length ?? 0} rows (replaced)`)
}

async function main() {
  console.log(`→ ${url}`)

  await upsert('layers',                  layers,                  'id')
  await upsert('investors',               investors,               'id')
  await upsert('companies',               companies,               'id')
  await upsert('company_backers',         companyBackers,          'company_id,investor_id')
  await upsert('bottlenecks',             bottlenecks,             'id')
  await upsert('bottleneck_beneficiaries', bottleneckBeneficiaries, 'bottleneck_id,company_id')
  await replaceFlows()

  console.log('\n✓ seed complete')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

// One-shot: apply supabase/migrations/0048_decision_memory.sql via pg pooler.
// Reads DATABASE_URL from .env.local — never hardcoded.
const { Client } = require('pg')
const fs = require('fs')
require('dotenv').config({ path: '/Users/luiguisanchez/compute-circuit/.env.local' })

;(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL is not set')
    process.exit(1)
  }
  const dbUrl = new URL(process.env.DATABASE_URL)
  const password = decodeURIComponent(dbUrl.password)
  const parts = dbUrl.hostname.split('.')
  const projectRef = parts[0] === 'db' ? parts[1] : parts[0]
  const poolerHost = process.env.POOLER_HOST || `aws-1-${process.env.POOLER_REGION || 'us-west-1'}.pooler.supabase.com`
  const poolerUser = `postgres.${projectRef}`
  
  console.log(`Connecting to pooler: ${poolerHost} as ${poolerUser}...`)
  const c = new Client({
    host: poolerHost, port: 5432, user: poolerUser, password,
    database: 'postgres', ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  })
  await c.connect()
  
  const sqlPath = '/Users/luiguisanchez/compute-circuit/supabase/migrations/0048_decision_memory.sql'
  console.log(`Reading migration file: ${sqlPath}...`)
  const sql = fs.readFileSync(sqlPath, 'utf8')
  console.log('Applying migration 0048 (decision-memory layer)...')
  await c.query(sql)
  console.log('Migration 0048 applied.\n')

  // Verify: every new table exists, has RLS on, and has ZERO policies.
  // Zero policies + RLS enabled = anon can read nothing. That is the point.
  const NEW = ['pipeline_cards','decisions','decision_factors',
               'decision_resurfacings','notes','commit_log']
  const r = await c.query(`
    select c.relname as table,
           c.relrowsecurity as rls,
           (select count(*)::int from pg_policies p
             where p.schemaname='public' and p.tablename=c.relname) as policies
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname = any($1) order by c.relname`, [NEW])

  let bad = 0
  for (const t of NEW) {
    const row = r.rows.find(x => x.table === t)
    if (!row)            { console.log(`  ✗ ${t}: MISSING`); bad++; continue }
    if (!row.rls)        { console.log(`  ✗ ${t}: RLS DISABLED`); bad++; continue }
    if (row.policies > 0){ console.log(`  ✗ ${t}: ${row.policies} policy(ies) — anon may be able to read`); bad++; continue }
    console.log(`  ✓ ${t}: RLS on, 0 policies (service-role only)`)
  }

  await c.end()
  if (bad) { console.error(`\n${bad} table(s) failed the RLS check.`); process.exit(1) }
  console.log('\nAll 6 tables locked down.')
})().catch(e => { console.error('FATAL', e); process.exit(1) })

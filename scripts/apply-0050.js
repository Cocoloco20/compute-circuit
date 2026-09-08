// One-shot: apply supabase/migrations/0050_yc_companies.sql via pg pooler.
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
  
  const sqlPath = '/Users/luiguisanchez/compute-circuit/supabase/migrations/0050_yc_companies.sql'
  console.log(`Reading migration file: ${sqlPath}...`)
  const sql = fs.readFileSync(sqlPath, 'utf8')
  console.log('Applying migration 0050 (yc_companies)...')
  await c.query(sql)
  const r = await c.query(`
    select c.relrowsecurity as rls,
           (select count(*)::int from pg_policies p where p.tablename='yc_companies') as policies
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='yc_companies'`)
  if (!r.rows.length) { console.error('  ✗ table missing'); process.exit(1) }
  const { rls, policies } = r.rows[0]
  console.log(`  ${rls && policies === 0 ? '✓' : '✗'} yc_companies: RLS=${rls}, policies=${policies}`)
  await c.end()
  if (!rls || policies !== 0) process.exit(1)
})().catch(e => { console.error('FATAL', e); process.exit(1) })

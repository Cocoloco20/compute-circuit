// One-shot: apply supabase/migrations/0052_fund_financials.sql via pg pooler.
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
  
  const sqlPath = '/Users/luiguisanchez/compute-circuit/supabase/migrations/0052_fund_financials.sql'
  console.log(`Reading migration file: ${sqlPath}...`)
  const sql = fs.readFileSync(sqlPath, 'utf8')
  console.log('Applying migration 0052 (fund financials)...')
  await c.query(sql)
  const NEW = ['fund','investments','marks']
  const r = await c.query(`
    select c.relname as t, c.relrowsecurity as rls,
           (select count(*)::int from pg_policies p where p.tablename=c.relname) as pol
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname = any($1) order by c.relname`, [NEW])
  let bad = 0
  for (const t of NEW) {
    const row = r.rows.find(x => x.t === t)
    if (!row) { console.log(`  ✗ ${t}: MISSING`); bad++; continue }
    const ok = row.rls && row.pol === 0
    console.log(`  ${ok ? '✓' : '✗'} ${t}: RLS=${row.rls}, policies=${row.pol}`)
    if (!ok) bad++
  }
  await c.end()
  if (bad) process.exit(1)
})().catch(e => { console.error('FATAL', e); process.exit(1) })

// One-shot: apply supabase/migrations/0040_logo_pipeline.sql via pg pooler.
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
  // hostname is 'db.<projectRef>.supabase.co' (direct) OR 'aws-…pooler.supabase.com'
  // After split: ['db','<projectRef>','supabase','co'] — take [1].
  // For pooler URLs the user would have already passed the pooler creds inline,
  // so this script targets the direct DSN form only.
  const parts = dbUrl.hostname.split('.')
  const projectRef = parts[0] === 'db' ? parts[1] : parts[0]
  const poolerHost = process.env.POOLER_HOST || `aws-1-${process.env.POOLER_REGION || 'us-west-1'}.pooler.supabase.com`
  const poolerUser = `postgres.${projectRef}`
  const c = new Client({
    host: poolerHost, port: 5432, user: poolerUser, password,
    database: 'postgres', ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  })
  await c.connect()
  const sql = fs.readFileSync('/Users/luiguisanchez/compute-circuit/supabase/migrations/0040_logo_pipeline.sql', 'utf8')
  console.log('Applying migration 0040...')
  await c.query(sql)
  // Verify columns exist
  const r = await c.query(`
    select column_name, data_type
      from information_schema.columns
     where table_name = 'companies'
       and column_name in ('logo_url', 'logo_status', 'logo_verified_at')
     order by column_name
  `)
  console.log('Columns now present on companies:')
  for (const row of r.rows) console.log(` - ${row.column_name} (${row.data_type})`)
  await c.end()
})().catch(e => { console.error('FATAL', e); process.exit(1) })

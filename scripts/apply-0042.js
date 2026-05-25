// One-shot: apply supabase/migrations/0042_layer_descriptions.sql via pg pooler.
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
  const c = new Client({
    host: poolerHost, port: 5432, user: poolerUser, password,
    database: 'postgres', ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  })
  await c.connect()
  const sql = fs.readFileSync('/Users/luiguisanchez/compute-circuit/supabase/migrations/0042_layer_descriptions.sql', 'utf8')
  console.log('Applying migration 0042 (Glossary: layer + agency descriptions)...')
  await c.query(sql)

  // Verify columns
  const cols = await c.query(`
    select table_name, column_name, data_type
      from information_schema.columns
     where (table_name = 'layers'   and column_name in ('description','example_companies','bottleneck_keywords'))
        or (table_name = 'agencies' and column_name in ('description','recent_focus'))
     order by table_name, column_name
  `)
  console.log('Columns now present:')
  for (const r of cols.rows) console.log(` - ${r.table_name}.${r.column_name} (${r.data_type})`)

  // Verify coverage
  const lyr = await c.query(`select count(*)::int as n_total, count(description)::int as n_described from layers`)
  const agc = await c.query(`select count(*)::int as n_total, count(description)::int as n_described from agencies`)
  console.log(`Layers:   ${lyr.rows[0].n_described} / ${lyr.rows[0].n_total} have descriptions`)
  console.log(`Agencies: ${agc.rows[0].n_described} / ${agc.rows[0].n_total} have descriptions`)

  // Spot-check
  const chips = await c.query(`select name, description from layers where id = 'chips'`)
  if (chips.rows[0]) {
    console.log('\nSample layer (chips):')
    console.log('  name:', chips.rows[0].name)
    console.log('  desc:', chips.rows[0].description?.slice(0, 200), '…')
  }
  const bis = await c.query(`select name, description, recent_focus from agencies where id = 'us_bis'`)
  if (bis.rows[0]) {
    console.log('\nSample agency (US BIS):')
    console.log('  name:', bis.rows[0].name)
    console.log('  desc:', bis.rows[0].description?.slice(0, 200), '…')
    console.log('  focus:', bis.rows[0].recent_focus?.slice(0, 200), '…')
  }
  await c.end()
})().catch(e => { console.error('FATAL', e); process.exit(1) })

// One-shot: apply supabase/migrations/0044_compute_contracts.sql via pg pooler.
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
  
  const sqlPath = '/Users/luiguisanchez/compute-circuit/supabase/migrations/0044_compute_contracts.sql'
  console.log(`Reading migration file: ${sqlPath}...`)
  const sql = fs.readFileSync(sqlPath, 'utf8')
  
  console.log('Applying migration 0043 (World Ontology spine)...')
  await c.query(sql)
  console.log('Migration 0043 applied successfully!')

  // Verify layers
  const layersCount = await c.query('select count(*)::int as n from layers')
  console.log(`Total layers in DB: ${layersCount.rows[0].n} (expected 28)`)

  // Verify companies
  const cosCount = await c.query('select count(*)::int as n from companies')
  console.log(`Total companies in DB: ${cosCount.rows[0].n} (expected 200+)`)

  // Sample check
  const sampleLayer = await c.query("select id, name, y_position from layers where id = 'entertainment'")
  if (sampleLayer.rows[0]) {
    console.log('\nSample Layer:')
    console.log(` - ID: ${sampleLayer.rows[0].id}`)
    console.log(` - Name: ${sampleLayer.rows[0].name}`)
    console.log(` - Y-Position: ${sampleLayer.rows[0].y_position}`)
  }

  const sampleCos = await c.query("select id, name, ticker, layer_id from companies where layer_id = 'entertainment' limit 5")
  console.log('\nSample Companies in entertainment layer:')
  for (const r of sampleCos.rows) {
    console.log(` - ${r.name} (${r.ticker ?? 'private'}) [${r.id}]`)
  }

  await c.end()
})().catch(e => { console.error('FATAL', e); process.exit(1) })

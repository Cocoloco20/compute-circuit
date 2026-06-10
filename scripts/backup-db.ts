/**
 * Full-database backup to local gzipped JSONL — free-tier safety net.
 *
 * Supabase's free tier has NO automated backups, and the DB now holds ~70K
 * rows of curated + backfilled data (2,461 companies, fundamentals, signals,
 * theses) that took real work to assemble. pg_dump isn't installed on this
 * machine, so this dumps via the session-mode pooler with the `pg` package
 * already in devDependencies:
 *
 *   backups/<YYYY-MM-DD>/<table>.jsonl.gz   — one JSON object per row
 *   backups/<YYYY-MM-DD>/manifest.json      — row counts + timing per table
 *
 * Table list is discovered from information_schema, so new tables are
 * picked up automatically — no list to maintain.
 *
 * Restore strategy (documented here so future-you doesn't have to think):
 * rows are plain column→value JSON, so a restore is a chunked
 * supabase-js/pg upsert per table after re-applying supabase/migrations/.
 *
 * Run:  npm run backup        (alias for: npx tsx scripts/backup-db.ts)
 * Cost: $0. Time: ~1-2 min. Re-runs overwrite the same dated folder.
 */
import { Client } from 'pg'
import * as fs from 'fs'
import * as path from 'path'
import * as zlib from 'zlib'
import { config } from 'dotenv'

config({ path: path.join(__dirname, '..', '.env.local') })

const PAGE = 5000

async function main() {
  const dbUrl = new URL(process.env.DATABASE_URL!)
  const projectRef = dbUrl.hostname.split('.')[dbUrl.hostname.startsWith('db.') ? 1 : 0]
  const client = new Client({
    host: process.env.POOLER_HOST ?? `aws-1-${process.env.POOLER_REGION ?? 'us-west-1'}.pooler.supabase.com`,
    port: 5432,
    user: `postgres.${projectRef}`,
    password: decodeURIComponent(dbUrl.password),
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15_000,
  })
  await client.connect()

  const { rows: tables } = await client.query<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name`,
  )

  const stamp = new Date().toISOString().slice(0, 10)
  const dir = path.join(__dirname, '..', 'backups', stamp)
  fs.mkdirSync(dir, { recursive: true })

  const manifest: Record<string, { rows: number; bytes: number; ms: number }> = {}
  for (const { table_name } of tables) {
    const t0 = Date.now()
    const gz = zlib.createGzip()
    const out = fs.createWriteStream(path.join(dir, `${table_name}.jsonl.gz`))
    gz.pipe(out)
    let total = 0
    for (let offset = 0; ; offset += PAGE) {
      // information_schema-sourced name + ORDER BY 1 keeps pagination stable
      // without knowing each table's PK.
      const { rows } = await client.query(
        `select * from "${table_name}" order by 1 limit ${PAGE} offset ${offset}`,
      )
      for (const row of rows) gz.write(JSON.stringify(row) + '\n')
      total += rows.length
      if (rows.length < PAGE) break
    }
    await new Promise<void>((resolve, reject) => {
      out.on('finish', resolve); out.on('error', reject); gz.end()
    })
    const bytes = fs.statSync(path.join(dir, `${table_name}.jsonl.gz`)).size
    manifest[table_name] = { rows: total, bytes, ms: Date.now() - t0 }
    console.log(`  ${table_name.padEnd(28)} ${String(total).padStart(7)} rows  ${(bytes / 1024).toFixed(0).padStart(6)} KB`)
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    backed_up_at: new Date().toISOString(),
    project_ref: projectRef,
    tables: manifest,
  }, null, 2))

  await client.end()
  const totalRows = Object.values(manifest).reduce((a, t) => a + t.rows, 0)
  const totalKb = Object.values(manifest).reduce((a, t) => a + t.bytes, 0) / 1024
  console.log(`\n✓ ${tables.length} tables, ${totalRows} rows, ${(totalKb / 1024).toFixed(1)} MB → ${dir}`)
}

main().catch(e => { console.error(e); process.exit(1) })

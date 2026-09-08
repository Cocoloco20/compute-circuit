/**
 * One-shot bulk import of the YC directory. Run locally — 6,204 records will
 * not fit in a Vercel function's 60s cap, and this has no reason to.
 *
 *   npx tsx scripts/import-yc.ts            # apply
 *   npx tsx scripts/import-yc.ts --dry-run  # report only, write nothing
 *
 * Re-runnable: companies are matched by normalized name against what's
 * already tracked, so re-running updates the YC metadata instead of creating
 * duplicate Stripes.
 */

import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

// The repo keeps credentials in .env.local, not .env — `dotenv/config` would
// silently load nothing and the script would look like an env-var problem.
config({ path: new URL('../.env.local', import.meta.url).pathname })

import { fetchYcDirectory, normalizeYc, isPrivate, YC_INVESTOR_ID, type YcNormalized } from '../src/lib/yc'
import { normalizeName } from '../src/lib/scrapers/index'

const DRY = process.argv.includes('--dry-run')
const CHUNK = 200

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase env missing — expected .env.local')
  const sb = createClient(url, key, { auth: { persistSession: false } })

  console.log('Fetching YC directory…')
  const raw = await fetchYcDirectory()
  const recs = raw.map(normalizeYc).filter((x): x is YcNormalized => x !== null)
  console.log(`  ${raw.length} records, ${recs.length} usable`)

  // Existing companies, paginated — select() silently caps at 1000 rows, which
  // is the bug that made the news and prices crons miss 60% of the table.
  const existing = new Map<string, string>()   // normalized name → company id
  const existingIds = new Set<string>()       // every company id, verbatim
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const r = await sb.from('companies').select('id, name').range(from, from + PAGE - 1).order('id')
    if (r.error) throw new Error(r.error.message)
    const batch = (r.data ?? []) as Array<{ id: string; name: string }>
    for (const c of batch) {
      existingIds.add(c.id)
      // First writer wins: normalizeName strips corporate suffixes, so several
      // companies can share a key. Never let a later row silently steal it.
      if (!existing.has(normalizeName(c.name))) existing.set(normalizeName(c.name), c.id)
    }
    if (batch.length < PAGE) break
  }
  console.log(`  ${existingIds.size} companies already tracked`)

  const matched: Array<{ rec: YcNormalized; companyId: string }> = []
  const fresh: YcNormalized[] = []
  for (const rec of recs) {
    // Identity order matters. rec.companyId is "yc-<slug>" and YC slugs are
    // unique, so if that row already exists it IS this company — check it
    // first. Falling straight to the name index made re-runs collapse 101
    // distinct YC companies onto shared rows, because normalizeName() maps
    // e.g. "Foo Inc" and "Foo Corp" to the same key. Name matching is only
    // for finding a company we already track under a non-YC id (Stripe,
    // Airbnb, Reddit), and only on the first import.
    if (existingIds.has(rec.companyId)) {
      matched.push({ rec, companyId: rec.companyId })
      continue
    }
    const hit = existing.get(rec.matchKey)
    if (hit) matched.push({ rec, companyId: hit })
    else fresh.push(rec)
  }

  // Name matching is ambiguous when several YC companies share a name — there
  // are three distinct YC companies called "Hera". Only the first may claim
  // the existing non-YC row; the rest get their own yc-<slug> rows, which are
  // unique by construction. Without this they silently merge and we lose real
  // companies from the directory.
  const claimed = new Set<string>()
  for (let i = matched.length - 1; i >= 0; i--) {
    const m = matched[i]
    if (m.companyId === m.rec.companyId) continue   // matched by slug — unambiguous
    if (claimed.has(m.companyId)) {
      matched.splice(i, 1)
      fresh.push(m.rec)
    } else {
      claimed.add(m.companyId)
    }
  }
  console.log(`  ${matched.length} match an existing company, ${fresh.length} are new`)

  if (DRY) {
    console.log('\n--dry-run: nothing written.')
    console.log('sample new:', fresh.slice(0, 5).map(f => `${f.name} (${f.batch})`).join(', '))
    console.log('sample matched:', matched.slice(0, 5).map(m => `${m.rec.name} → ${m.companyId}`).join(', '))
    return
  }

  // 1. insert the new companies
  let inserted = 0
  for (let i = 0; i < fresh.length; i += CHUNK) {
    const rows = fresh.slice(i, i + CHUNK).map(r => ({
      id: r.companyId,
      name: r.name,
      ticker: null,
      domain: r.website ? safeHost(r.website) : null,
      // layer_id null keeps these out of the 3D compute graph, which is
      // curated. They are still searchable and sourceable in the pipeline.
      layer_id: null,
      weight: 0,
      private: isPrivate(r.status),
      position_held: false,
      discovered_via: YC_INVESTOR_ID,
      discovered_at: new Date().toISOString(),
    }))
    const r = await sb.from('companies').upsert(rows, { onConflict: 'id' })
    if (r.error) throw new Error(`companies upsert: ${r.error.message}`)
    inserted += rows.length
    process.stdout.write(`\r  companies: ${inserted}/${fresh.length}`)
  }
  if (fresh.length) console.log('')

  // 2. yc_companies metadata for everything, matched and new alike
  //
  // Dedupe by company_id before any upsert. Postgres rejects an ON CONFLICT DO
  // UPDATE that touches the same row twice in one statement, and two YC
  // records CAN land on the same id: normalizeName() strips corporate
  // suffixes, so "Foo Inc" and "Foo Corp" both match the same existing
  // company. Same failure the arXiv cron hit with co-authored papers.
  const byId = new Map<string, { rec: YcNormalized; id: string }>()
  for (const m of matched) byId.set(m.companyId, { rec: m.rec, id: m.companyId })
  for (const r of fresh) byId.set(r.companyId, { rec: r, id: r.companyId })
  const all = [...byId.values()]
  const collapsed = (matched.length + fresh.length) - all.length
  if (collapsed > 0) console.log(`  ${collapsed} record(s) collapsed onto a shared company id`)
  let meta = 0
  for (let i = 0; i < all.length; i += CHUNK) {
    const rows = all.slice(i, i + CHUNK).map(({ rec, id }) => ({
      company_id: id,
      yc_id: rec.ycId,
      slug: rec.slug,
      batch: rec.batch,
      status: rec.status,
      industry: rec.industry,
      subindustry: rec.subindustry,
      team_size: rec.teamSize,
      one_liner: rec.oneLiner,
      website: rec.website,
      yc_url: rec.ycUrl,
      top_company: rec.topCompany,
      launched_at: rec.launchedAt,
      updated_at: new Date().toISOString(),
    }))
    const r = await sb.from('yc_companies').upsert(rows, { onConflict: 'company_id' })
    if (r.error) throw new Error(`yc_companies upsert: ${r.error.message}`)
    meta += rows.length
    process.stdout.write(`\r  yc metadata: ${meta}/${all.length}`)
  }
  console.log('')

  // 3. backer links — YC as the investor on every one
  let links = 0
  for (let i = 0; i < all.length; i += CHUNK) {
    const rows = all.slice(i, i + CHUNK).map(({ id }) => ({
      company_id: id, investor_id: YC_INVESTOR_ID,
    }))
    const r = await sb.from('company_backers').upsert(rows, { onConflict: 'company_id,investor_id' })
    if (r.error) throw new Error(`company_backers upsert: ${r.error.message}`)
    links += rows.length
    process.stdout.write(`\r  backer links: ${links}/${all.length}`)
  }
  console.log('')

  console.log(`\nDone. ${inserted} companies inserted, ${meta} YC records, ${links} backer links.`)
}

/** "http://stripe.com/" → "stripe.com"; anything unparseable → null. */
function safeHost(u: string): string | null {
  try {
    return new URL(u.startsWith('http') ? u : `https://${u}`).hostname.replace(/^www\./, '') || null
  } catch {
    return null
  }
}

main().catch(e => { console.error('\nFATAL', e); process.exit(1) })

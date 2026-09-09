/**
 * Import fund portfolio lists into the investor reference layer.
 *
 * Consumes ~/fund-os-research/portfolios/<fund>.json, whether written by hand
 * (Sequoia's sitemap, a16z's embedded JSON) or by a Hermes agent. One shape,
 * one identity path — the parsing per site is upstream and disposable; this is
 * the part where getting identity wrong silently corrupts the table.
 *
 *   npx tsx scripts/import-portfolio.ts              # every file
 *   npx tsx scripts/import-portfolio.ts a16z sequoia # named funds
 *   npx tsx scripts/import-portfolio.ts --dry-run
 *
 * These rows land in `companies` with layer_id null (out of the curated 3D
 * graph, still searchable in /pipeline) and get a company_backers link to the
 * fund. Re-runnable: matching is by id first, then normalized name.
 */

import { config } from 'dotenv'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createClient } from '@supabase/supabase-js'
import { normalizeName } from '../src/lib/scrapers/index'
import {
  normalizeEntry, rejectReason, type PortfolioFile, type NormalizedEntry,
} from '../src/lib/portfolio-import'

config({ path: new URL('../.env.local', import.meta.url).pathname })

const DIR = join(homedir(), 'fund-os-research', 'portfolios')
const CHUNK = 200
const DRY = process.argv.includes('--dry-run')
const ONLY = process.argv.slice(2).filter(a => !a.startsWith('--'))

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase env missing — expected .env.local')
  const sb = createClient(url, key, { auth: { persistSession: false } })

  const files = readdirSync(DIR).filter(f => f.endsWith('.json'))
    .filter(f => !ONLY.length || ONLY.includes(f.replace('.json', '')))
  if (!files.length) throw new Error(`no portfolio files in ${DIR}`)
  console.log(`${files.length} portfolio file(s): ${files.join(', ')}\n`)

  // Existing companies. Paginated — select() silently caps at 1000 rows, the
  // bug that made the news and prices crons miss most of the table.
  const byId = new Set<string>()
  const byName = new Map<string, string>()
  for (let from = 0; ; from += 1000) {
    const r = await sb.from('companies').select('id, name').range(from, from + 999).order('id')
    if (r.error) throw new Error(r.error.message)
    const batch = (r.data ?? []) as Array<{ id: string; name: string }>
    for (const c of batch) {
      byId.add(c.id)
      if (!byName.has(normalizeName(c.name))) byName.set(normalizeName(c.name), c.id)
    }
    if (batch.length < 1000) break
  }
  console.log(`${byId.size} companies already tracked\n`)

  const investors = new Set(
    (((await sb.from('investors').select('id')).data ?? []) as Array<{ id: string }>).map(i => i.id))

  let grandNew = 0, grandLinks = 0
  for (const file of files) {
    const pf = JSON.parse(readFileSync(join(DIR, file), 'utf8')) as PortfolioFile & {
      robots_disallow?: string[]; method?: string
    }
    const fund = pf.fund
    if (!investors.has(fund)) {
      console.log(`  ${fund}: SKIPPED — no investors row with that id`)
      continue
    }
    if (pf.method === 'BLOCKED') {
      console.log(`  ${fund}: SKIPPED — recorded as BLOCKED by robots.txt`)
      continue
    }

    // Refuse a half-written file. The agents write these while still running,
    // so `count` (what the source actually has) can be far ahead of what is on
    // disk. Importing the partial list would quietly record e.g. 115 of
    // Lightspeed's 662 companies as the whole portfolio, and nothing
    // downstream could tell the difference between "that is the portfolio" and
    // "that is as far as the file got".
    const declared = (pf as { count?: number }).count
    const actual = pf.companies?.length ?? 0
    if (typeof declared === 'number' && actual < declared) {
      // TRUNCATION — the dangerous direction. The agents write these while
      // still running, so the file can hold far fewer than the source has.
      // Importing it would record e.g. 115 of Lightspeed's 662 companies as
      // the whole portfolio, and nothing downstream could distinguish "that
      // is the portfolio" from "that is as far as the file got".
      console.log(`  ${fund}: SKIPPED — declares ${declared} companies but holds ${actual}. ` +
        `Still being written; re-run when the agent finishes.`)
      continue
    }
    if (typeof declared === 'number' && actual > declared) {
      // The count field is stale, not the data. Nothing is missing, so import
      // it — but say so, because a file that disagrees with itself is worth a
      // second look rather than a silent pass.
      console.log(`  ${fund}: note — declares ${declared} but holds ${actual}; importing all ${actual}.`)
    }

    const rejected: Record<string, number> = {}
    const norm: NormalizedEntry[] = []
    for (const e of pf.companies ?? []) {
      const why = rejectReason(e.name ?? '')
      if (why) { rejected[why] = (rejected[why] ?? 0) + 1; continue }
      const n = normalizeEntry(fund, e, pf.domain)
      if (n) norm.push(n)
    }

    // Resolve identity, then dedupe by the resolved id. Postgres rejects an
    // ON CONFLICT that touches the same row twice, and two entries can resolve
    // to one company when normalizeName() collapses their names.
    const resolved = new Map<string, { n: NormalizedEntry; id: string; isNew: boolean }>()
    const claimed = new Set<string>()
    for (const n of norm) {
      let id: string, isNew = false
      if (byId.has(n.companyId)) id = n.companyId
      else {
        const hit = byName.get(n.matchKey)
        // Only the first entry may claim an existing row by name; the rest get
        // their own id. Three different YC companies are called "Hera", and
        // merging them silently loses real companies.
        if (hit && !claimed.has(hit)) { id = hit; claimed.add(hit) }
        else { id = n.companyId; isNew = !byId.has(id) }
      }
      resolved.set(id, { n, id, isNew })
    }
    const rows = [...resolved.values()]
    const fresh = rows.filter(r => r.isNew)
    const collapsed = norm.length - rows.length

    console.log(`  ${fund}: ${pf.companies?.length ?? 0} listed → ${norm.length} valid, ` +
      `${fresh.length} new, ${rows.length - fresh.length} matched` +
      (collapsed ? `, ${collapsed} collapsed` : '') +
      (Object.keys(rejected).length ? `, rejected ${JSON.stringify(rejected)}` : ''))

    if (DRY) continue

    for (let i = 0; i < fresh.length; i += CHUNK) {
      const batch = fresh.slice(i, i + CHUNK).map(({ n, id }) => ({
        id, name: n.name, ticker: null,
        domain: companyHost(n.url, pf.domain),
        layer_id: null, weight: 0, private: true, position_held: false,
        discovered_via: fund, discovered_at: new Date().toISOString(),
      }))
      const r = await sb.from('companies').upsert(batch, { onConflict: 'id' })
      if (r.error) throw new Error(`${fund} companies: ${r.error.message}`)
      batch.forEach(b => byId.add(b.id))
    }

    for (let i = 0; i < rows.length; i += CHUNK) {
      const batch = rows.slice(i, i + CHUNK).map(({ id }) => ({ company_id: id, investor_id: fund }))
      const r = await sb.from('company_backers').upsert(batch, { onConflict: 'company_id,investor_id' })
      if (r.error) throw new Error(`${fund} backers: ${r.error.message}`)
    }

    grandNew += fresh.length
    grandLinks += rows.length
  }

  console.log(DRY
    ? '\n--dry-run: nothing written.'
    : `\nDone. ${grandNew} companies inserted, ${grandLinks} backer links.`)
}

/**
 * The COMPANY's host, never the fund's.
 *
 * Most funds link to a page on their own site (nea.com/portfolio/x), so taking
 * the URL host wrote the fund's domain onto 4,132 company rows. The brief cron
 * then dutifully read those homepages, and 2,249 companies ended up described
 * as "Lightspeed Venture Partners is a multi-stage VC firm" in a tool whose
 * entire job is telling you what a company does. A wrong domain is worse than
 * no domain: null is visibly missing, wrong is confidently misleading.
 */
function companyHost(u: string | null, fundDomain?: string): string | null {
  const h = hostOf(u)
  if (!h) return null
  const fd = (fundDomain ?? '').replace(/^www\./, '')
  if (fd && (h === fd || h.endsWith('.' + fd))) return null
  return h
}

function hostOf(u: string | null): string | null {
  if (!u) return null
  try {
    return new URL(u.startsWith('http') ? u : `https://${u}`).hostname.replace(/^www\./, '') || null
  } catch { return null }
}

main().catch(e => { console.error('\nFATAL', e); process.exit(1) })

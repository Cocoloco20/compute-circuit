/**
 * One-shot logo-seeding pipeline.
 *
 * Walks every company with logo_status IN ('pending','missing','NULL') and
 * tries to:
 *   1. Resolve a domain if one is missing (Wikipedia infobox → DuckDuckGo)
 *   2. Verify the favicon proxy returns a real (non-placeholder) image
 *   3. Persist logo_status + logo_verified_at (and domain if newly resolved)
 *
 * Port of src/lib/logo-resolver.ts to plain Node — the TypeScript module
 * can't be required directly without a build step, and this script is
 * one-shot so the duplication is acceptable.
 *
 * IDEMPOTENT — re-running just refreshes verified_at; only rows whose
 * verification result differs are net-changed.
 *
 * Usage:
 *   node scripts/seed-logos.js                # all pending/missing rows
 *   node scripts/seed-logos.js --limit 10     # smoke test
 *   node scripts/seed-logos.js --only nvda    # one co by id
 *   node scripts/seed-logos.js --base https://compute-circuit.vercel.app
 *   node scripts/seed-logos.js --force        # re-verify already-verified rows too
 */

const { Client } = require('pg')
require('dotenv').config({ path: '/Users/luiguisanchez/compute-circuit/.env.local' })

const UA = 'compute-circuit-seed-logos (research tool) luigui.h2002@gmail.com'
// See src/lib/logo-resolver.ts for the rationale — gstatic's "no favicon"
// sentinel is ~9 bytes; real PNGs are 600B-3KB. 100 bytes splits them safely.
const DEFAULT_PLACEHOLDER_MAX_BYTES = 100
const SLEEP_MS = 250 // be polite to Wikipedia

// ---------- CLI ----------

const args = process.argv.slice(2)
function arg(name, fallback = null) {
  const i = args.indexOf(name)
  if (i < 0) return fallback
  return args[i + 1] ?? true
}
const LIMIT = arg('--limit') ? Number(arg('--limit')) : null
const ONLY = arg('--only', null)
const FORCE = args.includes('--force')
const BASE_URL = arg('--base', 'https://compute-circuit.vercel.app')

// ---------- resolver (ported from src/lib/logo-resolver.ts) ----------

async function resolveDomainForCompany(name, ticker) {
  const wiki = await tryWikipedia(name, ticker)
  if (wiki) return { domain: wiki, source: 'wikipedia' }
  const ddg = await tryDuckDuckGo(name, ticker)
  if (ddg) return { domain: ddg, source: 'duckduckgo' }
  return null
}

async function verifyLogoForDomain(domain, baseUrl) {
  try {
    const headRes = await fetch(`${baseUrl}/api/logo/${encodeURIComponent(domain)}`, {
      method: 'HEAD',
      headers: { 'User-Agent': UA },
    })
    if (!headRes.ok) return 'missing'
    const lenHeader = headRes.headers.get('content-length')
    const len = lenHeader ? parseInt(lenHeader, 10) : NaN
    if (Number.isFinite(len) && len > 0) {
      return len > DEFAULT_PLACEHOLDER_MAX_BYTES ? 'verified' : 'fallback'
    }
    const getRes = await fetch(`${baseUrl}/api/logo/${encodeURIComponent(domain)}`, {
      headers: { 'User-Agent': UA },
    })
    if (!getRes.ok) return 'missing'
    const buf = await getRes.arrayBuffer()
    return buf.byteLength > DEFAULT_PLACEHOLDER_MAX_BYTES ? 'verified' : 'fallback'
  } catch {
    return 'missing'
  }
}

async function tryWikipedia(name) {
  const cands = makeWikiCandidates(name)
  for (const slug of cands) {
    try {
      const sumRes = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(slug)}`,
        { headers: { 'User-Agent': UA, Accept: 'application/json' } },
      )
      if (!sumRes.ok) continue
      const j = await sumRes.json()
      if (j.type === 'disambiguation') continue
      const pageUrl = j.content_urls && j.content_urls.desktop && j.content_urls.desktop.page
      if (!pageUrl) continue
      const pageRes = await fetch(pageUrl, {
        headers: { 'User-Agent': UA, Accept: 'text/html' },
      })
      if (!pageRes.ok) continue
      const html = await pageRes.text()
      const d = extractWebsiteFromInfobox(html)
      if (d) return d
    } catch {
      continue
    }
  }
  return null
}

function makeWikiCandidates(name) {
  const out = []
  const base = name.trim().replace(/\s+/g, '_')
  if (base) out.push(base)
  const stripped = name
    .replace(/\b(Holdings|Holding|Inc\.?|Corp\.?|Corporation|Company|Co\.?|Ltd\.?|Limited|LLC|PLC|Group|N\.V\.|S\.A\.|SA|AG|S\.p\.A\.)\b/gi, '')
    .replace(/[.,]/g, '')
    .trim()
    .replace(/\s+/g, '_')
  if (stripped && stripped !== base) out.push(stripped)
  return out
}

function extractWebsiteFromInfobox(html) {
  const m = html.match(/<table[^>]*class="[^"]*infobox[^"]*"[\s\S]*?<\/table>/i)
  if (!m) return null
  const ib = m[0]
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  let row
  while ((row = rowRe.exec(ib))) {
    const inner = row[1]
    if (!/<th[^>]*>[\s\S]*?(?:Website|Web\s*site)[\s\S]*?<\/th>/i.test(inner)) continue
    const href = inner.match(/<a[^>]*href="(https?:\/\/[^"]+)"/i)
    if (href) {
      const d = hrefToDomain(href[1])
      if (d) return d
    }
    const span = inner.match(/<span[^>]*class="[^"]*\burl\b[^"]*"[^>]*>([^<]+)</i)
    if (span) {
      const d = hrefToDomain('http://' + span[1].trim())
      if (d) return d
    }
    return null
  }
  return null
}

async function tryDuckDuckGo(name, ticker) {
  const q = ticker ? `${name} ${ticker}` : name
  try {
    const r = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`,
      { headers: { 'User-Agent': UA, Accept: 'application/json' } },
    )
    if (!r.ok) return null
    const j = await r.json()
    if (j.AbstractURL) {
      const d = hrefToDomain(j.AbstractURL)
      if (d) return d
    }
    const first = j.Results && j.Results[0] && j.Results[0].FirstURL
    if (first) {
      const d = hrefToDomain(first)
      if (d) return d
    }
    return null
  } catch {
    return null
  }
}

function hrefToDomain(href) {
  try {
    const u = new URL(href)
    let h = u.hostname.toLowerCase()
    if (h.startsWith('www.')) h = h.slice(4)
    if (!h.includes('.')) return null
    if (/\b(wikipedia|wikimedia)\.org$/i.test(h)) return null
    return h
  } catch {
    return null
  }
}

// ---------- main ----------

;(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL is not set (expected in .env.local)')
    process.exit(1)
  }

  const dbUrl = new URL(process.env.DATABASE_URL)
  const password = decodeURIComponent(dbUrl.password)
  // hostname is 'db.<projectRef>.supabase.co' — take parts[1] when present.
  const parts = dbUrl.hostname.split('.')
  const projectRef = parts[0] === 'db' ? parts[1] : parts[0]
  const poolerHost = process.env.POOLER_HOST || `aws-1-${process.env.POOLER_REGION || 'us-west-1'}.pooler.supabase.com`
  const poolerUser = `postgres.${projectRef}`
  const c = new Client({
    host: poolerHost,
    port: 5432,
    user: poolerUser,
    password,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  })
  await c.connect()

  let sql = 'select id, name, ticker, domain, logo_status from companies'
  const where = []
  const params = []
  if (ONLY) {
    where.push(`id = $${params.length + 1}`)
    params.push(ONLY)
  } else if (!FORCE) {
    where.push(`(logo_status is null or logo_status in ('pending', 'missing'))`)
  }
  if (where.length) sql += ' where ' + where.join(' and ')
  sql += ' order by name'
  if (LIMIT) sql += ` limit ${LIMIT}`

  const list = await c.query(sql, params)
  console.log(`Worklist: ${list.rows.length} cos (base=${BASE_URL}, force=${FORCE}, only=${ONLY || 'all'})`)
  if (list.rows.length === 0) {
    console.log('Nothing to do.')
    await c.end()
    return
  }

  const tally = { verified: 0, fallback: 0, missing: 0, newDomain: 0 }
  const sampleFirstN = 10
  const samples = []
  let i = 0
  for (const co of list.rows) {
    i++
    let domain = co.domain
    let source = null
    if (!domain) {
      const r = await resolveDomainForCompany(co.name, co.ticker)
      if (r) {
        domain = r.domain
        source = r.source
        tally.newDomain++
      }
    }
    let status = 'missing'
    if (domain) {
      status = await verifyLogoForDomain(domain, BASE_URL)
    }
    tally[status]++

    const upd = ['logo_status = $2', 'logo_verified_at = now()']
    const updParams = [co.id, status]
    if (!co.domain && domain) {
      upd.push(`domain = $${updParams.length + 1}`)
      updParams.push(domain)
    }
    await c.query(`update companies set ${upd.join(', ')} where id = $1`, updParams)

    const tag = (co.ticker || co.id).toUpperCase().padEnd(10)
    const line = `${String(i).padStart(3)}/${list.rows.length} ${tag} ${co.name.padEnd(34).slice(0, 34)} ${status.padEnd(9)} ${(domain || '-').padEnd(28).slice(0, 28)} ${source ? '(' + source + ')' : ''}`
    console.log(line)

    if (samples.length < sampleFirstN) {
      samples.push({
        id: co.id,
        name: co.name,
        ticker: co.ticker,
        domain_before: co.domain,
        domain_after: domain,
        source,
        status,
      })
    }

    await new Promise(r => setTimeout(r, SLEEP_MS))
  }

  console.log('')
  console.log(`=== Tally: ${tally.verified} verified · ${tally.fallback} fallback · ${tally.missing} missing · ${tally.newDomain} new domains resolved ===`)
  console.log('')
  console.log('First 10 sample:')
  console.log(JSON.stringify(samples, null, 2))
  await c.end()
})().catch(e => {
  console.error('FATAL', e)
  process.exit(1)
})

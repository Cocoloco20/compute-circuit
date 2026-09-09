/**
 * Resolve who a fund's portfolio entry actually IS.
 *
 * Most funds publish a NAME and a link into their own site. Joining that to one
 * of our rows by name is a guess: Accel's "Astro" is Indonesian grocery
 * delivery, Lightspeed's is the web framework, ours was a Texas solar
 * developer. The fund's own company page carries the outbound link that settles
 * it, so fetch that page once per entry and read the real domain off it.
 *
 * Read-only against fund sites, one page per entry, modest concurrency, and it
 * writes only two things: companies.domain when we had none, and
 * company_backers.match_method='domain' + source_url when the link is proven.
 * An entry that cannot be resolved is left exactly as it was.
 */
require('dotenv').config({ path: '/Users/luiguisanchez/compute-circuit/.env.local' })
const fs = require('fs'), path = require('path')
const { createClient } = require('@supabase/supabase-js')

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } })
const DIR = '/Users/luiguisanchez/fund-os-research/portfolios'
const UA = 'compute-circuit/1.0 (+research; contact via site owner)'
const CONCURRENCY = 6
const TIMEOUT = 12000

const page = async (q) => { const o = []; for (let f = 0;; f += 1000) { const { data } = await q.range(f, f + 999); const r = data || []; o.push(...r); if (r.length < 1000) return o } }
const rootOf = d => (d || '').replace(/^www\./, '')

// Hosts that are never a company's own site.
// Boilerplate that appears on essentially every fund page and outranked the
// real company link on the first pass: the XFN profile microformat, font CDNs,
// asset buckets, social, press. Without these the "first outbound link" was
// gmpg.org 900+ times, which then read as a company-identity mismatch.
const JUNK = /(^|\.)(gmpg|w3|schema|gravatar|gstatic|googleapis|googletagmanager|google-analytics|doubleclick|cloudfront|amazonaws|akamai|cdn|jsdelivr|unpkg|typekit|fontawesome|vimeo|twitter|x|linkedin|facebook|instagram|youtube|tiktok|crunchbase|medium|github|bloomberg|techcrunch|wikipedia|google|apple|forbes|wsj|nytimes|reuters|substack|notion|docsend|calendly|mailto|pitchbook|sec)\./i

function outboundLinks(html, fundHost) {
  const out = []
  for (const m of html.matchAll(/href=["'](https?:\/\/[^"']+)["']/gi)) {
    try {
      const h = new URL(m[1]).hostname.replace(/^www\./, '')
      if (!h || h === fundHost || h.endsWith('.' + fundHost)) continue
      if (JUNK.test(h + '.')) continue
      out.push(h)
    } catch {}
  }
  return out
}

;(async () => {
  const files = {}
  for (const f of fs.readdirSync(DIR)) if (f.endsWith('.json')) { const d = JSON.parse(fs.readFileSync(path.join(DIR, f))); files[d.fund] = d }

  const links = await page(sb.from('company_backers').select('company_id,investor_id,match_method'))
  const todo = links.filter(l => l.match_method === 'slug' || l.match_method === 'name')
  const cos = await page(sb.from('companies').select('id,name,domain'))
  const byId = new Map(cos.map(c => [c.id, c]))

  // Only entries whose fund page URL is fetchable.
  const jobs = []
  for (const l of todo) {
    const c = byId.get(l.company_id); const d = files[l.investor_id]
    if (!c || !d) continue
    const e = (d.companies || []).find(x => (x.name || '').trim().toLowerCase() === (c.name || '').trim().toLowerCase())
    if (!e || !e.url || !/^https?:\/\//.test(e.url) || e.url.includes('localhost')) continue
    jobs.push({ link: l, co: c, url: e.url, fundHost: rootOf(d.domain || '') })
  }
  console.log(`${todo.length} unverified links; ${jobs.length} have a fetchable fund page`)

  const stats = { resolved: 0, mismatch: 0, nolink: 0, fetchfail: 0, domainAdded: 0 }
  const updates = [], domainUpdates = []

  for (let i = 0; i < jobs.length; i += CONCURRENCY) {
    await Promise.all(jobs.slice(i, i + CONCURRENCY).map(async j => {
      let html
      try {
        const r = await fetch(j.url, { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT),
          headers: { 'User-Agent': UA, Accept: 'text/html' } })
        if (!r.ok) { stats.fetchfail++; return }
        html = (await r.text()).slice(0, 300000)
      } catch { stats.fetchfail++; return }

      const cands = outboundLinks(html, j.fundHost)
      if (!cands.length) { stats.nolink++; return }
      const top = cands[0]

      if (j.co.domain) {
        if (rootOf(j.co.domain) === top || cands.includes(rootOf(j.co.domain))) {
          updates.push({ company_id: j.link.company_id, investor_id: j.link.investor_id,
                         match_method: 'domain', source_url: j.url })
          stats.resolved++
        } else stats.mismatch++
      } else {
        domainUpdates.push({ id: j.co.id, domain: top })
        updates.push({ company_id: j.link.company_id, investor_id: j.link.investor_id,
                       match_method: 'domain', source_url: j.url })
        stats.resolved++; stats.domainAdded++
      }
    }))
    if (i % 300 === 0) console.log(`  ${i}/${jobs.length}  ${JSON.stringify(stats)}`)
  }

  for (let i = 0; i < updates.length; i += 500)
    await sb.from('company_backers').upsert(updates.slice(i, i + 500), { onConflict: 'company_id,investor_id' })
  for (const d of domainUpdates) await sb.from('companies').update({ domain: d.domain }).eq('id', d.id)

  console.log('DONE', JSON.stringify(stats))
})()

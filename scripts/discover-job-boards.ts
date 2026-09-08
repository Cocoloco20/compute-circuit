/**
 * Discover public ATS job boards for tracked companies.
 *
 * WHY. /api/cron/jobs reads JOB_BOARDS in src/lib/jobs.ts — a hand-verified
 * map of ~20 slugs, last touched 2026-05. It has run faithfully every night
 * since and produced 78 rows total, because 20 of 11,141 companies are in the
 * map. Hiring is the strongest early-stage "why now" signal we can get for
 * free, and it has been covering 0.2% of the universe.
 *
 * HOW. Greenhouse, Lever and Ashby all expose a public JSON board API keyed by
 * a slug. A slug guessed from the company name or domain is verifiable in one
 * request: 200 with jobs means the board is real, anything else means it is
 * not. No credentials, no scraping — these are the endpoints the companies
 * publish for exactly this purpose.
 *
 *   npx tsx scripts/discover-job-boards.ts --limit 100 --dry-run
 *   npx tsx scripts/discover-job-boards.ts --fundable      # YC active, recent
 *
 * Writes verified hits to supabase/generated/job-boards.json for review, and
 * never edits jobs.ts automatically — a wrong slug silently attributes another
 * company's hiring to this one, which is worse than no data.
 */

import { config } from 'dotenv'
import { writeFileSync, mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

config({ path: new URL('../.env.local', import.meta.url).pathname })

const DRY = process.argv.includes('--dry-run')
const FUNDABLE = process.argv.includes('--fundable')
const LIMIT = Number(process.argv[process.argv.indexOf('--limit') + 1]) || 200
/** Polite pacing: these are free public endpoints, not ours to hammer. */
const DELAY_MS = 150
const CONCURRENCY = 4

type Provider = 'greenhouse' | 'lever' | 'ashby'

const ENDPOINTS: Record<Provider, (s: string) => string> = {
  greenhouse: s => `https://boards-api.greenhouse.io/v1/boards/${s}/jobs`,
  lever:      s => `https://api.lever.co/v0/postings/${s}?mode=json`,
  ashby:      s => `https://api.ashbyhq.com/posting-api/job-board/${s}`,
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Candidate slugs, most likely first. Fewer, better guesses beat many. */
function candidates(name: string, domain: string | null): string[] {
  const out = new Set<string>()
  const clean = name.toLowerCase()
    .replace(/[''’]/g, '')
    .replace(/\b(inc|corp|corporation|llc|ltd|labs?|technologies|technology|co)\b/g, '')
    .trim()
  const slug = clean.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (slug) { out.add(slug); out.add(slug.replace(/-/g, '')) }
  if (domain) {
    // The registrable label is usually the brand, and usually the slug.
    const label = domain.replace(/^www\./, '').split('.')[0]
    if (label && label.length > 1) out.add(label)
  }
  return [...out].filter(s => s.length >= 2 && s.length <= 40).slice(0, 3)
}

/** Returns the open-req count when the board is real, else null. */
async function probe(provider: Provider, slug: string): Promise<number | null> {
  try {
    const r = await fetch(ENDPOINTS[provider](slug), {
      signal: AbortSignal.timeout(9000),
      headers: { Accept: 'application/json', 'User-Agent': 'compute-circuit/1.0 (research)' },
    })
    if (!r.ok) return null
    const body = await r.json() as Record<string, unknown>
    const jobs = (body.jobs ?? body.postings ?? body) as unknown
    if (Array.isArray(jobs)) return jobs.length
    if (typeof body.jobs === 'object' && body.jobs) return Object.keys(body.jobs).length
    return null
  } catch {
    return null
  }
}

interface Hit { id: string; name: string; provider: Provider; slug: string; openReqs: number }

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase env missing — expected .env.local')
  const sb = createClient(url, key, { auth: { persistSession: false } })

  let targets: Array<{ id: string; name: string; domain: string | null }> = []

  if (FUNDABLE) {
    // The subset worth the requests: alive, small, recent. A dead company's
    // board tells us nothing and costs the same three probes.
    const { data: yc } = await sb.from('yc_companies')
      .select('company_id')
      .eq('status', 'Active').lte('team_size', 40)
      .order('batch', { ascending: false }).limit(LIMIT)
    const ids = ((yc ?? []) as Array<{ company_id: string }>).map(y => y.company_id)
    if (ids.length) {
      const { data } = await sb.from('companies').select('id, name, domain').in('id', ids)
      targets = (data ?? []) as typeof targets
    }
  } else {
    const { data } = await sb.from('companies')
      .select('id, name, domain').not('domain', 'is', null).order('id').limit(LIMIT)
    targets = (data ?? []) as typeof targets
  }

  console.log(`probing ${targets.length} companies (${FUNDABLE ? 'fundable subset' : 'by id'})`)
  if (DRY) {
    for (const t of targets.slice(0, 10)) {
      console.log(`  ${t.name} → ${candidates(t.name, t.domain).join(', ')}`)
    }
    console.log('\n--dry-run: no requests made.')
    return
  }

  const hits: Hit[] = []
  let done = 0

  async function work(t: { id: string; name: string; domain: string | null }) {
    for (const slug of candidates(t.name, t.domain)) {
      for (const provider of ['greenhouse', 'lever', 'ashby'] as Provider[]) {
        const n = await probe(provider, slug)
        await sleep(DELAY_MS)
        // A board with zero open reqs is indistinguishable from a stale slug
        // that happens to resolve, so require at least one posting.
        if (n != null && n > 0) {
          hits.push({ id: t.id, name: t.name, provider, slug, openReqs: n })
          console.log(`  ✓ ${t.name} → ${provider}:${slug} (${n} open)`)
          return
        }
      }
    }
  }

  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    await Promise.all(targets.slice(i, i + CONCURRENCY).map(work))
    done += Math.min(CONCURRENCY, targets.length - i)
    if (done % 40 === 0) process.stdout.write(`\r  probed ${done}/${targets.length}, ${hits.length} boards found`)
  }
  console.log('')

  mkdirSync(new URL('../supabase/generated/', import.meta.url).pathname, { recursive: true })
  const out = new URL('../supabase/generated/job-boards.json', import.meta.url).pathname
  writeFileSync(out, JSON.stringify({
    generated_at: new Date().toISOString(),
    probed: targets.length,
    found: hits.length,
    boards: hits.sort((a, b) => b.openReqs - a.openReqs),
  }, null, 1))

  console.log(`\n${hits.length} boards found across ${targets.length} companies ` +
    `(${((hits.length / Math.max(1, targets.length)) * 100).toFixed(0)}% hit rate)`)
  console.log(`written to ${out}`)
  console.log('Review before merging into JOB_BOARDS — a wrong slug attributes another company\'s hiring to this one.')
}

main().catch(e => { console.error('\nFATAL', e); process.exit(1) })

// Compute Circuit — read-only data quality audit
// Run: node scripts/data-quality-audit.js
//
// Produces a report covering:
//   1) Suspected duplicate company pairs (Levenshtein ≤ 2 on id OR same domain OR same ticker)
//   2) Naming inconsistencies (capitalization vs. likely canonical form)
//   3) Cos with stale assignee_name (null patent data despite assignee_name set)
//   4) Cos with stale hf_org (HF API returns null/empty despite hf_org set)
//   5) Cos with no recent activity (no signals/flows/snapshots) — suggested defunct list

const { Client } = require('pg')
require('dotenv').config({ path: '/Users/luiguisanchez/compute-circuit/.env.local' })

const UA = 'compute-circuit (research tool) luigui.h2002@gmail.com'

// ------- helpers -------
function levenshtein(a, b) {
  if (a === b) return 0
  const al = a.length, bl = b.length
  if (al === 0) return bl
  if (bl === 0) return al
  const v0 = new Array(bl + 1)
  const v1 = new Array(bl + 1)
  for (let i = 0; i <= bl; i++) v0[i] = i
  for (let i = 0; i < al; i++) {
    v1[0] = i + 1
    for (let j = 0; j < bl; j++) {
      const cost = a[i] === b[j] ? 0 : 1
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost)
    }
    for (let j = 0; j <= bl; j++) v0[j] = v1[j]
  }
  return v1[bl]
}

// crude "all caps" / "lowercase" sniff vs reasonable title-case
function looksMiscapitalized(name) {
  if (!name) return false
  const trimmed = name.trim()
  if (trimmed === trimmed.toUpperCase() && trimmed !== trimmed.toLowerCase() && trimmed.length > 4 && /[a-z]/i.test(trimmed)) return true
  if (trimmed === trimmed.toLowerCase() && trimmed !== trimmed.toUpperCase() && /[a-z]/.test(trimmed) && trimmed.length > 2) return true
  return false
}

// ------- main -------
;(async () => {
  const u = new URL(process.env.DATABASE_URL)
  const password = decodeURIComponent(u.password)
  const c = new Client({
    host: 'aws-1-us-west-1.pooler.supabase.com', port: 5432,
    user: 'postgres.moeqxxsmksjdayaeblit', password, database: 'postgres',
    ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 6000,
  })
  await c.connect()

  // ---- Load all 105 companies + per-co linked-row counts (used as "data weight" for dedup tiebreaker) ----
  const { rows: cos } = await c.query(`
    select
      c.id, c.name, c.ticker, c.domain, c.hf_org, c.assignee_name,
      c.discovered_via, c.created_at,
      coalesce(sc.n, 0)::int  as n_signals,
      coalesce(fr.n, 0)::int  as n_funding,
      coalesce(ht.n, 0)::int  as n_holdings,
      coalesce(fl.n, 0)::int  as n_flows,
      coalesce(cb.n, 0)::int  as n_backers,
      coalesce(ps.n, 0)::int  as n_patent_snaps,
      coalesce(ha.n, 0)::int  as n_hf_snaps,
      coalesce(it.n, 0)::int  as n_insider,
      coalesce(js.n, 0)::int  as n_jobs,
      coalesce(gh.n, 0)::int  as n_github,
      coalesce(ts.n, 0)::int  as n_transcripts,
      coalesce(gd.n, 0)::int  as n_grid,
      coalesce(bb.n, 0)::int  as n_bottlenecks,
      coalesce(fnd.n, 0)::int as n_fundamentals,
      coalesce(ml.n, 0)::int  as n_leaderboard,
      coalesce(sm.n, 0)::int  as n_social
    from companies c
    left join (select company_id, count(*) n from signal_companies group by company_id) sc on sc.company_id=c.id
    left join (select company_id, count(*) n from funding_rounds  group by company_id) fr on fr.company_id=c.id
    left join (select company_id, count(*) n from holdings        group by company_id) ht on ht.company_id=c.id
    left join (
      select co_id as company_id, count(*) n from (
        select from_id as co_id from flows where from_kind='company'
        union all
        select to_id as co_id from flows where to_kind='company'
      ) x group by co_id
    ) fl on fl.company_id=c.id
    left join (select company_id, count(*) n from company_backers     group by company_id) cb on cb.company_id=c.id
    left join (select company_id, count(*) n from patent_snapshots    group by company_id) ps on ps.company_id=c.id
    left join (select company_id, count(*) n from hf_activity         group by company_id) ha on ha.company_id=c.id
    left join (select company_id, count(*) n from insider_transactions group by company_id) it on it.company_id=c.id
    left join (select company_id, count(*) n from job_snapshots       group by company_id) js on js.company_id=c.id
    left join (select company_id, count(*) n from github_activity     group by company_id) gh on gh.company_id=c.id
    left join (select company_id, count(*) n from transcript_signals  group by company_id) ts on ts.company_id=c.id
    left join (select company_id, count(*) n from grid_demand_snapshots group by company_id) gd on gd.company_id=c.id
    left join (select company_id, count(*) n from bottleneck_beneficiaries group by company_id) bb on bb.company_id=c.id
    left join (select company_id, count(*) n from fundamentals        group by company_id) fnd on fnd.company_id=c.id
    left join (select company_id, count(*) n from model_leaderboard   group by company_id) ml on ml.company_id=c.id
    left join (select company_id, count(*) n from social_mentions     group by company_id) sm on sm.company_id=c.id
    order by c.id
  `)
  console.log(`Loaded ${cos.length} companies\n`)

  // most-recent signal date per co
  const { rows: lastSig } = await c.query(`
    select sc.company_id, max(s.date) as last_signal
    from signal_companies sc
    join signals s on s.id = sc.signal_id
    group by sc.company_id
  `)
  const lastSigMap = new Map(lastSig.map(r => [r.company_id, r.last_signal]))

  // most-recent funding round (column: filed_date)
  const { rows: lastFund } = await c.query(`select company_id, max(filed_date) as last_round from funding_rounds group by company_id`)
  const lastFundMap = new Map(lastFund.map(r => [r.company_id, r.last_round]))

  // most-recent job snapshot
  const { rows: lastJob } = await c.query(`select company_id, max(snapshot_date) as last_job from job_snapshots group by company_id`)
  const lastJobMap = new Map(lastJob.map(r => [r.company_id, r.last_job]))

  // ---- 1) Duplicate detection ----
  console.log('═══════════════════════════════════════════════════════════════')
  console.log(' SECTION 1: SUSPECTED DUPLICATES')
  console.log('═══════════════════════════════════════════════════════════════')
  const dupPairs = []
  for (let i = 0; i < cos.length; i++) {
    for (let j = i + 1; j < cos.length; j++) {
      const a = cos[i], b = cos[j]
      const reasons = []
      let conf = 0
      const lev = levenshtein(a.id, b.id)
      if (lev <= 2) { reasons.push(`id Levenshtein=${lev}`); conf += (3 - lev) * 0.3 }
      if (a.domain && b.domain && a.domain.toLowerCase() === b.domain.toLowerCase()) {
        reasons.push(`same domain (${a.domain})`); conf += 0.6
      }
      if (a.ticker && b.ticker && a.ticker.toUpperCase() === b.ticker.toUpperCase()) {
        reasons.push(`same ticker (${a.ticker})`); conf += 0.5
      }
      if (a.name && b.name && a.name.toLowerCase().trim() === b.name.toLowerCase().trim()) {
        reasons.push(`same name (${a.name})`); conf += 0.5
      }
      if (reasons.length === 0) continue
      dupPairs.push({ a, b, reasons, conf: Math.min(1, conf) })
    }
  }
  dupPairs.sort((x, y) => y.conf - x.conf)
  if (dupPairs.length === 0) console.log('(no candidate pairs)')
  for (const p of dupPairs) {
    const sumWeight = (c) =>
      c.n_signals + c.n_funding + c.n_holdings + c.n_flows + c.n_backers +
      c.n_patent_snaps + c.n_hf_snaps + c.n_insider + c.n_jobs + c.n_github +
      c.n_transcripts + c.n_grid + c.n_bottlenecks + c.n_fundamentals +
      c.n_leaderboard + c.n_social
    const aWeight = sumWeight(p.a)
    const bWeight = sumWeight(p.b)
    const keep = aWeight >= bWeight ? p.a.id : p.b.id
    const drop = aWeight >= bWeight ? p.b.id : p.a.id
    console.log(`  conf=${p.conf.toFixed(2)}  ${p.a.id} (w=${aWeight})  vs  ${p.b.id} (w=${bWeight})`)
    console.log(`    reasons: ${p.reasons.join(', ')}`)
    console.log(`    suggest: keep '${keep}' / drop '${drop}'`)
  }

  // ---- 2) Naming inconsistencies ----
  console.log('\n═══════════════════════════════════════════════════════════════')
  console.log(' SECTION 2: NAMING INCONSISTENCIES')
  console.log('═══════════════════════════════════════════════════════════════')
  const namingIssues = cos.filter(c => looksMiscapitalized(c.name))
  if (namingIssues.length === 0) console.log('(none)')
  for (const r of namingIssues) {
    console.log(`  ${r.id.padEnd(20)} name='${r.name}'  domain=${r.domain || '-'}`)
  }

  // ---- 3) Stale assignee_name ----
  console.log('\n═══════════════════════════════════════════════════════════════')
  console.log(' SECTION 3: STALE assignee_name (USPTO returns null patents)')
  console.log('═══════════════════════════════════════════════════════════════')
  const { rows: stalePat } = await c.query(`
    select c.id, c.name, c.assignee_name,
      (select max(snapshot_date) from patent_snapshots ps where ps.company_id=c.id) as last_snap,
      coalesce((select sum(ttm_count) from patent_snapshots ps where ps.company_id=c.id), 0)::int as total_filings
    from companies c
    where c.assignee_name is not null
    order by c.id
  `)
  let staleAssigneeFlag = []
  for (const r of stalePat) {
    const stale = (r.total_filings === 0 || r.last_snap == null)
    const flag = stale ? '⚠️  STALE' : '   ok'
    console.log(`  ${flag}  ${r.id.padEnd(20)} assignee='${r.assignee_name}' total=${r.total_filings} last=${r.last_snap || 'never'}`)
    if (stale) staleAssigneeFlag.push(r.id)
  }
  console.log(`  --> ${staleAssigneeFlag.length} stale assignee_name`)

  // ---- 4) Stale hf_org (live-fetch HF) ----
  console.log('\n═══════════════════════════════════════════════════════════════')
  console.log(' SECTION 4: STALE hf_org (Hugging Face returns null/empty)')
  console.log('═══════════════════════════════════════════════════════════════')
  const { rows: hfRows } = await c.query(`
    select c.id, c.name, c.hf_org,
      (select max(snapshot_date) from hf_activity h where h.company_id=c.id) as last_snap,
      coalesce((select sum(model_count) from hf_activity h where h.company_id=c.id), 0)::numeric as total_models_seen
    from companies c
    where c.hf_org is not null
    order by c.id
  `)
  const hfBroken = []
  for (const r of hfRows) {
    let live = '?'
    try {
      const url = `https://huggingface.co/api/models?author=${encodeURIComponent(r.hf_org)}&limit=1`
      const resp = await fetch(url, { headers: { 'User-Agent': UA } })
      if (!resp.ok) live = `HTTP ${resp.status}`
      else {
        const j = await resp.json()
        live = Array.isArray(j) && j.length > 0 ? 'OK' : 'empty'
      }
    } catch (e) {
      live = `err: ${e.message}`
    }
    const flag = (live !== 'OK') ? '⚠️  ' : '   '
    console.log(`  ${flag}${r.id.padEnd(20)} hf_org='${r.hf_org}' live=${live} db_total_models=${r.total_models_seen} last=${r.last_snap || 'never'}`)
    if (live !== 'OK') hfBroken.push({ id: r.id, hf_org: r.hf_org, status: live })
    await new Promise(rr => setTimeout(rr, 120))
  }
  console.log(`  --> ${hfBroken.length} HF orgs not returning models`)

  // ---- 5) No-recent-activity / defunct candidates ----
  console.log('\n═══════════════════════════════════════════════════════════════')
  console.log(' SECTION 5: COS WITH NO RECENT ACTIVITY (defunct candidates)')
  console.log('═══════════════════════════════════════════════════════════════')
  const SIX_MONTHS_DAYS = 180
  const today = Date.now()
  const defunctCandidates = []
  for (const co of cos) {
    if (!co.discovered_via) continue
    const lastSignal = lastSigMap.get(co.id)
    const lastFunding = lastFundMap.get(co.id)
    const lastJobDate = lastJobMap.get(co.id)
    const latest = [lastSignal, lastFunding, lastJobDate].filter(Boolean)
      .map(d => new Date(d).getTime())
      .reduce((a, b) => Math.max(a, b), 0)
    const ageDays = latest === 0 ? '∞' : Math.round((today - latest) / 86400000)
    const stale = (latest === 0 || (today - latest) / 86400000 > SIX_MONTHS_DAYS)
    const flag = stale ? '⚠️  DEFUNCT?' : '   active'
    console.log(`  ${flag}  ${co.id.padEnd(20)} disc=${co.discovered_via} created=${co.created_at.toISOString().slice(0,10)} last_activity=${latest === 0 ? 'never' : new Date(latest).toISOString().slice(0,10)} (${ageDays}d)`)
    if (stale) defunctCandidates.push(co.id)
  }
  console.log(`  --> ${defunctCandidates.length} defunct candidates`)

  await c.end()
  console.log('\n=== audit complete ===')
})().catch(e => { console.error('FATAL', e); process.exit(1) })

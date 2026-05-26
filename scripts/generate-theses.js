/**
 * One-shot AI-thesis generator.
 *
 * For every company in our DB that doesn't have a non-trivial thesis_ai yet
 * (NULL or LENGTH < 30), call Claude Sonnet 4.5 to write a 2-sentence summary
 * and 1-sentence risk/opportunity, then persist them to
 *   companies.thesis_ai
 *   companies.thesis_risk_ai
 *   companies.thesis_generated_at
 *
 * IDEMPOTENT — skips companies that already have a thesis_ai. To force a re-run
 * for one company, manually NULL the thesis_ai column first.
 *
 * Cost envelope: Sonnet 4.5 is ~$3/MTok in, ~$15/MTok out. Per company we send
 * ~600 input tokens and receive ~120 output tokens — so ~$0.005 per company,
 * or ~$0.50 for the full 105-company seed.
 *
 * Usage:
 *   node scripts/generate-theses.js               # generate for all missing
 *   node scripts/generate-theses.js --limit 5     # smoke test (first 5)
 *   node scripts/generate-theses.js --only nvda   # one company by id
 *   node scripts/generate-theses.js --force       # regenerate even if filled
 */

const { Client } = require('pg')
const Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk').Anthropic
require('dotenv').config({ path: '/Users/luiguisanchez/compute-circuit/.env.local' })

const OPUS_MODEL = 'claude-3-opus-20240229'
const HAIKU_MODEL = 'claude-3-5-haiku-20241022'
const SLEEP_MS = 200

const PRICING = {
  'claude-3-opus-20240229': { input: 15 / 1000000, output: 75 / 1000000 },
  'claude-3-5-haiku-20241022': { input: 0.80 / 1000000, output: 4.00 / 1000000 }
}

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

// ---------- prompt ----------

const SYSTEM_PROMPT = `You are a sober Wall Street analyst specializing in AI compute infrastructure. Write in the Bloomberg DES house style: dense, factual, no hype, no marketing language. Refer to specific data when available. Never use the word "innovative", "cutting-edge", "leading", "world-class", "best-in-class", "transformative", or "revolutionary". Prefer concrete nouns and verbs over adjectives. No emojis. No exclamation marks.`

function buildUserPrompt(co, ctx) {
  const lines = []
  lines.push(`Write an analyst thesis card for the following AI-compute company.`)
  lines.push(``)
  lines.push(`COMPANY`)
  lines.push(`  id:        ${co.id}`)
  lines.push(`  name:      ${co.name}`)
  if (co.ticker)        lines.push(`  ticker:    ${co.ticker}`)
  if (co.layer_id)      lines.push(`  layer:     ${co.layer_id}  (where in the AI-compute stack)`)
  if (co.domain)        lines.push(`  domain:    ${co.domain}`)
  if (co.share != null) lines.push(`  share:     ${(Number(co.share) * 100).toFixed(1)}%  (market or segment share, internal estimate)`)
  if (co.conviction)    lines.push(`  conviction:${co.conviction}  (analyst's prior conviction)`)
  if (co.position_held) lines.push(`  note:      we hold a position`)
  if (co.thesis)        lines.push(`  prior_thesis (manual draft, may be stale): ${co.thesis}`)

  const hasCtx =
    (ctx.recent_8k_headlines?.length || 0) +
    (ctx.recent_news_headlines?.length || 0) +
    (ctx.top_patent_subclasses?.length || 0) +
    (ctx.hiring_top_categories?.length || 0) > 0 ||
    ctx.latest_funding ||
    ctx.hiring_open != null

  if (hasCtx) {
    lines.push(``)
    lines.push(`RECENT SIGNALS`)
    if (ctx.recent_8k_headlines?.length) {
      lines.push(`  Recent 8-K filings:`)
      ctx.recent_8k_headlines.slice(0, 5).forEach(h => lines.push(`    - ${h}`))
    }
    if (ctx.recent_news_headlines?.length) {
      lines.push(`  Recent news:`)
      ctx.recent_news_headlines.slice(0, 5).forEach(h => lines.push(`    - ${h}`))
    }
    if (ctx.top_patent_subclasses?.length) {
      const sub = ctx.top_patent_subclasses
        .slice(0, 3)
        .map(s => `${s.code} (×${s.count})`)
        .join(', ')
      lines.push(`  Top patent subclasses (TTM): ${sub}`)
    }
    if (ctx.latest_funding) {
      const amt = ctx.latest_funding.amount_usd != null
        ? `$${(ctx.latest_funding.amount_usd / 1_000_000).toFixed(0)}M`
        : 'undisclosed'
      const inv = (ctx.latest_funding.investors_named || []).slice(0, 5).join(', ')
      lines.push(`  Latest funding: ${amt} filed ${ctx.latest_funding.filed_date}${inv ? ` · investors: ${inv}` : ''}`)
    }
    if (ctx.hiring_open != null) {
      const top = (ctx.hiring_top_categories || []).slice(0, 3).map(c => `${c.name}×${c.count}`).join(', ')
      lines.push(`  Open roles: ${ctx.hiring_open}${top ? ` · top categories: ${top}` : ''}`)
    }
  }

  lines.push(``)
  lines.push(`OUTPUT FORMAT`)
  lines.push(`Respond with STRICTLY a single JSON object, no prose before or after, no code fences:`)
  lines.push(`{`)
  lines.push(`  "thesis_summary": "<exactly 2 sentences. Sentence 1: what they do (no jargon). Sentence 2: why they matter for AI compute (the strategic angle).>",`)
  lines.push(`  "risk_opportunity": "<exactly 1 sentence. The primary risk OR primary opportunity — pick whichever is more decision-relevant. Lead with the noun, e.g. 'CoWoS packaging capacity at TSMC remains the binding constraint on shipments.'>"`)
  lines.push(`}`)
  return lines.join('\n')
}

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fenced) return fenced[1].trim()
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first >= 0 && last > first) return text.slice(first, last + 1)
  return text
}

// ---------- context loaders ----------

async function loadContextFor(c, companyId) {
  const ctx = {}

  // Recent 8-Ks (last 8) + news (last 8) via signals + signal_companies.
  // We pull both then split by source.
  const sigsRes = await c.query(
    `select s.source, s.headline, s.date
       from signals s
       join signal_companies sc on sc.signal_id = s.id
      where sc.company_id = $1
      order by s.date desc
      limit 16`,
    [companyId],
  )
  const headlines8k = []
  const headlinesNews = []
  for (const row of sigsRes.rows) {
    const isFiling = (row.source || '').toLowerCase().includes('sec') ||
                     (row.source || '').toLowerCase().includes('edgar')
    if (isFiling && headlines8k.length < 5) headlines8k.push(row.headline)
    else if (!isFiling && headlinesNews.length < 5) headlinesNews.push(row.headline)
  }
  if (headlines8k.length) ctx.recent_8k_headlines = headlines8k
  if (headlinesNews.length) ctx.recent_news_headlines = headlinesNews

  // Top patent subclasses (latest snapshot)
  const patRes = await c.query(
    `select top_subclasses from patent_snapshots
      where company_id = $1
      order by snapshot_date desc
      limit 1`,
    [companyId],
  )
  if (patRes.rows[0]?.top_subclasses) {
    ctx.top_patent_subclasses = patRes.rows[0].top_subclasses
  }

  // Latest funding round
  const fundRes = await c.query(
    `select filed_date, total_amount_sold_usd, total_offering_amount_usd, investors_named
       from funding_rounds
      where company_id = $1
      order by filed_date desc
      limit 1`,
    [companyId],
  )
  if (fundRes.rows[0]) {
    const r = fundRes.rows[0]
    ctx.latest_funding = {
      filed_date: r.filed_date instanceof Date ? r.filed_date.toISOString().slice(0, 10) : String(r.filed_date).slice(0, 10),
      amount_usd: r.total_amount_sold_usd != null ? Number(r.total_amount_sold_usd) : (r.total_offering_amount_usd != null ? Number(r.total_offering_amount_usd) : null),
      investors_named: Array.isArray(r.investors_named) ? r.investors_named : [],
    }
  }

  // Hiring (latest snapshot)
  const jobRes = await c.query(
    `select total_open, top_categories from job_snapshots
      where company_id = $1
      order by snapshot_date desc
      limit 1`,
    [companyId],
  )
  if (jobRes.rows[0]) {
    ctx.hiring_open = Number(jobRes.rows[0].total_open)
    if (Array.isArray(jobRes.rows[0].top_categories)) {
      ctx.hiring_top_categories = jobRes.rows[0].top_categories
    }
  }

  return ctx
}

// ---------- main ----------

;(async () => {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('')
    console.error('  ERROR: ANTHROPIC_API_KEY is not set.')
    console.error('')
    console.error('  Add a line like this to .env.local (in the project root), then re-run:')
    console.error('    ANTHROPIC_API_KEY=sk-ant-...')
    console.error('')
    console.error('  Get a key at https://console.anthropic.com/settings/keys')
    console.error('')
    process.exit(1)
  }

  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL is not set (expected in .env.local).')
    process.exit(1)
  }

  const u = new URL(process.env.DATABASE_URL)
  const password = decodeURIComponent(u.password)
  const dbUrl = new URL(process.env.DATABASE_URL)
  const hostParts = dbUrl.hostname.split('.')
  const projectRef = hostParts[0] === 'db' ? hostParts[1] : hostParts[0]
  const poolerHost = process.env.POOLER_HOST || `aws-1-${process.env.POOLER_REGION || 'us-west-1'}.pooler.supabase.com`
  const poolerUser = `postgres.${projectRef}`
  const c = new Client({
    host: poolerHost, port: 5432,
    user: poolerUser,
    password,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  })
  await c.connect()

  const LOG_PATH = '/tmp/thesis-gen-progress.log'
  const fs = require('fs')

  function logProgress(msg) {
    const formatted = `[${new Date().toISOString()}] ${msg}\n`
    fs.appendFileSync(LOG_PATH, formatted)
    console.log(msg)
  }

  // Get the top 50 companies by market cap globally to use with Opus
  logProgress('Fetching top 50 companies by market cap for Opus routing...')
  const top50Res = await c.query(
    `select id from companies order by market_cap_usd desc nulls last limit 50`
  )
  const opusIds = new Set(top50Res.rows.map(r => r.id))
  logProgress(`Loaded ${opusIds.size} top companies for Opus model selection.`)

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  let ok = 0
  let fail = 0
  let totalCost = 0
  const CHUNK_SIZE = 50

  logProgress(`Starting thesis generation (force=${FORCE}, only=${ONLY || 'all'}, limit=${LIMIT || 'none'})`)

  while (true) {
    // Build the query to get the next chunk of companies
    let sql = `select id, ticker, name, domain, layer_id, position_held, share,
                      conviction, thesis, thesis_ai, market_cap_usd
                 from companies`
    const where = []
    const params = []
    if (ONLY) {
      where.push(`id = $${params.length + 1}`)
      params.push(ONLY)
    } else if (!FORCE) {
      where.push(`(thesis_ai is null or length(thesis_ai) < 30)`)
    }
    if (where.length) sql += ` where ` + where.join(' and ')
    sql += ` order by position_held desc, conviction nulls last, name`

    // Apply chunk limit
    let currentLimit = CHUNK_SIZE
    if (LIMIT) {
      const remaining = LIMIT - (ok + fail)
      if (remaining <= 0) break
      currentLimit = Math.min(CHUNK_SIZE, remaining)
    }
    sql += ` limit ${currentLimit}`

    const chunkRes = await c.query(sql, params)
    const rows = chunkRes.rows
    if (rows.length === 0) {
      logProgress('No more companies requiring thesis generation. Finished.')
      break
    }

    logProgress(`\n--- Processing batch of ${rows.length} companies (ok_so_far=${ok}, fail_so_far=${fail}, total_cost_so_far=$${totalCost.toFixed(4)}) ---`)

    for (const co of rows) {
      const isOpus = opusIds.has(co.id)
      const selectedModel = isOpus ? OPUS_MODEL : HAIKU_MODEL

      let attempts = 0
      let success = false

      while (attempts < 3 && !success) {
        attempts++
        try {
          const ctx = await loadContextFor(c, co.id)
          const userPrompt = buildUserPrompt(co, ctx)
          
          const resp = await anthropic.messages.create({
            model: selectedModel,
            max_tokens: 400,
            system: SYSTEM_PROMPT,
            messages: [{ role: 'user', content: userPrompt }],
          })

          const text = (resp.content || [])
            .filter(b => b.type === 'text')
            .map(b => b.text)
            .join('')
            .trim()

          const parsed = JSON.parse(extractJson(text))
          const summary = String(parsed.thesis_summary || '').trim()
          const risk = String(parsed.risk_opportunity || '').trim()

          if (!summary || !risk) {
            throw new Error(`Empty fields in model output: ${text.slice(0, 200)}`)
          }

          await c.query(
            `update companies
                set thesis_ai = $2,
                    thesis_risk_ai = $3,
                    thesis_generated_at = now()
              where id = $1`,
            [co.id, summary, risk],
          )

          const usage = resp.usage || { input_tokens: 0, output_tokens: 0 }
          const price = PRICING[selectedModel] || { input: 0, output: 0 }
          const cost = (usage.input_tokens * price.input) + (usage.output_tokens * price.output)
          totalCost += cost

          const tag = (co.ticker || co.id).toUpperCase()
          const preview = summary.length > 80 ? summary.slice(0, 77) + '...' : summary
          logProgress(`OK ${tag.padEnd(10)} [Model: ${selectedModel.split('-')[2]}] [Cost: $${cost.toFixed(4)}] "${preview}"`)
          
          success = true
          ok++
        } catch (e) {
          const isRateLimit = e.status === 429 || (e.message && e.message.includes('429'))
          if (isRateLimit && attempts < 3) {
            const delay = attempts * 15000
            logProgress(`Rate limit (429) on attempt ${attempts} for ${(co.ticker || co.id).toUpperCase()}. Sleeping ${delay / 1000}s...`)
            await new Promise(r => setTimeout(r, delay))
            continue
          }

          if (attempts === 3 || !isRateLimit) {
            fail++
            logProgress(`FAIL ${(co.ticker || co.id).toUpperCase().padEnd(10)} after ${attempts} attempt(s): ${e.message}`)
            break
          }
        }
      }

      await new Promise(r => setTimeout(r, SLEEP_MS))
    }

    if (ONLY) {
      break
    }
  }

  logProgress(`\n=== Final Report: ${ok} generated · ${fail} failed · Total cost: $${totalCost.toFixed(4)} ===`)
  await c.end()
})().catch(e => {
  console.error('FATAL', e)
  process.exit(1)
})

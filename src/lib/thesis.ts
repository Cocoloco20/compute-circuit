/**
 * AI thesis card generator.
 *
 * Calls Claude Sonnet 4.5 to produce a tight per-company analyst note grounded
 * in whatever context data we have on file. The output is two short fields:
 *   * thesis_summary    — "what they do + why they matter" (≤ 2 sentences)
 *   * risk_opportunity  — "the alpha" (1 sentence)
 *
 * The system prompt forces Bloomberg DES house style: dense, factual, no
 * marketing hype, no first person, refer to specific data when supplied.
 *
 * This module is intentionally pure: it does no DB I/O. The caller
 * (scripts/generate-theses.js) is responsible for assembling the company row
 * + context object and for persisting the output.
 */
import Anthropic from '@anthropic-ai/sdk'

// Latest Sonnet generation we can confirm is GA at time of writing.
// Source: https://docs.claude.com/en/docs/about-claude/models
// Sonnet 4.5 sits in the sweet spot of cost (~$3/MTok in, ~$15/MTok out)
// and quality for a 150-token structured-JSON task.
export const THESIS_MODEL = 'claude-sonnet-4-5-20250929'

const SYSTEM_PROMPT = `You are a sober Wall Street analyst specializing in AI compute infrastructure. Write in the Bloomberg DES house style: dense, factual, no hype, no marketing language. Refer to specific data when available. Never use the word "innovative", "cutting-edge", "leading", "world-class", "best-in-class", "transformative", or "revolutionary". Prefer concrete nouns and verbs over adjectives. No emojis. No exclamation marks.`

export interface ThesisCompanyInput {
  id: string
  name: string
  ticker: string | null
  layer_id: string | null
  domain: string | null
  position_held: boolean
  share: number | null
  conviction: string | null
  thesis: string | null            // existing manual thesis (rare); useful as seed
}

export interface ThesisContextData {
  recent_8k_headlines?: string[]            // up to ~5 most recent 8-K headlines
  recent_news_headlines?: string[]          // up to ~5 most recent news headlines
  top_patent_subclasses?: Array<{ code: string; count: number }>  // up to 3
  latest_funding?: {
    filed_date: string
    amount_usd: number | null
    investors_named?: string[]
  } | null
  hiring_open?: number | null               // total open roles (latest snapshot)
  hiring_top_categories?: Array<{ name: string; count: number }>  // up to 3
}

export interface ThesisOutput {
  thesis_summary: string
  risk_opportunity: string
}

/**
 * Generate a thesis for one company using Claude.
 * Throws on API error or malformed JSON output (caller decides retry policy).
 */
export async function generateThesis(
  company: ThesisCompanyInput,
  ctx: ThesisContextData = {},
  client?: Anthropic,
): Promise<ThesisOutput> {
  const anthropic = client ?? new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  })

  const userPrompt = buildUserPrompt(company, ctx)

  const resp = await anthropic.messages.create({
    model: THESIS_MODEL,
    max_tokens: 400,                // generous cap; structured-JSON output is short
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  })

  // The model returns a JSON object in the first text block. Strip code fences
  // if it wrapped them, then parse.
  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim()

  const json = extractJson(text)
  const parsed = JSON.parse(json) as Partial<ThesisOutput>
  const summary = (parsed.thesis_summary ?? '').toString().trim()
  const risk = (parsed.risk_opportunity ?? '').toString().trim()
  if (!summary || !risk) {
    throw new Error(`Empty thesis for ${company.id}: ${text.slice(0, 200)}`)
  }
  return { thesis_summary: summary, risk_opportunity: risk }
}

// ---------- helpers ----------

function buildUserPrompt(co: ThesisCompanyInput, ctx: ThesisContextData): string {
  const lines: string[] = []
  lines.push(`Write an analyst thesis card for the following AI-compute company.`)
  lines.push(``)
  lines.push(`COMPANY`)
  lines.push(`  id:        ${co.id}`)
  lines.push(`  name:      ${co.name}`)
  if (co.ticker)       lines.push(`  ticker:    ${co.ticker}`)
  if (co.layer_id)     lines.push(`  layer:     ${co.layer_id}  (where in the AI-compute stack)`)
  if (co.domain)       lines.push(`  domain:    ${co.domain}`)
  if (co.share != null) lines.push(`  share:     ${(co.share * 100).toFixed(1)}%  (market or segment share, internal estimate)`)
  if (co.conviction)   lines.push(`  conviction:${co.conviction}  (analyst's prior conviction)`)
  if (co.position_held) lines.push(`  note:      we hold a position`)
  if (co.thesis)       lines.push(`  prior_thesis (manual draft, may be stale): ${co.thesis}`)

  // Context data — only emit sections that have content so the prompt stays tight.
  const hasCtx =
    (ctx.recent_8k_headlines?.length ?? 0) +
    (ctx.recent_news_headlines?.length ?? 0) +
    (ctx.top_patent_subclasses?.length ?? 0) +
    (ctx.hiring_top_categories?.length ?? 0) > 0 ||
    !!ctx.latest_funding ||
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
      const inv = ctx.latest_funding.investors_named?.slice(0, 5).join(', ') ?? ''
      lines.push(`  Latest funding: ${amt} filed ${ctx.latest_funding.filed_date}${inv ? ` · investors: ${inv}` : ''}`)
    }
    if (ctx.hiring_open != null) {
      const top = ctx.hiring_top_categories?.slice(0, 3).map(c => `${c.name}×${c.count}`).join(', ') ?? ''
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

/** Strip code fences and any leading/trailing prose. Tolerant of ```json blocks. */
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fenced) return fenced[1].trim()
  // Otherwise find the first { ... last } slice.
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first >= 0 && last > first) return text.slice(first, last + 1)
  return text
}

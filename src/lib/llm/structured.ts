/**
 * One structured-extraction call, provider-agnostic.
 *
 * Extraction from filings is a well-specified task with a fixed schema; it
 * does not need the most expensive model available. The provider and model
 * are environment choices so the same code runs on DeepSeek V4 Flash via
 * OpenRouter for the bulk backfill ($0.04 per million input tokens) and on
 * Claude when a harder document or an accuracy check calls for it.
 *
 *   LLM_PROVIDER = openrouter | anthropic   (default: whichever key is set,
 *                                            openrouter first)
 *   LLM_MODEL    = provider model id         (defaults below)
 *
 * Both paths validate the response against the same Zod schema, so a model
 * that ignores the JSON schema is caught here, not in the database.
 */

import { z } from 'zod'
import { upstreamSignal } from '@/lib/cron-budget'

export type Provider = 'openrouter' | 'anthropic'

export const DEFAULT_MODEL: Record<Provider, string> = {
  openrouter: 'deepseek/deepseek-v4-flash-latest',
  anthropic: 'claude-opus-5',
}

/** $ per million tokens: [input, output, cached input]. For run summaries only. */
export const PRICE_PER_M: Record<string, [number, number, number]> = {
  'deepseek/deepseek-v4-flash-latest': [0.04, 0.10, 0.01],
  'deepseek/deepseek-v4-flash': [0.076, 0.153, 0.01],
  'deepseek/deepseek-v4-pro': [0.58, 1.74, 0.02],
  'moonshotai/kimi-k2.5': [0.45, 2.25, 0.45],
  'claude-opus-5': [5, 25, 0.5],
  'claude-sonnet-5': [2, 10, 0.2],
  'claude-haiku-4-5': [1, 5, 0.1],
}

export function estimateCost(model: string, inputTokens: number, outputTokens: number, cachedTokens: number): number | null {
  const p = PRICE_PER_M[model]
  if (!p) return null
  return ((inputTokens - cachedTokens) * p[0] + cachedTokens * p[2] + outputTokens * p[1]) / 1e6
}

export function resolveProvider(): { provider: Provider; model: string } {
  const forced = process.env.LLM_PROVIDER as Provider | undefined
  const provider: Provider = forced
    ?? (process.env.OPENROUTER_API_KEY ? 'openrouter' : 'anthropic')
  const model = process.env.LLM_MODEL || DEFAULT_MODEL[provider]
  return { provider, model }
}

export function providerConfigured(): boolean {
  const { provider } = resolveProvider()
  return provider === 'openrouter' ? !!process.env.OPENROUTER_API_KEY : !!process.env.ANTHROPIC_API_KEY
}

export interface StructuredRequest<S extends z.ZodType> {
  system: string
  user: string
  schema: S
  schemaName: string
  maxTokens?: number
}

export interface StructuredResult<T> {
  parsed: T | null
  model: string
  provider: Provider
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  refused: boolean
  /** Why parsed is null, when it is. */
  failure: string | null
}

export async function structured<S extends z.ZodType>(req: StructuredRequest<S>): Promise<StructuredResult<z.infer<S>>> {
  const { provider, model } = resolveProvider()
  return provider === 'openrouter' ? viaOpenRouter(req, model) : viaAnthropic(req, model)
}

// ---------------------------------------------------------------- OpenRouter

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

async function viaOpenRouter<S extends z.ZodType>(req: StructuredRequest<S>, model: string): Promise<StructuredResult<z.infer<S>>> {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) throw new Error('OPENROUTER_API_KEY not set')
  const body = {
    model,
    messages: [
      { role: 'system', content: req.system },
      { role: 'user', content: req.user },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: req.schemaName, strict: true, schema: z.toJSONSchema(req.schema) },
    },
    max_tokens: req.maxTokens ?? 8000,
    temperature: 0,
  }
  let lastErr = ''
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(OPENROUTER_URL, {
      method: 'POST',
      signal: upstreamSignal(240_000),
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://compute-circuit.vercel.app',
        'X-Title': 'Offtake contract ledger',
      },
      body: JSON.stringify(body),
    })
    if (r.status === 429 || r.status >= 500) {
      lastErr = `HTTP ${r.status}`
      await new Promise(res => setTimeout(res, 2_000 * (attempt + 1)))
      continue
    }
    if (!r.ok) throw new Error(`OpenRouter HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`)
    const data = (await r.json()) as {
      model?: string
      choices?: Array<{ message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }>
      usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } }
    }
    const choice = data.choices?.[0]
    const content = choice?.message?.content ?? ''
    const refused = !!choice?.message?.refusal || choice?.finish_reason === 'content_filter'
    const base = {
      model: data.model ?? model,
      provider: 'openrouter' as const,
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
      cacheReadTokens: data.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      refused,
    }
    if (refused) return { ...base, parsed: null, failure: 'refused' }
    let json: unknown
    try { json = JSON.parse(stripFences(content)) } catch { return { ...base, parsed: null, failure: 'invalid json' } }
    const v = req.schema.safeParse(json)
    if (!v.success) return { ...base, parsed: null, failure: `schema: ${v.error.issues[0]?.message ?? 'mismatch'}` }
    return { ...base, parsed: v.data as z.infer<S>, failure: null }
  }
  throw new Error(`OpenRouter failed after retries: ${lastErr}`)
}

function stripFences(s: string): string {
  const t = s.trim()
  const m = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(t)
  return m ? m[1] : t
}

// ----------------------------------------------------------------- Anthropic

async function viaAnthropic<S extends z.ZodType>(req: StructuredRequest<S>, model: string): Promise<StructuredResult<z.infer<S>>> {
  const [{ default: Anthropic }, { zodOutputFormat }] = await Promise.all([
    import('@anthropic-ai/sdk'),
    import('@anthropic-ai/sdk/helpers/zod'),
  ])
  const client = new Anthropic()
  const response = await client.messages.parse({
    model,
    max_tokens: req.maxTokens ?? 16000,
    system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: req.user }],
    output_config: { format: zodOutputFormat(req.schema), effort: 'medium' },
  })
  const refused = response.stop_reason === 'refusal'
  return {
    parsed: (!refused && response.parsed_output) ? (response.parsed_output as z.infer<S>) : null,
    model: response.model,
    provider: 'anthropic',
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    refused,
    failure: refused ? 'refused' : (response.parsed_output ? null : 'unparseable'),
  }
}

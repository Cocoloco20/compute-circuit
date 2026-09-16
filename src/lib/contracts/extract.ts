/**
 * Structured extraction of contract disclosures from one SEC filing.
 *
 * One model call per candidate filing. The output schema IS the ledger row
 * minus provenance: the model fills only what the document states and
 * leaves the rest null, and must quote the sentence(s) the numbers came
 * from so a reviewer can check the row against the source in seconds.
 *
 * Pure module: no DB I/O, no filesystem. The caller (backfill script or
 * cron) supplies the text and persists the result.
 */

import { z } from 'zod'
import type { FilingDocument } from './filings'
import { structured, resolveProvider } from '@/lib/llm/structured'

/** Whatever the environment routes to; see src/lib/llm/structured.ts. */
export const EXTRACTOR_MODEL = resolveProvider().model

export const CONTRACT_KINDS = [
  'colocation_lease', 'gpu_cloud_capacity', 'hosting_services',
  'power_supply', 'equipment_purchase', 'financing', 'other',
] as const
export const CONTRACT_STATUSES = [
  'loi', 'definitive', 'amended', 'expanded', 'terminated', 'completed',
] as const

export const ExtractedContractSchema = z.object({
  provider_name: z.string().describe('Party delivering the capacity, space, power, hosting or equipment, as named in the document'),
  customer_name: z.string().nullable().describe('Party paying for it, as named. Null if not disclosed OR only described generically ("a hyperscaler", "an investment-grade counterparty") -- do not put the generic description here.'),
  guarantor_name: z.string().nullable().describe('Party guaranteeing or backstopping the customer obligations, if any'),
  kind: z.enum(CONTRACT_KINDS),
  site: z.string().nullable().describe('Campus or location as stated, e.g. "Lake Mariner, NY" or "Ellendale, ND"'),
  capacity_mw: z.number().nullable().describe('Megawatts contracted. Critical IT load if the document distinguishes it, otherwise as stated.'),
  gpu_count: z.number().int().nullable(),
  gpu_model: z.string().nullable().describe('e.g. "NVIDIA GB300 NVL72"'),
  term_months: z.number().int().nullable().describe('Initial term in months'),
  start_date: z.string().nullable().describe('Expected commencement, YYYY-MM-DD, YYYY-MM or YYYY as precisely as stated'),
  end_date: z.string().nullable().describe('YYYY-MM-DD, YYYY-MM or YYYY as precisely as stated'),
  total_value_usd: z.number().nullable().describe('Total contract value over the term, in US dollars (9.7 billion -> 9700000000)'),
  annual_value_usd: z.number().nullable().describe('Annualized revenue or rent, in US dollars'),
  prepayment_usd: z.number().nullable().describe('Prepayment or deposit received, in US dollars'),
  has_extension_option: z.boolean().nullable(),
  extension_note: z.string().nullable().describe('Extension or expansion option terms, briefly'),
  escalator_pct: z.number().nullable().describe('Annual price escalator, percent'),
  status: z.enum(CONTRACT_STATUSES).describe('loi = letter of intent / non-binding; definitive = signed agreement; amended / expanded = a change to a previously disclosed contract; terminated; completed'),
  excerpt: z.string().describe('Verbatim quote from the document containing the key figures, at most 800 characters'),
  confidence: z.number().describe('0 to 1: how confident you are that this row is a real contract disclosure with the figures attributed correctly'),
})
export type ExtractedContract = z.infer<typeof ExtractedContractSchema>

/**
 * A named party and nothing else isn't a contract disclosure -- extraction
 * sometimes turns a marketing "customer wins" bullet list into a row with
 * no MW, GPU count, term or dollar figure at all. True when at least one
 * quantity the ledger actually reports on is present.
 */
export function hasQuantityInfo(c: ExtractedContract): boolean {
  return [
    c.capacity_mw, c.gpu_count, c.term_months,
    c.total_value_usd, c.annual_value_usd, c.prepayment_usd,
  ].some(v => v != null)
}

const OutputSchema = z.object({
  contracts: z.array(ExtractedContractSchema),
  notes: z.string().nullable().describe('Anything a reviewer should know: ambiguity, figures that were stated in a non-USD currency, etc.'),
})
export type ExtractionOutput = z.infer<typeof OutputSchema>

// Frozen system prompt: it sits before the per-filing content so the
// prompt cache covers it across every filing in a run.
const SYSTEM_PROMPT = `You extract commercial contract disclosures from SEC filings for a ledger used by credit and equity analysts covering AI infrastructure.

Scope. Extract every contract in the document where one party provides, and another pays for, any of: data-center space and power (colocation, powered shell, turnkey leases), GPU or AI cloud capacity, hosting or managed services for customer-owned hardware, electricity supply (PPAs, utility agreements, behind-the-meter power), or AI hardware and infrastructure equipment (GPUs, servers, turbines, transformers). Also extract financing that is explicitly tied to such a contract (a prepayment by the customer, a guarantee or backstop of the customer's payments, debt secured by a specific contract).

Out of scope, return nothing for: earnings results without a new contract, equity raises, ordinary debt issuance not tied to a specific contract, officer changes, shareholder votes, general business descriptions, restatements of contracts already described in earlier filings unless this document changes their terms (then status = amended or expanded), and cryptocurrency mining infrastructure -- ASIC miners (Bitmain Antminer, MicroBT Whatsminer, Canaan Avalon and similar), and equipment or hosting bought or sold to run or expand a bitcoin/crypto mining fleet. Several filers in this universe are former or current crypto miners pivoting to AI/HPC hosting, and their filings routinely disclose both businesses side by side -- this ledger covers only the AI/HPC side. A GPU or AI server purchase is in scope even from a crypto-miner filer; an ASIC miner purchase is not in scope even from an AI-hosting filer. When equipment's purpose is not stated (e.g. an immersion-cooling vendor used by both kinds of facility), only extract it if the surrounding text ties it to AI/HPC/GPU capacity specifically.

Rules.
- Report only what the document states. Leave a field null when it is not stated. Never estimate, infer or fill from outside knowledge.
- Convert money to absolute US dollars: "$9.7 billion" is 9700000000. If a figure is in another currency, leave the USD field null and mention it in notes.
- MW: use critical IT load when the document distinguishes it from gross or utility power; otherwise the figure as stated.
- One row per distinct contract. Two leases at two sites in one filing are two rows. An amendment to a prior contract is its own row with status amended or expanded.
- kind describes what THIS specific contract is for, not other topics the same filing happens to also cover. A filing often bundles a power/capacity buildout update together with a separate hardware purchase in the same paragraph — a contract to buy GPUs or miners is equipment_purchase even when the surrounding text also discusses electricity or MW capacity; do not let nearby power-related language pull the kind toward power_supply for a row that is actually about buying hardware.
- provider_name is the party delivering; customer_name the party paying. The filer may be either. Names exactly as the document writes them.
- The excerpt must be a verbatim passage (or two passages joined with " ... ") that contains the key figures, at most 800 characters.
- confidence below 0.5 means you are unsure this is a contract disclosure at all.`

export interface ExtractionResult {
  output: ExtractionOutput
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  refused: boolean
  failure: string | null
}

export interface FilingContext {
  filerName: string
  form: string
  filingDate: string
  documents: FilingDocument[]
}

export function buildUserMessage(ctx: FilingContext): string {
  const docs = ctx.documents.map(d => `<document name="${d.name}" url="${d.url}">\n${d.text}\n</document>`).join('\n\n')
  return `Filer: ${ctx.filerName}\nForm: ${ctx.form}\nFiling date: ${ctx.filingDate}\n\n${docs}`
}

export async function extractContracts(
  ctx: FilingContext,
  override?: { provider?: 'openrouter' | 'anthropic'; model?: string; timeoutMs?: number },
  maxTokens = 16000,
): Promise<ExtractionResult> {
  const r = await structured({
    system: SYSTEM_PROMPT,
    user: buildUserMessage(ctx),
    schema: OutputSchema,
    schemaName: 'contract_disclosures',
    maxTokens,
    override,
    timeoutMs: override?.timeoutMs,
  })
  return {
    output: r.parsed ?? { contracts: [], notes: r.failure },
    model: r.model,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    cacheReadTokens: r.cacheReadTokens,
    refused: r.refused,
    failure: r.failure,
  }
}

/**
 * extractContracts, with one retry when a prefilter-approved filing comes
 * back empty.
 *
 * The eval in docs/extractor-eval.md found the cheap model non-
 * deterministic on identical input: 3 of 14 filings that had previously
 * yielded a real contract came back with zero on a fresh, identical call
 * (temperature 0 does not make these APIs fully reproducible run to run).
 * A filing only reaches here after the prefilter already found capacity
 * vocabulary AND a quantity, so an empty result is more likely a missed
 * extraction than a true negative. One retry, same model, catches that at
 * negligible extra cost — the alternative is silently losing real
 * contracts to API-level variance.
 *
 * When the failure was a truncated response (max_tokens cut the JSON off
 * mid-structure), retrying at the same token budget would deterministically
 * hit the identical wall -- observed live on filings with several contracts
 * and long excerpts even after the 12k -> 16k raise. The retry gets 50% more
 * headroom in that one case.
 */
export async function extractContractsWithRetry(
  ctx: FilingContext,
  override?: { provider?: 'openrouter' | 'anthropic'; model?: string; timeoutMs?: number },
): Promise<ExtractionResult & { retried: boolean }> {
  const first = await extractContracts(ctx, override)
  if (first.output.contracts.length > 0 || first.refused) return { ...first, retried: false }
  const second = await extractContracts(ctx, override, first.failure === 'truncated' ? 24000 : 16000)
  if (second.output.contracts.length > 0) {
    return {
      ...second,
      inputTokens: first.inputTokens + second.inputTokens,
      outputTokens: first.outputTokens + second.outputTokens,
      cacheReadTokens: first.cacheReadTokens + second.cacheReadTokens,
      retried: true,
    }
  }
  return {
    ...first,
    inputTokens: first.inputTokens + second.inputTokens,
    outputTokens: first.outputTokens + second.outputTokens,
    cacheReadTokens: first.cacheReadTokens + second.cacheReadTokens,
    retried: true,
  }
}

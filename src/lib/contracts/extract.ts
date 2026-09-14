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

import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import type { FilingDocument } from './filings'

export const EXTRACTOR_MODEL = 'claude-opus-5'

export const CONTRACT_KINDS = [
  'colocation_lease', 'gpu_cloud_capacity', 'hosting_services',
  'power_supply', 'equipment_purchase', 'financing', 'other',
] as const
export const CONTRACT_STATUSES = [
  'loi', 'definitive', 'amended', 'expanded', 'terminated', 'completed',
] as const

export const ExtractedContractSchema = z.object({
  provider_name: z.string().describe('Party delivering the capacity, space, power, hosting or equipment, as named in the document'),
  customer_name: z.string().nullable().describe('Party paying for it, as named. Null if not disclosed.'),
  customer_disclosed: z.boolean().describe('False when the customer is described only generically ("a hyperscaler", "an investment-grade counterparty")'),
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

const OutputSchema = z.object({
  contracts: z.array(ExtractedContractSchema),
  notes: z.string().nullable().describe('Anything a reviewer should know: ambiguity, figures that were stated in a non-USD currency, etc.'),
})
export type ExtractionOutput = z.infer<typeof OutputSchema>

// Frozen system prompt: it sits before the per-filing content so the
// prompt cache covers it across every filing in a run.
const SYSTEM_PROMPT = `You extract commercial contract disclosures from SEC filings for a ledger used by credit and equity analysts covering AI infrastructure.

Scope. Extract every contract in the document where one party provides, and another pays for, any of: data-center space and power (colocation, powered shell, turnkey leases), GPU or AI cloud capacity, hosting or managed services for customer-owned hardware, electricity supply (PPAs, utility agreements, behind-the-meter power), or AI hardware and infrastructure equipment (GPUs, servers, turbines, transformers). Also extract financing that is explicitly tied to such a contract (a prepayment by the customer, a guarantee or backstop of the customer's payments, debt secured by a specific contract).

Out of scope, return nothing for: earnings results without a new contract, equity raises, ordinary debt issuance not tied to a specific contract, officer changes, shareholder votes, general business descriptions, and restatements of contracts already described in earlier filings unless this document changes their terms (then status = amended or expanded).

Rules.
- Report only what the document states. Leave a field null when it is not stated. Never estimate, infer or fill from outside knowledge.
- Convert money to absolute US dollars: "$9.7 billion" is 9700000000. If a figure is in another currency, leave the USD field null and mention it in notes.
- MW: use critical IT load when the document distinguishes it from gross or utility power; otherwise the figure as stated.
- One row per distinct contract. Two leases at two sites in one filing are two rows. An amendment to a prior contract is its own row with status amended or expanded.
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
}

let client: Anthropic | null = null
function getClient(): Anthropic {
  if (!client) client = new Anthropic()
  return client
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

export async function extractContracts(ctx: FilingContext): Promise<ExtractionResult> {
  const response = await getClient().messages.parse({
    model: EXTRACTOR_MODEL,
    max_tokens: 16000,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: buildUserMessage(ctx) }],
    output_config: { format: zodOutputFormat(OutputSchema), effort: 'medium' },
  })
  const refused = response.stop_reason === 'refusal'
  const output: ExtractionOutput = (!refused && response.parsed_output) ? response.parsed_output : { contracts: [], notes: refused ? 'refused' : 'unparseable' }
  return {
    output,
    model: response.model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    refused,
  }
}

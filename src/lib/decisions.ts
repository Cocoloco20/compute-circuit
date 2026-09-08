import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  Database, DecisionOutcome, DecisionFactorName, PipelineStage,
} from '@/types/db'

/**
 * Decision writes, in one place.
 *
 * Both /api/decisions (ad-hoc capture) and /api/pipeline (capture forced by a
 * stage change) create the same three rows: the decision, its primary factor,
 * and a commit_log entry. Keeping that in one function is what stops the two
 * paths from drifting into writing subtly different history — which would
 * quietly corrupt the calibration queries that are the whole point of the
 * decision log.
 *
 * Service-role client only; these tables are RLS-locked with zero policies.
 */

export type Sb = SupabaseClient<Database>

export const OUTCOMES: DecisionOutcome[] = ['Pass', 'Advance', 'Invest']

export const FACTORS: DecisionFactorName[] = [
  'Market Timing', 'Team', 'Product', 'Competition',
  'Traction', 'Valuation', 'Thesis Fit', 'Other',
]

/**
 * Stages you cannot enter without saying why.
 *
 * These are the irreversible-feeling ones: a pass you'll want to revisit when
 * the company raises anyway, a term sheet, a close. Screening and DD are
 * cheap to move through and forcing a modal there would just train the habit
 * of typing nothing into it.
 */
export const STAGES_REQUIRING_DECISION: PipelineStage[] = ['Passed', 'Closed', 'Term Sheet']

/** Which outcome a stage change implies, so the modal opens pre-answered. */
export const STAGE_OUTCOME: Partial<Record<PipelineStage, DecisionOutcome>> = {
  Passed: 'Pass',
  'Term Sheet': 'Advance',
  Closed: 'Invest',
}

export interface DecisionInput {
  companyId: string
  outcome: DecisionOutcome
  primaryFactor: DecisionFactorName
  confidence: number
  reasoning: string
  whatWouldChangeMind?: string | null
  dissent?: boolean
}

/** Returns an error string, or null when the input is good. */
export function validateDecision(input: Partial<DecisionInput>): string | null {
  if (!input.companyId) return 'company_id required'
  if (!input.outcome || !OUTCOMES.includes(input.outcome)) {
    return `outcome must be one of ${OUTCOMES.join(', ')}`
  }
  if (!input.primaryFactor || !FACTORS.includes(input.primaryFactor)) {
    return `primary_factor must be one of ${FACTORS.join(', ')}`
  }
  const c = Number(input.confidence)
  if (!Number.isInteger(c) || c < 1 || c > 5) return 'confidence must be an integer 1-5'
  const r = (input.reasoning ?? '').trim()
  if (r.length < 10 || r.length > 500) return 'reasoning must be 10-500 characters'
  if ((input.whatWouldChangeMind ?? '').trim().length > 200) {
    return 'what_would_change_mind max 200 characters'
  }
  return null
}

/**
 * Append to the audit trail. Best-effort on purpose: a decision that saved but
 * failed to log is still a saved decision, and failing the request would make
 * the client retry and write the decision twice.
 */
export async function appendCommit(sb: Sb, entry: {
  entity_type: string; entity_id: string; action: string
  summary: string; diff: unknown
}): Promise<void> {
  try {
    await (sb.from('commit_log') as unknown as {
      insert: (r: unknown) => Promise<{ error: unknown }>
    }).insert({ ...entry, author: 'luigui' })
  } catch { /* see above */ }
}

/** Writes decision + primary factor + commit entry. Returns the decision id. */
export async function captureDecision(
  sb: Sb, input: DecisionInput, companyName: string,
): Promise<{ id: string } | { error: string }> {
  const row = {
    company_id: input.companyId,
    outcome: input.outcome,
    primary_factor: input.primaryFactor,
    confidence: input.confidence,
    reasoning: input.reasoning.trim(),
    what_would_change_mind: (input.whatWouldChangeMind ?? '').trim() || null,
    dissent: input.dissent === true,
    decided_by: 'luigui',
    decided_at: new Date().toISOString(),
  }

  const ins = await (sb.from('decisions') as unknown as {
    insert: (r: unknown) => { select: () => { single: () => Promise<{
      data: { id: string } | null; error: { message: string } | null }> } }
  }).insert(row).select().single()
  if (ins.error || !ins.data) return { error: ins.error?.message ?? 'insert failed' }

  const id = ins.data.id

  // Primary factor at weight 1.0. Secondary factors get their share in
  // Milestone 2, when the memo layer starts splitting weight.
  await (sb.from('decision_factors') as unknown as {
    insert: (r: unknown) => Promise<{ error: unknown }>
  }).insert({ decision_id: id, factor: input.primaryFactor, weight: 1.0 })

  await appendCommit(sb, {
    entity_type: 'decision',
    entity_id: id,
    action: 'decision_captured',
    summary: `Luigui recorded ${input.outcome} on ${companyName} — ${input.primaryFactor}, confidence ${input.confidence}/5`,
    diff: { ...row, id },
  })

  return { id }
}

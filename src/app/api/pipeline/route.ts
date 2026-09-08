import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/service-role'
import {
  captureDecision, validateDecision, appendCommit,
  STAGES_REQUIRING_DECISION, type Sb, type DecisionInput,
} from '@/lib/decisions'
import type { PipelineStage, DecisionOutcome, DecisionFactorName } from '@/types/db'

/**
 * Pipeline write API — sourcing a company and moving it through stages.
 *
 *   POST   { company_id, stage?, amount_usd?, lead?, owner?, deadline?,
 *            action_needed?, flag? }                → add / update a card
 *   PATCH  { company_id, stage, decision? }         → move stage
 *   DELETE ?company_id=x                            → drop from pipeline
 *
 * THE RULE THIS ROUTE EXISTS TO ENFORCE: moving a card to Passed, Term Sheet
 * or Closed REQUIRES a decision payload, and the move is rejected without one.
 *
 * That is deliberately annoying. The reason the fund is being built this way
 * is that reasoning gets reconstructed after the fact, favourably, once the
 * outcome is known — so the reasoning has to be captured at the moment of the
 * call or it is worth nothing. If the pass is cheap and the explanation is
 * optional, the explanation stops happening within a week.
 *
 * Auth: Bearer CRON_SECRET, same as the other write routes.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STAGES: PipelineStage[] =
  ['Sourcing', 'Screening', 'DD', 'Term Sheet', 'Closed', 'Passed']

function unauthorized() {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
}
function checkAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  return !!secret && req.headers.get('authorization') === `Bearer ${secret}`
}
function bad(message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status: 400 })
}

async function lookupCompany(sb: Sb, id: string): Promise<{ id: string; name: string } | null> {
  const { data } = await sb.from('companies').select('id, name').eq('id', id).maybeSingle()
  return (data as unknown as { id: string; name: string } | null) ?? null
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return unauthorized()

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return bad('invalid json') }

  const companyId = body.company_id
  if (typeof companyId !== 'string' || !companyId) return bad('company_id required')

  const stage = (body.stage as PipelineStage) ?? 'Sourcing'
  if (!STAGES.includes(stage)) return bad(`stage must be one of ${STAGES.join(', ')}`)
  // Entering the pipeline directly at a decision stage would route around the
  // capture requirement. Come in at Sourcing and move with PATCH.
  if (STAGES_REQUIRING_DECISION.includes(stage)) {
    return bad(`cannot create a card directly at ${stage} — add at an earlier stage, then PATCH to move it`)
  }

  const sb = supabaseServiceRole()
  const co = await lookupCompany(sb, companyId)
  if (!co) return bad(`unknown company_id: ${companyId}`)

  const row = {
    company_id: companyId,
    stage,
    amount_usd: body.amount_usd == null ? null : Number(body.amount_usd),
    lead: (body.lead as string) ?? null,
    owner: (body.owner as string) ?? null,
    deadline: (body.deadline as string) ?? null,
    action_needed: (body.action_needed as string) ?? null,
    flag: body.flag === true,
    entered_stage_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  const r = await (sb.from('pipeline_cards') as unknown as {
    upsert: (r: unknown, o: { onConflict: string }) => Promise<{ error: { message: string } | null }>
  }).upsert(row, { onConflict: 'company_id' })
  if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 })

  await appendCommit(sb, {
    entity_type: 'pipeline_card',
    entity_id: companyId,
    action: 'card_created',
    summary: `Luigui added ${co.name} to ${stage}`,
    diff: row,
  })

  return NextResponse.json({ ok: true, company_id: companyId, stage })
}

export async function PATCH(req: NextRequest) {
  if (!checkAuth(req)) return unauthorized()

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return bad('invalid json') }

  const companyId = body.company_id
  if (typeof companyId !== 'string' || !companyId) return bad('company_id required')

  const stage = body.stage as PipelineStage
  if (!STAGES.includes(stage)) return bad(`stage must be one of ${STAGES.join(', ')}`)

  const sb = supabaseServiceRole()

  const { data: existing, error: exErr } = await sb
    .from('pipeline_cards').select('*').eq('company_id', companyId).maybeSingle()
  if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 })
  const card = existing as unknown as { stage: PipelineStage } | null
  if (!card) return bad(`no pipeline card for ${companyId}`)
  if (card.stage === stage) return NextResponse.json({ ok: true, unchanged: true })

  const co = await lookupCompany(sb, companyId)
  if (!co) return bad(`unknown company_id: ${companyId}`)

  // ---- the gate ----------------------------------------------------------
  const needsDecision = STAGES_REQUIRING_DECISION.includes(stage)
  const raw = body.decision as Record<string, unknown> | undefined

  let decisionId: string | null = null
  if (needsDecision) {
    if (!raw) {
      return bad(`moving to ${stage} requires a decision`, {
        requiresDecision: true,
        stage,
      })
    }
    const input: DecisionInput = {
      companyId,
      outcome: raw.outcome as DecisionOutcome,
      primaryFactor: raw.primary_factor as DecisionFactorName,
      confidence: Number(raw.confidence),
      reasoning: String(raw.reasoning ?? ''),
      whatWouldChangeMind: (raw.what_would_change_mind as string) ?? null,
      dissent: raw.dissent === true,
    }
    const invalid = validateDecision(input)
    if (invalid) return bad(invalid, { requiresDecision: true, stage })

    // Write the decision FIRST. If the stage update then fails we have an
    // orphaned decision, which is recoverable and honest; the reverse would
    // move the card with no recorded reasoning, which is the exact failure
    // this route exists to prevent.
    const res = await captureDecision(sb, input, co.name)
    if ('error' in res) return NextResponse.json({ error: res.error }, { status: 500 })
    decisionId = res.id
  }

  const patch = {
    stage,
    entered_stage_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  const upd = await (sb.from('pipeline_cards') as unknown as {
    update: (p: typeof patch) => { eq: (c: string, v: string) => Promise<{ error: { message: string } | null }> }
  }).update(patch).eq('company_id', companyId)
  if (upd.error) {
    return NextResponse.json(
      { error: upd.error.message, decisionId, warning: 'decision recorded but stage did not move' },
      { status: 500 })
  }

  await appendCommit(sb, {
    entity_type: 'pipeline_card',
    entity_id: companyId,
    action: 'stage_changed',
    summary: `Luigui moved ${co.name} ${card.stage} → ${stage}`,
    diff: { from: card.stage, to: stage, decisionId },
  })

  return NextResponse.json({ ok: true, company_id: companyId, stage, decisionId })
}

export async function DELETE(req: NextRequest) {
  if (!checkAuth(req)) return unauthorized()
  const companyId = req.nextUrl.searchParams.get('company_id')
  if (!companyId) return bad('company_id required')

  const sb = supabaseServiceRole()
  const r = await sb.from('pipeline_cards').delete().eq('company_id', companyId)
  if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 })

  await appendCommit(sb, {
    entity_type: 'pipeline_card',
    entity_id: companyId,
    action: 'card_removed',
    summary: `Luigui removed ${companyId} from the pipeline`,
    diff: { company_id: companyId },
  })
  return NextResponse.json({ ok: true })
}

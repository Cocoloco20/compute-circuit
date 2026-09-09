import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/service-role'
import type { DecisionOutcome, DecisionFactorName, ResurfaceVerdict } from '@/types/db'

/**
 * Decision-memory write API (migration 0048).
 *
 *   POST  { company_id, outcome, primary_factor, confidence, reasoning,
 *           what_would_change_mind?, dissent? }        → capture a decision
 *   PATCH { resurfacing_id, verdict, verdict_note? }   → judge a resurfacing
 *
 * Auth is the same Bearer CRON_SECRET the watchlist and cron routes use.
 * The decision tables carry RLS with zero policies, so the service role is
 * the only path in — there is no anon fallback to leak through.
 *
 * Every write also appends to commit_log. That append is best-effort: a
 * decision that saved but failed to log is still a saved decision, and
 * failing the request would make the client retry and double-write it.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const OUTCOMES: DecisionOutcome[] = ['Pass', 'Advance', 'Invest']
const FACTORS: DecisionFactorName[] = [
  'Market Timing', 'Team', 'Product', 'Competition',
  'Traction', 'Valuation', 'Thesis Fit', 'Other',
]
const VERDICTS: ResurfaceVerdict[] = ['Yes', 'Partially', 'No']

function unauthorized() {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
}
function checkAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  return !!secret && req.headers.get('authorization') === `Bearer ${secret}`
}
function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

type Sb = ReturnType<typeof supabaseServiceRole>

async function log(sb: Sb, entry: {
  entity_type: string; entity_id: string; action: string
  summary: string; diff: unknown
}) {
  try {
    await (sb.from('commit_log') as unknown as {
      insert: (r: unknown) => Promise<{ error: unknown }>
    }).insert({ ...entry, author: 'luigui' })
  } catch {
    // Non-fatal by design — see the header comment.
  }
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return unauthorized()

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return bad('invalid json') }

  const companyId = body.company_id
  if (typeof companyId !== 'string' || !companyId) return bad('company_id required')

  const outcome = body.outcome as DecisionOutcome
  if (!OUTCOMES.includes(outcome)) return bad(`outcome must be one of ${OUTCOMES.join(', ')}`)

  const factor = body.primary_factor as DecisionFactorName
  if (!FACTORS.includes(factor)) return bad(`primary_factor must be one of ${FACTORS.join(', ')}`)

  const confidence = Number(body.confidence)
  if (!Number.isInteger(confidence) || confidence < 1 || confidence > 5) {
    return bad('confidence must be an integer 1-5')
  }

  const reasoning = typeof body.reasoning === 'string' ? body.reasoning.trim() : ''
  if (reasoning.length < 10 || reasoning.length > 500) {
    return bad('reasoning must be 10-500 characters')
  }

  const wwcm = typeof body.what_would_change_mind === 'string'
    ? body.what_would_change_mind.trim() : ''
  if (wwcm.length > 200) return bad('what_would_change_mind max 200 characters')

  const sb = supabaseServiceRole()

  // The company must exist — the FK would reject it anyway, but a clear
  // 400 beats a Postgres constraint string reaching the UI.
  const { data: coRaw, error: coErr } = await sb
    .from('companies').select('id, name').eq('id', companyId).maybeSingle()
  if (coErr) return NextResponse.json({ error: coErr.message }, { status: 500 })
  // Column-list selects widen to `never` under the light Database generic.
  const co = coRaw as unknown as { id: string; name: string } | null
  if (!co) return bad(`unknown company_id: ${companyId}`)

  const row = {
    company_id: companyId,
    outcome,
    primary_factor: factor,
    confidence,
    reasoning,
    what_would_change_mind: wwcm || null,
    dissent: body.dissent === true,
    decidedBy: typeof body.decided_by === 'string' && body.decided_by.trim()
      ? body.decided_by.trim() : 'luigui',
    decided_at: new Date().toISOString(),
  }

  const ins = await (sb.from('decisions') as unknown as {
    insert: (r: unknown) => { select: () => { single: () => Promise<{ data: { id: string } | null; error: { message: string } | null }> } }
  }).insert(row).select().single()
  if (ins.error || !ins.data) {
    return NextResponse.json({ error: ins.error?.message ?? 'insert failed' }, { status: 500 })
  }
  const decisionId = ins.data.id

  // Primary factor gets weight 1.0. Secondary factors land here in M2 when
  // the memo layer starts splitting weight across factors.
  await (sb.from('decision_factors') as unknown as {
    insert: (r: unknown) => Promise<{ error: unknown }>
  }).insert({ decision_id: decisionId, factor, weight: 1.0 })

  await log(sb, {
    entity_type: 'decision',
    entity_id: decisionId,
    action: 'decision_captured',
    summary: `Luigui recorded ${outcome} on ${co.name} — ${factor}, confidence ${confidence}/5`,
    diff: { ...row, id: decisionId },
  })

  return NextResponse.json({ ok: true, id: decisionId })
}

export async function PATCH(req: NextRequest) {
  if (!checkAuth(req)) return unauthorized()

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return bad('invalid json') }

  const id = body.resurfacing_id
  if (typeof id !== 'string' || !id) return bad('resurfacing_id required')

  const verdict = body.verdict as ResurfaceVerdict
  if (!VERDICTS.includes(verdict)) return bad(`verdict must be one of ${VERDICTS.join(', ')}`)

  const note = typeof body.verdict_note === 'string' ? body.verdict_note.trim() : ''

  const sb = supabaseServiceRole()
  const patch = {
    verdict,
    verdict_by: 'luigui',
    verdict_at: new Date().toISOString(),
    verdict_note: note || null,
  }

  const upd = await (sb.from('decision_resurfacings') as unknown as {
    update: (r: unknown) => { eq: (k: string, v: string) => { select: () => { single: () => Promise<{ data: { decision_id: string } | null; error: { message: string } | null }> } } }
  }).update(patch).eq('id', id).select().single()
  if (upd.error || !upd.data) {
    return NextResponse.json({ error: upd.error?.message ?? 'not found' }, { status: 404 })
  }

  await log(sb, {
    entity_type: 'decision_resurfacing',
    entity_id: id,
    action: 'resurface_verdict',
    summary: `Luigui judged a resurfaced decision: reasoning held — ${verdict}`,
    diff: patch,
  })

  return NextResponse.json({ ok: true })
}

import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/service-role'
import { appendCommit } from '@/lib/decisions'

/**
 * Fund writes — set up the fund, record a cheque, record a mark.
 *
 *   POST  { name, vintage_year?, committed_usd, reserve_ratio?, ... }  → fund
 *   PUT   { company_id, amount_usd, invested_at, instrument?, ... }    → investment
 *   PATCH { investment_id, value_usd, marked_at, source?, note? }      → mark
 *
 * Auth: Bearer CRON_SECRET, same as every other write route.
 *
 * A mark is appended, never overwritten. "Marked at $4M on the Series A" and
 * "written to zero eight months later" are two facts; collapsing them into one
 * field destroys the record of how a view changed, which is the same mistake
 * as not recording why a decision was made.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const INSTRUMENTS = ['SAFE', 'Convertible Note', 'Equity', 'Token', 'Other']
const SOURCES = ['Last Round', 'Secondary', 'Write-Down', 'Write-Off', 'Exit', 'Estimate']
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function bad(m: string) { return NextResponse.json({ error: m }, { status: 400 }) }
function checkAuth(req: NextRequest): boolean {
  const s = process.env.CRON_SECRET
  return !!s && req.headers.get('authorization') === `Bearer ${s}`
}
function unauthorized() { return NextResponse.json({ error: 'unauthorized' }, { status: 401 }) }

type Table = { upsert: (r: unknown, o?: { onConflict: string }) => Promise<{ error: { message: string } | null }> }
type Inserter = { insert: (r: unknown) => { select: () => { single: () => Promise<{ data: { id: string } | null; error: { message: string } | null }> } } }

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return unauthorized()
  let b: Record<string, unknown>
  try { b = await req.json() } catch { return bad('invalid json') }

  const name = typeof b.name === 'string' ? b.name.trim() : ''
  if (!name) return bad('name required')
  const committed = Number(b.committed_usd)
  if (!Number.isFinite(committed) || committed < 0) return bad('committed_usd must be a non-negative number')
  const ratio = b.reserve_ratio == null ? 0.5 : Number(b.reserve_ratio)
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) return bad('reserve_ratio must be between 0 and 1')

  const sb = supabaseServiceRole()
  const row = {
    id: 'fund-i',
    name,
    vintage_year: b.vintage_year == null ? null : Number(b.vintage_year),
    committed_usd: committed,
    called_usd: b.called_usd == null ? 0 : Number(b.called_usd),
    reserve_ratio: ratio,
    target_check_usd: b.target_check_usd == null ? null : Number(b.target_check_usd),
    notes: (b.notes as string) ?? null,
    updated_at: new Date().toISOString(),
  }
  const r = await (sb.from('fund') as unknown as Table).upsert(row, { onConflict: 'id' })
  if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 })

  await appendCommit(sb, {
    entity_type: 'fund', entity_id: 'fund-i', action: 'fund_configured',
    summary: `Fund set: ${name}, committed ${(committed / 1e6).toFixed(2)}M, reserve ${(ratio * 100).toFixed(0)}%`,
    diff: row,
  })
  return NextResponse.json({ ok: true, fund: row })
}

export async function PUT(req: NextRequest) {
  if (!checkAuth(req)) return unauthorized()
  let b: Record<string, unknown>
  try { b = await req.json() } catch { return bad('invalid json') }

  const companyId = b.company_id
  if (typeof companyId !== 'string' || !companyId) return bad('company_id required')
  const amount = Number(b.amount_usd)
  if (!Number.isFinite(amount) || amount <= 0) return bad('amount_usd must be a positive number')
  const investedAt = typeof b.invested_at === 'string' ? b.invested_at : ''
  if (!ISO_DATE.test(investedAt)) return bad('invested_at must be YYYY-MM-DD')
  const instrument = (b.instrument as string) ?? 'SAFE'
  if (!INSTRUMENTS.includes(instrument)) return bad(`instrument must be one of ${INSTRUMENTS.join(', ')}`)

  const sb = supabaseServiceRole()
  const { data: co } = await sb.from('companies').select('id, name').eq('id', companyId).maybeSingle()
  const company = co as unknown as { id: string; name: string } | null
  if (!company) return bad(`unknown company_id: ${companyId}`)

  const row = {
    company_id: companyId,
    invested_at: investedAt,
    amount_usd: amount,
    instrument,
    round: (b.round as string) ?? null,
    post_money_usd: b.post_money_usd == null ? null : Number(b.post_money_usd),
    ownership_pct: b.ownership_pct == null ? null : Number(b.ownership_pct),
    reserved_usd: b.reserved_usd == null ? 0 : Number(b.reserved_usd),
    status: 'Active',
    decision_id: (b.decision_id as string) ?? null,
    notes: (b.notes as string) ?? null,
  }
  const ins = await (sb.from('investments') as unknown as Inserter).insert(row).select().single()
  if (ins.error || !ins.data) {
    return NextResponse.json({ error: ins.error?.message ?? 'insert failed' }, { status: 500 })
  }

  await appendCommit(sb, {
    entity_type: 'investment', entity_id: ins.data.id, action: 'investment_recorded',
    summary: `Luigui invested ${(amount / 1e3).toFixed(0)}K in ${company.name} (${instrument})`,
    diff: { ...row, id: ins.data.id },
  })
  return NextResponse.json({ ok: true, id: ins.data.id })
}

export async function PATCH(req: NextRequest) {
  if (!checkAuth(req)) return unauthorized()
  let b: Record<string, unknown>
  try { b = await req.json() } catch { return bad('invalid json') }

  const investmentId = b.investment_id
  if (typeof investmentId !== 'string' || !investmentId) return bad('investment_id required')
  const value = Number(b.value_usd)
  if (!Number.isFinite(value) || value < 0) return bad('value_usd must be a non-negative number')
  const markedAt = typeof b.marked_at === 'string' ? b.marked_at : ''
  if (!ISO_DATE.test(markedAt)) return bad('marked_at must be YYYY-MM-DD')
  const source = (b.source as string) ?? 'Last Round'
  if (!SOURCES.includes(source)) return bad(`source must be one of ${SOURCES.join(', ')}`)

  const sb = supabaseServiceRole()
  const { data: inv } = await sb.from('investments')
    .select('id, company_id, amount_usd').eq('id', investmentId).maybeSingle()
  const investment = inv as unknown as { id: string; company_id: string; amount_usd: number } | null
  if (!investment) return bad(`unknown investment_id: ${investmentId}`)

  const row = {
    investment_id: investmentId,
    marked_at: markedAt,
    value_usd: value,
    source,
    note: (b.note as string) ?? null,
  }
  // Appended, not overwritten — the unique key is (investment, date, source),
  // so re-running the same mark is idempotent but a NEW date is a new fact.
  const r = await (sb.from('marks') as unknown as Table)
    .upsert(row, { onConflict: 'investment_id,marked_at,source' })
  if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 })

  // An Exit or Write-Off mark also closes the position; leaving it Active
  // would keep it counted as unrealised.
  if (source === 'Exit' || source === 'Write-Off') {
    await (sb.from('investments') as unknown as {
      update: (p: unknown) => { eq: (c: string, v: string) => Promise<{ error: unknown }> }
    }).update({ status: source === 'Exit' ? 'Exited' : 'Written Off', updated_at: new Date().toISOString() })
      .eq('id', investmentId)
  }

  const moic = Number(investment.amount_usd) > 0 ? value / Number(investment.amount_usd) : 0
  await appendCommit(sb, {
    entity_type: 'mark', entity_id: investmentId, action: 'position_marked',
    summary: `${investment.company_id} marked at ${(value / 1e3).toFixed(0)}K (${source}, ${moic.toFixed(2)}x)`,
    diff: row,
  })
  return NextResponse.json({ ok: true, moic })
}

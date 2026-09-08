import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/service-role'
import { appendCommit } from '@/lib/decisions'
import type { Decision } from '@/types/db'

/**
 * Decision resurfacing — the loop that closes.
 *
 * A pass is only worth recording if something later tells you whether it was
 * right. This job watches for the world answering: a company we passed on
 * raises again, gets acquired, goes public, or dies. Each of those creates a
 * card on /terminal asking one question — was the reasoning right? — with the
 * original reasoning shown next to what actually happened.
 *
 * That question is the entire point of the decision layer. Without it the log
 * is a diary; with it, it is a calibration set. And it has to be automatic,
 * because nobody goes looking for evidence that they were wrong.
 *
 * TRIGGER SOURCES, and why only these two:
 *   funding_rounds — a real SEC Form D with a real filed_date. Unambiguous,
 *     and the date is the event's date, not ours.
 *   yc_companies   — status Acquired / Public / Inactive. Only fired for
 *     changes the yc-directory cron actually OBSERVED, never for the status a
 *     company already had at import. A company that was already Acquired when
 *     we first saw it tells us nothing about a decision made afterwards.
 *
 * `signals` is deliberately NOT a source: it is macro news keyed to headlines,
 * not company events, and matching passes against it would manufacture
 * resurfacings from noise. A false resurfacing is expensive — it trains you to
 * dismiss the stripe.
 *
 * Idempotent via the unique (decision_id, trigger_source, trigger_signal_id)
 * constraint from migration 0048, so re-running creates nothing new.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface FundingRow {
  id: string
  company_id: string
  filed_date: string
  total_amount_sold_usd: number | null
  source_url: string | null
}

function usd(n: number | null): string {
  if (n == null) return 'an undisclosed amount'
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  return `$${n.toLocaleString('en-US')}`
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const sb = supabaseServiceRole()

  // Only passes resurface. An Invest that goes well is already visible in the
  // portfolio, and an Advance is still in the pipeline — neither needs a card
  // asking whether the reasoning held.
  const { data: dRaw, error: dErr } = await sb
    .from('decisions').select('*').eq('outcome', 'Pass')
  if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 })
  const passes = (dRaw ?? []) as unknown as Decision[]

  if (!passes.length) {
    return NextResponse.json({ ok: true, passes: 0, created: 0, note: 'no passes recorded yet' })
  }

  const byCompany = new Map<string, Decision[]>()
  for (const d of passes) {
    byCompany.set(d.company_id, [...(byCompany.get(d.company_id) ?? []), d])
  }
  const companyIds = [...byCompany.keys()]

  type NewRow = {
    decision_id: string
    trigger_source: string
    trigger_signal_id: string
    trigger_kind: string
    trigger_summary: string
    trigger_date: string | null
    trigger_url: string | null
  }
  const candidates: NewRow[] = []

  // ---- funding rounds -----------------------------------------------------
  const { data: frRaw } = await sb
    .from('funding_rounds')
    .select('id, company_id, filed_date, total_amount_sold_usd, source_url')
    .in('company_id', companyIds)
  for (const fr of ((frRaw ?? []) as unknown as FundingRow[])) {
    for (const d of byCompany.get(fr.company_id) ?? []) {
      // Strictly after the decision. A round we already knew about when we
      // passed is context we had, not news that contradicts us.
      if (new Date(fr.filed_date) <= new Date(d.decided_at)) continue
      candidates.push({
        decision_id: d.id,
        trigger_source: 'funding_rounds',
        trigger_signal_id: fr.id,
        trigger_kind: 'FundingRound',
        trigger_summary: `Raised ${usd(fr.total_amount_sold_usd)} (SEC Form D, ${fr.filed_date})`,
        trigger_date: fr.filed_date,
        trigger_url: fr.source_url,
      })
    }
  }

  // ---- YC status changes --------------------------------------------------
  // `changed` is written by /api/cron/yc-directory when it OBSERVES a status
  // change in the daily feed. Reading yc_companies.status directly would fire
  // on the status a company already had at import, which says nothing about a
  // decision made later.
  const { data: ycRaw } = await sb
    .from('yc_status_changes')
    .select('id, company_id, from_status, to_status, observed_at')
    .in('company_id', companyIds)
  const YC_KIND: Record<string, string> = {
    Acquired: 'MA', Public: 'IPO', Inactive: 'Shutdown',
  }
  for (const c of ((ycRaw ?? []) as unknown as Array<{
    id: string; company_id: string; from_status: string | null
    to_status: string; observed_at: string
  }>)) {
    const kind = YC_KIND[c.to_status]
    if (!kind) continue
    for (const d of byCompany.get(c.company_id) ?? []) {
      if (new Date(c.observed_at) <= new Date(d.decided_at)) continue
      candidates.push({
        decision_id: d.id,
        trigger_source: 'signals',
        trigger_signal_id: `yc:${c.id}`,
        trigger_kind: kind,
        trigger_summary: `YC status changed ${c.from_status ?? 'unknown'} → ${c.to_status}`,
        trigger_date: c.observed_at.slice(0, 10),
        trigger_url: null,
      })
    }
  }

  if (!candidates.length) {
    return NextResponse.json({ ok: true, passes: passes.length, candidates: 0, created: 0 })
  }

  const before = await sb.from('decision_resurfacings')
    .select('*', { count: 'exact', head: true })

  // Insert ignoring duplicates. The unique constraint is what makes this
  // idempotent, so a re-run is a no-op rather than a pile of repeat cards.
  // Count before and after rather than trusting the client's return value.
  // An upsert with ignoreDuplicates resolves to ON CONFLICT DO NOTHING, and
  // supabase-js reports nothing useful about how many rows that actually
  // wrote — with or without .select(). Reporting its return verbatim made a
  // run that inserted two rows say `created: 0`, which would have left this
  // cron looking like a permanent no-op while it quietly worked. A monitoring
  // number that under-reports is worse than no number: it is the shape of bug
  // that hid the 90-day ingestion outage.
  const ins = await (sb.from('decision_resurfacings') as unknown as {
    upsert: (rows: unknown[], o: { onConflict: string; ignoreDuplicates: boolean }) => {
      select: () => Promise<{ data: unknown[] | null; error: { message: string } | null }>
    }
  }).upsert(candidates, {
    onConflict: 'decision_id,trigger_source,trigger_signal_id',
    ignoreDuplicates: true,
  }).select()
  if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 })

  const after = await sb.from('decision_resurfacings')
    .select('*', { count: 'exact', head: true })
  const created = Math.max(0, (after.count ?? 0) - (before.count ?? 0))
  if (created) {
    await appendCommit(sb, {
      entity_type: 'decision_resurfacing',
      entity_id: 'batch',
      action: 'resurfaced',
      summary: `${created} passed ${created === 1 ? 'company' : 'companies'} resurfaced for review`,
      diff: { created, candidates: candidates.length },
    })
  }

  return NextResponse.json({
    ok: true,
    passes: passes.length,
    candidates: candidates.length,
    created,
  })
}

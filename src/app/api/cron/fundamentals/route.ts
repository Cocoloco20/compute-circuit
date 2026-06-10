import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/service-role'
import { rotatingWindow } from '@/lib/cron-window'

import { fetchAllEdgarFundamentals } from '@/lib/market'

/**
 * Daily fundamentals refresh over a rotating window.
 *
 * Pulls SEC EDGAR companyfacts for a 120-co slice of the CIKed set, parses
 * the key XBRL tags (Revenue, GrossProfit, OperatingIncomeLoss, etc.), and
 * upserts into `fundamentals` keyed by (company_id, period, period_type, metric).
 *
 * History: this used to run weekly (Tuesdays) over ALL CIKed cos. At ~32 cos
 * that fit in the 60s cap; at 363 post-Phase-7B it takes ~2 minutes and times
 * out. Daily × 120-co rotation refreshes every co every ⌈N/120⌉ days (4 at
 * current N) — strictly fresher than the old weekly full pass, and each
 * invocation fits the budget. Quarterly 10-Q/10-K cadence means even weekly
 * was overkill per-co.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface CompanyRow {
  id: string
  cik: string
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return NextResponse.json({ error: 'supabase env missing' }, { status: 500 })
  const sb = supabaseServiceRole()

  const resp = await sb.from('companies').select('id, cik').not('cik', 'is', null)
  if (resp.error) return NextResponse.json({ error: resp.error.message }, { status: 500 })
  const companies = rotatingWindow(
    ((resp.data ?? []) as CompanyRow[]).filter(c => c.cik),
    120,
  ).map(c => ({ companyId: c.id, cik: c.cik }))

  const startedAt = Date.now()
  const results = await fetchAllEdgarFundamentals(companies)
  const fetchMs = Date.now() - startedAt

  type Row = {
    company_id: string
    period: string
    period_type: string
    metric: string
    value: number
    unit: string
    source: string
  }
  const rows: Row[] = []
  for (const r of results) {
    for (const f of r.rows) {
      rows.push({
        company_id: r.companyId,
        period: f.period,
        period_type: f.period_type,
        metric: f.metric,
        value: f.value,
        unit: f.unit,
        source: 'sec-companyfacts',
      })
    }
  }

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, scanned: companies.length, fundamentals: 0, fetchMs })
  }

  // Bulk upsert keyed on (company_id, period, period_type, metric) — see migration 0006
  const upResp = await (sb.from('fundamentals') as unknown as {
    upsert: (rows: Row[], opts: { onConflict: string }) =>
      Promise<{ data: unknown[] | null; error: { message: string } | null }>
  }).upsert(rows, { onConflict: 'company_id,period,period_type,metric' })
  if (upResp.error) return NextResponse.json({ error: upResp.error.message }, { status: 500 })

  // Per-company breakdown
  const perCompany = Object.fromEntries(
    results.map(r => [r.companyId, r.rows.length]),
  )

  return NextResponse.json({
    ok: true,
    scanned: companies.length,
    fundamentals: rows.length,
    fetchMs,
    perCompany,
  })
}

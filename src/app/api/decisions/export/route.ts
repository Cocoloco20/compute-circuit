import { NextRequest, NextResponse } from 'next/server'
import { parseFilters, searchDecisions, PAGE_SIZE } from '@/lib/decision-search'
import type { DecisionRow } from '@/lib/decision-search'

/**
 * CSV export of the current decision search.
 *
 * Same filters as the page, so whatever question you are looking at is what
 * you get out. Exists because calibration analysis wants a spreadsheet — "of
 * my 5/5 passes, what share were later judged wrong" is a pivot table, not a
 * web page.
 *
 * No auth: this route reads what /decisions already renders to the same
 * viewer, and adding a bearer token here while the page itself is open would
 * be security theatre. If /decisions ever goes behind auth, this goes with it.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Hard ceiling so a filterless export cannot pull an unbounded result set. */
const MAX_ROWS = 5000

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v)
  // Quote when the value could otherwise break the row, and double any
  // embedded quotes — the standard escaping, and the reason a reasoning
  // sentence containing a comma does not shift every later column.
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export async function GET(req: NextRequest) {
  const sp: Record<string, string> = {}
  req.nextUrl.searchParams.forEach((v, k) => { sp[k] = v })

  const rows: DecisionRow[] = []
  let page = 1
  // Walk the same paginated search the page uses rather than a second query
  // path, so the export can never disagree with what is on screen.
  for (;;) {
    const res = await searchDecisions({ ...parseFilters(sp), page })
    if (res.error) {
      return NextResponse.json({ error: res.error }, { status: 500 })
    }
    rows.push(...res.rows)
    if (rows.length >= MAX_ROWS || page >= res.pages || res.rows.length < PAGE_SIZE) break
    page++
  }

  const header = [
    'company', 'company_id', 'decided_at', 'outcome', 'primary_factor',
    'confidence', 'dissent', 'verdict', 'resurfaced_count',
    'reasoning', 'what_would_change_mind',
  ]
  const lines = [header.join(',')]
  for (const r of rows.slice(0, MAX_ROWS)) {
    lines.push([
      r.company, r.companyId, r.decidedAt, r.outcome, r.primaryFactor,
      r.confidence, r.dissent, r.verdict ?? '', r.resurfacedCount,
      r.reasoning, r.whatWouldChangeMind ?? '',
    ].map(csvCell).join(','))
  }

  const stamp = new Date().toISOString().slice(0, 10)
  return new NextResponse(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="decisions-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}

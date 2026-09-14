import { NextRequest, NextResponse } from 'next/server'
import { fetchAllLedgerRows, applyLedgerFilters, parseLedgerFilters, toCsv } from '@/lib/contract-ledger-data'

/** CSV of the ledger, honouring the same query params as /contracts. */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries())
  const { rows, error } = await fetchAllLedgerRows()
  if (error) return NextResponse.json({ error }, { status: 500 })
  const filtered = applyLedgerFilters(rows, parseLedgerFilters(sp))
  const stamp = new Date().toISOString().slice(0, 10)
  return new NextResponse(toCsv(filtered), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="compute-circuit-contract-ledger-${stamp}.csv"`,
      'Cache-Control': 'public, max-age=300',
    },
  })
}

import { NextRequest, NextResponse } from 'next/server'
import { fetchAllLedgerRows, applyLedgerFilters, parseLedgerFilters } from '@/lib/contract-ledger-data'
import { supabaseServiceRole } from '@/lib/supabase/service-role'
import { clientIp, checkRateLimit } from '@/lib/rate-limit'

/**
 * Public JSON API for the ledger -- same filters as /api/contracts/export
 * (the CSV route), same underlying data (fetchAllLedgerRows already excludes
 * anything without a filing to check it against). Rate-limited per IP so
 * one caller can't monopolize it; CDN-cached for five minutes so repeated
 * identical queries don't hit Supabase or the rate limit at all.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RATE_LIMIT_PER_HOUR = 120
const DATA_LICENSE = 'CC-BY-4.0; attribution required; https://offtake-ledger.vercel.app'

export async function GET(req: NextRequest) {
  const ip = clientIp(req.headers)
  const sb = supabaseServiceRole()
  const { limited, count } = await checkRateLimit(sb, ip, RATE_LIMIT_PER_HOUR)
  if (limited) {
    return NextResponse.json(
      { error: `rate limit exceeded: ${RATE_LIMIT_PER_HOUR} requests/hour per IP` },
      { status: 429, headers: { 'Retry-After': '3600', 'X-Data-License': DATA_LICENSE } },
    )
  }

  const sp = Object.fromEntries(req.nextUrl.searchParams.entries())
  const { rows, error } = await fetchAllLedgerRows()
  if (error) return NextResponse.json({ error }, { status: 500 })
  const filtered = applyLedgerFilters(rows, parseLedgerFilters(sp))

  return NextResponse.json(
    { rows: filtered, count: filtered.length, generated_at: new Date().toISOString() },
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Data-License': DATA_LICENSE,
        'X-RateLimit-Limit': String(RATE_LIMIT_PER_HOUR),
        ...(count != null ? { 'X-RateLimit-Remaining': String(Math.max(0, RATE_LIMIT_PER_HOUR - count)) } : {}),
        'Cache-Control': 'public, max-age=300',
      },
    },
  )
}

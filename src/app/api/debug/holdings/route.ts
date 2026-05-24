import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'

// Temporary debug route — returns raw holdings values to verify the 1000x
// discrepancy is server-side vs render-side.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface RowShape {
  investor_id: string
  cusip: string
  value_usd: number | string | null
  shares: number | string | null
}

export async function GET() {
  const sb = supabaseServer()
  const h = await sb
    .from('holdings')
    .select('investor_id, cusip, value_usd, shares')
    .eq('cusip', '67066G104')
    .limit(5)
  if (h.error) return NextResponse.json({ error: h.error.message }, { status: 500 })

  const rows = (h.data ?? []) as unknown as RowShape[]
  return NextResponse.json({
    note: 'raw from supabase-js server-side',
    rows: rows.map((r) => ({
      investor_id: r.investor_id,
      cusip: r.cusip,
      value_usd_raw: r.value_usd,
      value_usd_type: typeof r.value_usd,
      value_usd_string: String(r.value_usd),
      shares_raw: r.shares,
      shares_type: typeof r.shares,
    })),
  })
}

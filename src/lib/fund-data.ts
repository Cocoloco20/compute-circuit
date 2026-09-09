import { supabaseServiceRole } from '@/lib/supabase/service-role'
import type { Fund, Investment, Mark } from '@/types/db'

/**
 * Fund financials — what went out, what it is worth, what is left.
 *
 * The arithmetic here is the part a spreadsheet gets wrong quietly, so it is
 * written once and used everywhere (/terminal's dry powder, /fund's table).
 *
 * SERVICE ROLE ONLY. This is the most sensitive data in the system.
 */

export interface PositionRow {
  investmentId: string
  companyId: string
  company: string
  investedAt: string
  amountUsd: number
  instrument: string
  round: string | null
  postMoneyUsd: number | null
  ownershipPct: number | null
  reservedUsd: number
  status: Investment['status']
  /** Newest mark. Null when never marked — then cost basis is the only honest value. */
  markUsd: number | null
  markedAt: string | null
  markSource: string | null
  /** Multiple on invested capital. Uses cost when unmarked, so it reads 1.00x. */
  moic: number
}

export interface FundSummary {
  fund: Fund | null
  positions: PositionRow[]
  totals: {
    committed: number
    called: number
    deployed: number
    /** Reserved against specific names, not the whole reserve pool. */
    earmarked: number
    /** committed × reserve_ratio — what is held back for follow-ons overall. */
    reservePool: number
    /** What can still go into NEW names. The number /terminal shows. */
    dryPowder: number
    fairValue: number
    tvpi: number
    dpi: number
    unrealized: number
  }
  error: string | null
}

const ZERO: FundSummary['totals'] = {
  committed: 0, called: 0, deployed: 0, earmarked: 0, reservePool: 0,
  dryPowder: 0, fairValue: 0, tvpi: 0, dpi: 0, unrealized: 0,
}

export async function fetchFund(): Promise<FundSummary> {
  const sb = supabaseServiceRole()
  try {
    const { data: fRaw } = await sb.from('fund').select('*').limit(1).maybeSingle()
    const fund = (fRaw as unknown as Fund) ?? null

    const { data: invRaw, error } = await sb
      .from('investments').select('*').order('invested_at', { ascending: false })
    if (error) throw new Error(error.message)
    const investments = (invRaw ?? []) as unknown as Investment[]

    if (!investments.length) {
      const committed = Number(fund?.committed_usd ?? 0)
      const reservePool = committed * Number(fund?.reserve_ratio ?? 0)
      return {
        fund, positions: [],
        totals: { ...ZERO, committed, called: Number(fund?.called_usd ?? 0),
                  reservePool, dryPowder: Math.max(0, committed - reservePool) },
        error: null,
      }
    }

    // Newest mark per investment.
    const { data: mRaw } = await sb.from('marks').select('*')
      .in('investment_id', investments.map(i => i.id))
      .order('marked_at', { ascending: false })
    const newest = new Map<string, Mark>()
    for (const m of ((mRaw ?? []) as unknown as Mark[])) {
      if (!newest.has(m.investment_id)) newest.set(m.investment_id, m)
    }

    const { data: cos } = await sb.from('companies').select('id, name')
      .in('id', [...new Set(investments.map(i => i.company_id))])
    const names = new Map(((cos ?? []) as unknown as Array<{ id: string; name: string }>)
      .map(c => [c.id, c.name]))

    const positions: PositionRow[] = investments.map(i => {
      const m = newest.get(i.id) ?? null
      const cost = Number(i.amount_usd)
      // Unmarked positions are held at cost. Writing them up on a hunch is how
      // a paper portfolio flatters itself; 1.00x is the honest default.
      const value = m ? Number(m.value_usd) : cost
      return {
        investmentId: i.id,
        companyId: i.company_id,
        company: names.get(i.company_id) ?? i.company_id,
        investedAt: i.invested_at,
        amountUsd: cost,
        instrument: i.instrument,
        round: i.round,
        postMoneyUsd: i.post_money_usd == null ? null : Number(i.post_money_usd),
        ownershipPct: i.ownership_pct == null ? null : Number(i.ownership_pct),
        reservedUsd: Number(i.reserved_usd),
        status: i.status,
        markUsd: m ? Number(m.value_usd) : null,
        markedAt: m?.marked_at ?? null,
        markSource: m?.source ?? null,
        moic: cost > 0 ? value / cost : 0,
      }
    })

    const committed = Number(fund?.committed_usd ?? 0)
    const called = Number(fund?.called_usd ?? 0)
    const deployed = positions.reduce((s, p) => s + p.amountUsd, 0)
    const earmarked = positions
      .filter(p => p.status === 'Active')
      .reduce((s, p) => s + p.reservedUsd, 0)
    const reservePool = committed * Number(fund?.reserve_ratio ?? 0)
    const fairValue = positions.reduce((s, p) => s + (p.markUsd ?? p.amountUsd), 0)

    // Realised proceeds: an exited position's mark IS the proceeds.
    const realised = positions
      .filter(p => p.status === 'Exited')
      .reduce((s, p) => s + (p.markUsd ?? 0), 0)

    return {
      fund, positions,
      totals: {
        committed, called, deployed, earmarked, reservePool,
        // Held-back reserve is not available for new names, and neither is
        // what already went out. Floored at zero — a negative number here
        // would mean over-commitment, which the page should show as 0 and the
        // deployed figure will make obvious.
        dryPowder: Math.max(0, committed - deployed - reservePool),
        fairValue,
        tvpi: deployed > 0 ? (fairValue + realised) / deployed : 0,
        dpi: deployed > 0 ? realised / deployed : 0,
        unrealized: fairValue - deployed,
      },
      error: null,
    }
  } catch (err) {
    return { fund: null, positions: [], totals: ZERO,
             error: err instanceof Error ? err.message : String(err) }
  }
}

export function usd(n: number | null | undefined): string {
  if (n == null) return '—'
  const a = Math.abs(n)
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (a >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${Math.round(n).toLocaleString('en-US')}`
}

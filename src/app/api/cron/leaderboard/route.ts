import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/service-role'
import { fetchLmarenaLeaderboard, fetchArtificialAnalysisLeaderboard } from '@/lib/leaderboard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface LeaderboardRow {
  snapshot_date: string
  source: 'lmarena' | 'artificialanalysis'
  model_name: string
  company_id: string | null
  elo_score: number | null
  elo_rank: number
  params_b: number | null
  license: string | null
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
  const snapshotDate = new Date().toISOString().slice(0, 10)
  const startedAt = Date.now()

  // Run fetches in parallel
  const [lmarena, aa] = await Promise.all([
    fetchLmarenaLeaderboard(),
    fetchArtificialAnalysisLeaderboard()
  ])
  const fetchMs = Date.now() - startedAt

  const rows: LeaderboardRow[] = []

  // Combine lmarena
  for (const item of lmarena) {
    rows.push({
      snapshot_date: snapshotDate,
      source: 'lmarena',
      model_name: item.model_name,
      company_id: item.company_id,
      elo_score: item.elo_score,
      elo_rank: item.elo_rank,
      params_b: item.params_b,
      license: item.license
    })
  }

  // Combine Artificial Analysis
  for (const item of aa) {
    rows.push({
      snapshot_date: snapshotDate,
      source: 'artificialanalysis',
      model_name: item.model_name,
      company_id: item.company_id,
      elo_score: item.elo_score,
      elo_rank: item.elo_rank,
      params_b: item.params_b,
      license: item.license
    })
  }

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, inserted: 0, note: 'no rows fetched' })
  }

  const upResp = await (sb.from('model_leaderboard') as unknown as {
    upsert: (rows: LeaderboardRow[], opts: { onConflict: string }) =>
      Promise<{ error: { message: string } | null }>
  }).upsert(rows, {
    onConflict: 'snapshot_date,source,model_name'
  })

  if (upResp.error) {
    return NextResponse.json({ error: upResp.error.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    fetched: rows.length,
    fetchMs,
    rows: rows.length
  })
}

import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/service-role'
import { fetchHnMentions, fetchRedditMentions, COMPANY_ALIASES } from '@/lib/social'
import type { Database } from '@/types/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface CoRow {
  id: string
  ticker: string | null
  name: string
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const sb = supabaseServiceRole()

  // Paginate — Supabase default cap is 1000 rows; the post-Phase-7B table
  // has 2,461. Without the loop the social cron silently skipped 1,461.
  const PAGE = 1000
  const allCompanies: CoRow[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from('companies').select('id, ticker, name').range(from, from + PAGE - 1).order('id')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const batch = (data ?? []) as CoRow[]
    allCompanies.push(...batch)
    if (batch.length < PAGE) break
  }

  // BUDGET GUARD — HN + Reddit each take ~600ms per co; 5-parallel chunk
  // batchSize means 2,461/5 = ~493 waves × 600ms = 295s, way over the 60s
  // cap. Restrict to a sliding window of 200 cos prioritized by stalest-
  // social-snapshot. Daily cycle covers everyone in ~12 days, which is fine
  // for buzz tracking (the underlying data has multi-day granularity anyway).
  const CRON_BUDGET = 200
  let list = allCompanies
  if (list.length > CRON_BUDGET) {
    const { data: oldest } = await sb
      .from('social_mentions')
      .select('company_id')
      .order('snapshot_date', { ascending: true })
      .limit(CRON_BUDGET)
    const staleIds = new Set((oldest ?? []).map((r) => (r as { company_id: string }).company_id))
    list = list
      .sort((a, b) => (staleIds.has(b.id) ? 1 : 0) - (staleIds.has(a.id) ? 1 : 0))
      .slice(0, CRON_BUDGET)
  }
  const results: Array<{
    coId: string
    hn: {
      mentions_24h: number
      mentions_7d: number
      top_post_url: string | null
      top_post_title: string | null
      top_post_score: number | null
      top_post_comments: number | null
    }
    reddit: {
      mentions_24h: number
      mentions_7d: number
      top_post_url: string | null
      top_post_title: string | null
      top_post_score: number | null
      top_post_comments: number | null
      sample_subreddits?: string[]
    }
  }> = []
  const batchSize = 5

  const startedAt = Date.now()

  // Process in parallel batches of 5 companies
  for (let i = 0; i < list.length; i += batchSize) {
    const chunk = list.slice(i, i + batchSize)
    const batchRes = await Promise.all(
      chunk.map(async (co) => {
        const aliases = COMPANY_ALIASES[co.id] ?? [co.name, ...(co.ticker ? [co.ticker] : [])]
        const [hn, reddit] = await Promise.all([
          fetchHnMentions(co.name, aliases),
          fetchRedditMentions(co.name, aliases),
        ])
        return { coId: co.id, hn, reddit }
      })
    )
    results.push(...batchRes)
  }

  const fetchMs = Date.now() - startedAt
  const today = new Date().toISOString().slice(0, 10)
  const rows: Database['public']['Tables']['social_mentions']['Insert'][] = []

  for (const res of results) {
    rows.push({
      company_id: res.coId,
      snapshot_date: today,
      source: 'hn',
      mentions_24h: res.hn.mentions_24h,
      mentions_7d: res.hn.mentions_7d,
      top_post_url: res.hn.top_post_url,
      top_post_title: res.hn.top_post_title,
      top_post_score: res.hn.top_post_score,
      top_post_comments: res.hn.top_post_comments,
      sample_subreddits: null,
    })
    rows.push({
      company_id: res.coId,
      snapshot_date: today,
      source: 'reddit',
      mentions_24h: res.reddit.mentions_24h,
      mentions_7d: res.reddit.mentions_7d,
      top_post_url: res.reddit.top_post_url,
      top_post_title: res.reddit.top_post_title,
      top_post_score: res.reddit.top_post_score,
      top_post_comments: res.reddit.top_post_comments,
      sample_subreddits: res.reddit.sample_subreddits || [],
    })
  }

  const { error: upsertError } = await (sb.from('social_mentions') as unknown as {
    upsert: (
      rows: Database['public']['Tables']['social_mentions']['Insert'][],
      opts: { onConflict: string }
    ) => Promise<{ error: { message: string } | null }>
  }).upsert(rows, {
    onConflict: 'company_id,snapshot_date,source',
  })

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    scanned: list.length,
    upserted: rows.length,
    fetchMs,
  })
}

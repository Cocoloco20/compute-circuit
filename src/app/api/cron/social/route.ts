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

  // Fetch all companies from db
  const { data: companies, error: cosError } = await sb.from('companies').select('id, ticker, name')
  if (cosError) {
    return NextResponse.json({ error: cosError.message }, { status: 500 })
  }

  const list = (companies ?? []) as CoRow[]
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

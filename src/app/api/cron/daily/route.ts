import { NextRequest, NextResponse } from 'next/server'

/**
 * Single daily cron dispatcher.
 *
 * Vercel Hobby plan caps cron jobs at 2 — to fit the 8-K (daily), 13F
 * (weekly), and portfolio-scraper (monthly) trackers under one entry,
 * this route fires on a daily schedule and decides what to invoke based
 * on the current UTC date:
 *
 *   * 8-K tracker      — every day
 *   * 13F tracker      — Sundays (getUTCDay() === 0)
 *   * Portfolio scraper — 1st of month (getUTCDate() === 1)
 *
 * Each sub-route remains independently callable via curl with the
 * CRON_SECRET — this dispatcher just calls them in series.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60 // Vercel Hobby plan max

interface SubResult {
  task: string
  ok: boolean
  status?: number
  body?: unknown
  error?: string
  ms?: number
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })

  // Vercel cron requests are signed via the Authorization header automatically
  // (Bearer ${process.env.CRON_SECRET} from project env). Manual curls send the
  // same header. Reject anything else.
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const host = req.headers.get('host') ?? 'compute-circuit.vercel.app'
  const baseUrl = host.startsWith('localhost') ? `http://${host}` : `https://${host}`

  const now = new Date()
  const day = now.getUTCDay()    // 0 = Sunday
  const date = now.getUTCDate()  // 1..31

  async function call(task: string, path: string): Promise<SubResult> {
    const t0 = Date.now()
    try {
      const r = await fetch(`${baseUrl}${path}`, {
        headers: { Authorization: `Bearer ${secret}` },
      })
      const ms = Date.now() - t0
      const body = await r.json().catch(() => null)
      return { task, ok: r.ok, status: r.status, body, ms }
    } catch (err) {
      return { task, ok: false, error: err instanceof Error ? err.message : String(err), ms: Date.now() - t0 }
    }
  }

  const results: SubResult[] = []
  // Daily: prices (~5s) + 8-K filings (~3s incremental) + news (~5s) +
  // insider (~20s incremental) + HF activity (~5s for ~20 orgs)
  results.push(await call('prices', '/api/cron/prices'))
  results.push(await call('8k-tracker', '/api/cron/8k-tracker'))
  results.push(await call('transcripts', '/api/cron/transcripts'))
  results.push(await call('news', '/api/cron/news'))
  results.push(await call('insider', '/api/cron/insider'))
  results.push(await call('form-d', '/api/cron/form-d'))
  results.push(await call('hf-activity', '/api/cron/hf-activity'))
  results.push(await call('github', '/api/cron/github'))
  results.push(await call('eia', '/api/cron/eia'))
  results.push(await call('patents', '/api/cron/patents'))
  results.push(await call('jobs', '/api/cron/jobs'))
  results.push(await call('btc', '/api/cron/btc'))
  results.push(await call('gpu-spot', '/api/cron/gpu-spot'))
  results.push(await call('leaderboard', '/api/cron/leaderboard'))
  results.push(await call('social', '/api/cron/social'))
  results.push(await call('interest', '/api/cron/interest'))
  // Weekly: fundamentals (Tuesdays = day 2) + 13F holdings (Sundays = day 0)
  if (day === 2) results.push(await call('fundamentals', '/api/cron/fundamentals'))
  if (day === 0) results.push(await call('13f-tracker', '/api/cron/13f-tracker'))
  // Monthly: VC portfolio scraper (1st of month)
  if (date === 1) results.push(await call('portfolio-scraper', '/api/cron/portfolio-scraper'))

  // Digest: only if Resend is configured. Runs after all data crons so it
  // gets fresh numbers. The digest has its own separate Vercel cron at 8am ET,
  // but calling it here too means the nightly data run always sends one too.
  // Skip silently if RESEND_API_KEY is absent so the daily cron stays green
  // even before the user configures email.
  if (process.env.RESEND_API_KEY) {
    results.push(await call('digest', '/api/cron/digest'))
  }

  return NextResponse.json({
    ok: results.every(r => r.ok),
    timestamp: now.toISOString(),
    day,
    date,
    results,
  })
}

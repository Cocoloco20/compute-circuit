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
  results.push(await call('8k-tracker', '/api/cron/8k-tracker'))
  if (day === 0) results.push(await call('13f-tracker', '/api/cron/13f-tracker'))
  if (date === 1) results.push(await call('portfolio-scraper', '/api/cron/portfolio-scraper'))

  return NextResponse.json({
    ok: results.every(r => r.ok),
    timestamp: now.toISOString(),
    day,
    date,
    results,
  })
}

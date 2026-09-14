import { selfOrigin } from '@/lib/self-origin'
import { NextRequest, NextResponse } from 'next/server'

/**
 * Single daily cron dispatcher.
 *
 * Vercel Hobby plan caps cron jobs at 2 — to fit all trackers under one
 * entry, this route fires daily and decides what to invoke based on the
 * current UTC date (13F on Sundays, portfolio scraper on the 1st).
 *
 * LAUNCH MODEL — parallel, not serial. Each sub-route is its own Vercel
 * invocation with its own 60s budget; once its request is accepted it runs
 * to completion regardless of what happens to this dispatcher. The old
 * serial `await` chain broke after Phase 7B: with 18 sub-crons where prices
 * alone takes ~40s and news ~30s, the dispatcher hit its own 60s cap
 * mid-sequence and every cron after the cutoff (social, gpu-spot,
 * logo-maintenance, digest, …) silently never fired.
 *
 * Now all sub-crons launch at t=0 and we wait up to DISPATCH_BUDGET_MS for
 * results purely for REPORTING — tasks still running at the deadline are
 * reported as 'started' and finish on their own.
 *
 * Trade-offs accepted with the parallel model:
 *   - logo-maintenance no longer runs strictly after form-d/portfolio-scraper,
 *     so a co inserted tonight gets its logo tomorrow night. It's idempotent
 *     and bounded, so this only costs one day of monogram fallback.
 *   - digest fires alongside the data crons instead of after them, so it
 *     reflects yesterday's data. The dedicated 12:00 UTC digest cron (14h
 *     after this 22:00 UTC run) is the fresh-data send.
 *   - SEC-walking crons (8k, insider, transcripts, form-d) overlap. Each
 *     paces itself to ~3-7 req/s and they egress from separate lambdas, so
 *     aggregate load on sec.gov stays within tolerance.
 *
 * Each sub-route remains independently callable via curl with CRON_SECRET.
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
  /** True when the sub-cron was launched but hadn't responded by the
   *  dispatcher's reporting deadline — it keeps running independently. */
  pending?: boolean
}

// How long the dispatcher waits to COLLECT results before returning.
// Keeps us safely under our own maxDuration=60 while letting most
// sub-crons report a real status. Anything slower is reported 'started'.
const DISPATCH_BUDGET_MS = 50_000

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })

  // Vercel cron requests are signed via the Authorization header automatically
  // (Bearer ${process.env.CRON_SECRET} from project env). Manual curls send the
  // same header. Reject anything else.
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // Never the inbound Host — see selfOrigin() for the 90-day outage that caused.
  const baseUrl = selfOrigin(req)

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

  const tasks: Array<{ task: string; path: string }> = [
    { task: 'prices', path: '/api/cron/prices' },
    { task: '8k-tracker', path: '/api/cron/8k-tracker' },
    { task: 'transcripts', path: '/api/cron/transcripts' },
    { task: 'news', path: '/api/cron/news' },
    { task: 'insider', path: '/api/cron/insider' },
    { task: 'form-d', path: '/api/cron/form-d' },
    { task: 'hf-activity', path: '/api/cron/hf-activity' },
    { task: 'github', path: '/api/cron/github' },
    { task: 'eia', path: '/api/cron/eia' },
    { task: 'patents', path: '/api/cron/patents' },
    { task: 'jobs', path: '/api/cron/jobs' },
    { task: 'btc', path: '/api/cron/btc' },
    { task: 'gpu-spot', path: '/api/cron/gpu-spot' },
    { task: 'leaderboard', path: '/api/cron/leaderboard' },
    { task: 'social', path: '/api/cron/social' },
    { task: 'interest', path: '/api/cron/interest' },
    { task: 'arxiv', path: '/api/cron/arxiv' },
    { task: 'yc-directory', path: '/api/cron/yc-directory' },
    // After yc-directory, so a status change observed tonight can resurface
    // tonight rather than waiting a full day.
    { task: 'resurface', path: '/api/cron/resurface' },
    { task: 'briefs', path: '/api/cron/briefs' },
    // Daily over a rotating 120-co window since Phase 7B (was Tuesdays-only
    // over the full set, which now blows the sub-cron's own 60s budget).
    { task: 'fundamentals', path: '/api/cron/fundamentals' },
    // Bounded + idempotent; see header for why it no longer waits on form-d.
    { task: 'logo-maintenance', path: '/api/cron/logo-maintenance' },
    // Contract ledger: last 10 days of provider filings, budgeted.
    { task: 'contracts', path: '/api/cron/contracts' },
  ]
  // Weekly: 13F holdings (Sundays). Monthly: VC portfolio scraper (1st).
  if (day === 0) tasks.push({ task: '13f-tracker', path: '/api/cron/13f-tracker' })
  if (date === 1) tasks.push({ task: 'portfolio-scraper', path: '/api/cron/portfolio-scraper' })
  // Digest only when Resend is configured — the dedicated 12:00 UTC cron is
  // the primary send; this nightly copy is best-effort.
  if (process.env.RESEND_API_KEY) tasks.push({ task: 'digest', path: '/api/cron/digest' })

  // Launch everything NOW. Each fetch hits an independent lambda that runs
  // to completion on its own; we only race the deadline for reporting.
  const settled = new Map<string, SubResult>()
  const inFlight = tasks.map(t =>
    call(t.task, t.path).then(r => { settled.set(t.task, r) }),
  )
  await Promise.race([
    Promise.allSettled(inFlight),
    new Promise<void>(resolve => setTimeout(resolve, DISPATCH_BUDGET_MS)),
  ])

  const results: SubResult[] = tasks.map(t =>
    settled.get(t.task) ?? { task: t.task, ok: true, pending: true },
  )

  return NextResponse.json({
    ok: results.every(r => r.ok),
    timestamp: now.toISOString(),
    day,
    date,
    launched: tasks.length,
    reported: settled.size,
    stillRunning: tasks.length - settled.size,
    results,
  })
}

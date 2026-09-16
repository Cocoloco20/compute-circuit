import { selfOrigin } from '@/lib/self-origin'
import { NextRequest, NextResponse } from 'next/server'

/**
 * Single daily cron dispatcher.
 *
 * Down to two jobs since the /graph economy-map archive (2026-09-16):
 * logo-maintenance (shared with Offtake's own company pages) and contracts
 * (the ledger's own incremental backfill). Everything else this dispatcher
 * used to fan out to (prices, 8k-tracker, transcripts, news, insider,
 * form-d, hf-activity, github, eia, patents, jobs, btc, gpu-spot,
 * leaderboard, social, interest, arxiv, yc-directory, briefs, fundamentals,
 * 13f-tracker, portfolio-scraper, digest) fed that page and nothing else --
 * see the archive commit for why it came down.
 *
 * LAUNCH MODEL — parallel, not serial, kept from the multi-cron era: each
 * sub-route is its own Vercel invocation with its own 60s budget; once its
 * request is accepted it runs to completion regardless of what happens to
 * this dispatcher. We wait up to DISPATCH_BUDGET_MS for results purely for
 * REPORTING — a task still running at the deadline is reported as
 * 'started' and finishes on its own.
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

  // Everything the old /graph economy-map (prices, 8k-tracker, transcripts,
  // news, insider, form-d, hf-activity, github, eia, patents, jobs, btc,
  // gpu-spot, leaderboard, social, interest, arxiv, yc-directory, briefs,
  // fundamentals, 13f-tracker, portfolio-scraper, digest) fed was archived
  // 2026-09-16 -- unsourced, 14,844-company snapshot with no citation
  // trail, dropped once and never verified again. Offtake's own two jobs
  // are what's left: company logos (shared with the ledger's company
  // pages) and the ledger's own incremental cron.
  const tasks: Array<{ task: string; path: string }> = [
    { task: 'logo-maintenance', path: '/api/cron/logo-maintenance' },
    // Contract ledger: last 10 days of provider filings, budgeted.
    { task: 'contracts', path: '/api/cron/contracts' },
  ]

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

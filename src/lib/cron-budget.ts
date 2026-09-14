/**
 * Wall-clock budget for cron routes.
 *
 * Vercel kills a function at `maxDuration` (60s on this plan) and nothing
 * after that point runs — no upsert, no response, and the daily dispatcher
 * just sees a hung request. Between 2026-09-08 and 09-13 eight sub-crons
 * (news, github, prices, transcripts, jobs, arxiv, briefs, logo-maintenance)
 * hit that wall 54 times: each walked its whole input set with no idea how
 * much time it had left, so a slow upstream turned a partial run into NO run.
 *
 * A budget makes the fetch phase stop early and hand whatever it collected to
 * the write phase. Partial-but-persisted beats complete-but-killed: the next
 * run (or the rotating window) picks up the rest.
 *
 * Usage:
 *   const budget = startBudget(FETCH_BUDGET_MS)
 *   for (const item of items) {
 *     if (budget.expired()) break
 *     ...
 *   }
 */

/** The platform hard cap the routes export as `maxDuration`. */
export const CRON_HARD_CAP_MS = 60_000

/**
 * Default share of the cap given to the fetch phase. Leaves ~20s for the
 * cold start that precedes the handler, the Supabase reads before the loop,
 * and the upsert after it.
 */
export const DEFAULT_FETCH_BUDGET_MS = 38_000

export interface Budget {
  /** Epoch ms at which the budget runs out. */
  readonly deadlineAt: number
  /** Milliseconds left; never negative. */
  remaining(): number
  /** True once the deadline has passed. */
  expired(): boolean
  /** Milliseconds since the budget started. */
  elapsed(): number
}

export function startBudget(ms: number = DEFAULT_FETCH_BUDGET_MS, now: () => number = Date.now): Budget {
  const startedAt = now()
  const deadlineAt = startedAt + ms
  return {
    deadlineAt,
    remaining: () => Math.max(0, deadlineAt - now()),
    expired: () => now() >= deadlineAt,
    elapsed: () => now() - startedAt,
  }
}

/**
 * Per-request ceiling for a single upstream call inside a budgeted loop. A
 * budget check between iterations can't help if one fetch hangs for the
 * whole remaining window, so every fetch in the loop also carries this.
 */
export const UPSTREAM_TIMEOUT_MS = 8_000

export function upstreamSignal(ms: number = UPSTREAM_TIMEOUT_MS): AbortSignal {
  return AbortSignal.timeout(ms)
}

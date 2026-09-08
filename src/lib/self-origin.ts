import type { NextRequest } from 'next/server'

/**
 * The origin a cron route should use when calling its sibling routes.
 *
 * WHY THIS EXISTS — the outage of 2026-06-10 to 2026-09-08.
 *
 * The dispatcher used to fan out to `https://${req.headers.get('host')}`.
 * That looks right and is wrong on Vercel: a scheduled cron invokes the
 * DEPLOYMENT url (compute-circuit-<hash>-<team>.vercel.app), not the
 * production alias, so the Host header is the deployment url. This project
 * has Vercel Authentication (SSO protection) enabled with deploymentType
 * "all_except_custom_domains", which covers exactly those deployment urls.
 *
 * So every sub-cron fetch got a 302 to Vercel's login wall before it ever
 * reached the function — with a perfectly valid CRON_SECRET attached. The
 * dispatcher itself ran (Vercel's cron bypasses protection for the path it
 * schedules), reported ~20 failed children, and wrote nothing. Ingestion
 * across every table stopped dead for 90 days while the site stayed up.
 *
 * Measured 2026-09-08, same secret, same route, same second:
 *   https://compute-circuit-nsk896mbx-….vercel.app/api/cron/gpu-spot → 302
 *   https://compute-circuit.vercel.app/api/cron/gpu-spot             → 200
 *
 * The fix is to never trust the inbound Host for self-calls. Prefer Vercel's
 * own production-alias env var, fall back to the literal alias, and only use
 * the request Host in local dev where there is no alias to speak of.
 */

const PRODUCTION_HOST = 'compute-circuit.vercel.app'

export function selfOrigin(req: NextRequest): string {
  const host = req.headers.get('host') ?? ''

  // Local dev: the request host IS the only origin that exists.
  if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) {
    return `http://${host}`
  }

  // Vercel sets this to the project's production alias on every deployment.
  // It is exempt from all_except_custom_domains SSO protection; the
  // per-deployment url is not.
  const alias = process.env.VERCEL_PROJECT_PRODUCTION_URL || PRODUCTION_HOST
  return `https://${alias}`
}

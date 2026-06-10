/**
 * Service-role Supabase client for cron routes.
 *
 * Like supabaseServer() but uses SUPABASE_SERVICE_ROLE_KEY (bypass RLS for
 * writes) and wraps fetch with `cache: 'no-store'` to bypass Next.js's
 * automatic fetch cache.
 *
 * The fetch-cache wrap is critical — without it, repeated cron invocations
 * within the same warm Lambda instance return stale Supabase reads (e.g.
 * a backfilled companies.assignee_name change doesn't surface until the
 * Lambda is cold-started). force-dynamic on the route only disables ROUTE
 * caching, not FETCH caching inside the route. See:
 *   https://nextjs.org/docs/app/building-your-application/caching#data-cache
 */

import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/db'

// Bound every DB round-trip. Normal queries finish well under a second; the
// only thing an unbounded wait buys is a hung lambda when Supabase is
// unreachable (seen live 2026-05-26: a supabase.co DNS incident made routes
// hang to their full maxDuration instead of failing fast).
const FETCH_TIMEOUT_MS = 15_000

export function supabaseServiceRole() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient<Database>(url, key, {
    auth: { persistSession: false },
    global: {
      fetch: (u, init) => fetch(u, {
        ...init,
        cache: 'no-store',
        // Preserve a caller-provided signal (supabase-js .abortSignal());
        // otherwise cap the round-trip.
        signal: init?.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS),
      }),
    },
  })
}

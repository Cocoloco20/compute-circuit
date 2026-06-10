import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/db'

// Server-side client for use in Server Components, Route Handlers, and Server Actions.
// Uses the anon key — same RLS rules as the browser client (read-only).
//
// Critical: Next.js automatically caches the global fetch() in server
// components. supabase-js uses that fetch under the hood, so without
// opting out, every Supabase read returns stale data across requests —
// even with `force-dynamic` on the page. Wrapping fetch with `cache: 'no-store'`
// disables it for all supabase-js calls.
//
// When auth is added later, swap this for @supabase/ssr's createServerClient
// so it can read the user's session from cookies.
// Bound every DB round-trip so an unreachable Supabase fails the page fast
// (error boundary) instead of hanging the server render until the lambda's
// maxDuration. Seen live 2026-05-26 during a supabase.co DNS incident: the
// homepage spun 20s+ per visitor with zero bytes served.
const FETCH_TIMEOUT_MS = 15_000

export const supabaseServer = () =>
  createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: { persistSession: false },
      global: {
        fetch: (url, init) => fetch(url, {
          ...init,
          cache: 'no-store',
          signal: init?.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS),
        }),
      },
    },
  )

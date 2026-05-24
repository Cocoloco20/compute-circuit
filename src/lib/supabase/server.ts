import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/db'

// Server-side client for use in Server Components, Route Handlers, and Server Actions.
// Uses the anon key — same RLS rules as the browser client (read-only).
// When auth is added later, swap this for @supabase/ssr's createServerClient
// so it can read the user's session from cookies.
export const supabaseServer = () =>
  createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  )

import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/db'

// Admin client — uses the service_role key, which BYPASSES RLS.
// Only use this from:
//   - Local scripts (seed, manual data backfill)
//   - Vercel cron jobs / API routes that need to write
// NEVER import this from a "use client" component or pass the key to the browser.
//
// The key is read from a non-NEXT_PUBLIC_ env var, so Next.js won't accidentally
// bundle it into client code.
export const supabaseAdmin = () => {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set')
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    key,
    { auth: { persistSession: false } },
  )
}

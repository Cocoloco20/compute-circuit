import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/db'

// Browser-side client for "use client" components.
// Uses the anon key, which RLS scopes to read-only access on every table.
// Safe to expose — it can only do what the SELECT policies allow.
export const supabaseBrowser = () =>
  createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )

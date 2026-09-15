/**
 * Per-IP fixed-window rate limiting, backed by the api_rate_limits table
 * (migration 0057). One atomic RPC call per request -- increment_rate_limit
 * upserts (ip, hour-window) and returns the new count in one statement, so
 * concurrent requests from the same IP can't race past the limit the way a
 * read-then-write in application code could.
 *
 * Fails open: an RPC error (table momentarily unreachable, etc.) allows the
 * request rather than breaking the API for everyone over an infra hiccup.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = SupabaseClient<any>

/** First entry in X-Forwarded-For, which is what Vercel's edge sets to the
 *  real client IP. Falls back to X-Real-IP, then a constant so requests
 *  without either header still share one bucket rather than bypass limiting
 *  entirely. */
export function clientIp(headers: Headers): string {
  const xff = headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return headers.get('x-real-ip')?.trim() || 'unknown'
}

export function hourWindow(now: Date = new Date()): string {
  return new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000).toISOString()
}

export interface RateLimitResult {
  limited: boolean
  count: number | null
}

export async function checkRateLimit(sb: Sb, ip: string, limitPerHour: number): Promise<RateLimitResult> {
  const { data, error } = await sb.rpc('increment_rate_limit', { p_ip: ip, p_window: hourWindow() })
  if (error) {
    // eslint-disable-next-line no-console
    console.warn('[rate-limit] RPC failed, failing open:', error.message)
    return { limited: false, count: null }
  }
  const count = data as number
  return { limited: count > limitPerHour, count }
}

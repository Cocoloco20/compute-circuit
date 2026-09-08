/**
 * watchlist-store.ts — client-side store for the user watchlist.
 *
 * Replaces the old anon-role read that travelled inside the SSR GraphData
 * payload (HOLE 1 fix). The watchlist now lives only behind /api/watchlist
 * (Bearer CRON_SECRET), and this module is the single client source of truth
 * for it — MyRadar (pulse-board) and the drawer track controls both read from
 * here so they stay in sync without any data escaping into the public HTML.
 *
 * 'use client' — this must never run in a server component / during SSR.
 */

'use client'

import { useSyncExternalStore } from 'react'
import type { WatchlistEntry } from '@/types/db'

interface WatchlistState {
  /** null = not loaded yet; [] = loaded, empty. */
  data: WatchlistEntry[] | null
  loading: boolean
  /** Non-null on auth/network failure — surfaces the unlock/error state. */
  error: string | null
}

let state: WatchlistState = { data: null, loading: false, error: null }
const listeners = new Set<() => void>()
let inflight: Promise<void> | null = null

function set(next: Partial<WatchlistState>) {
  state = { ...state, ...next }
  listeners.forEach(l => l())
}
function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/**
 * Return the stored CRON_SECRET without prompting. The store loader uses this
 * so page load never pops a prompt for people who aren't tracking anything.
 */
function readClientKey(): string | null {
  if (typeof window === 'undefined') return null
  const k = window.localStorage.getItem('cc_key')
  return k?.trim() || null
}

/**
 * The unlock flow used by write actions: read the stored key, or prompt for
 * it on first use and persist it.
 */
export function getClientKey(): string | null {
  if (typeof window === 'undefined') return null
  let k = window.localStorage.getItem('cc_key')
  if (!k) {
    k = window.prompt('Enter your CRON_SECRET to unlock tracking (stored locally):')
    if (k) window.localStorage.setItem('cc_key', k.trim())
  }
  return k?.trim() || null
}

function doLoad(): Promise<void> {
  if (inflight) return inflight
  set({ loading: true, error: null })
  inflight = (async () => {
    const key = readClientKey()
    if (!key) {
      // Nothing to fetch without a key — stay quiet, no Radar section.
      set({ loading: false, data: [], error: null })
      return
    }
    try {
      const res = await fetch('/api/watchlist', {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${key}` },
      })
      if (res.status === 401) {
        window.localStorage.removeItem('cc_key')
        set({ loading: false, data: [], error: 'Watchlist locked — key rejected.' })
        return
      }
      if (!res.ok) {
        set({ loading: false, data: [], error: 'Could not load watchlist.' })
        return
      }
      const body = await res.json()
      const rows: WatchlistEntry[] = Array.isArray(body) ? body : (body?.data ?? [])
      set({ loading: false, data: rows, error: null })
    } catch {
      set({ loading: false, data: [], error: 'Could not load watchlist.' })
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/** Load (once) on first subscription; keep the already-loaded copy otherwise. */
function loadIfNeeded() {
  if (inflight) return
  if (state.data !== null) return
  void doLoad()
}

/**
 * Invalidates the cached copy and refetches. Call after a track write so the
 * Radar reflects the change without a full page reload.
 */
export function refreshWatchlist() {
  state = { ...state, data: null }
  void doLoad()
}

/**
 * Server snapshot — a STABLE reference, never a fresh object.
 *
 * useSyncExternalStore requires a third argument whenever the component can be
 * server-rendered; without it React throws "Missing getServerSnapshot". The
 * watchlist is deliberately unavailable during SSR (that is the whole point of
 * HOLE 1's fix — it must not travel in the public payload), so the server
 * snapshot is the empty, still-loading state and the real data arrives on the
 * client after hydration. It must be a module-level constant: returning a new
 * object each call makes React loop with "getServerSnapshot should be cached".
 */
const SERVER_SNAPSHOT: WatchlistState = { data: null, loading: true, error: null }
function getServerSnapshot(): WatchlistState {
  return SERVER_SNAPSHOT
}

/** Reactive hook — subscribe to the shared store, loading on first mount. */
export function useWatchlist(): WatchlistState {
  loadIfNeeded()
  return useSyncExternalStore(subscribe, () => state, getServerSnapshot)
}
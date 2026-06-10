/**
 * Stateless rotating window for cron routes that walk per-company external
 * APIs (SEC submissions, Yahoo, etc.).
 *
 * Why: Phase 7B grew the CIKed-company set from ~32 to ~363. The SEC-walking
 * crons pace themselves at ~3 req/sec to respect rate limits, so a full walk
 * takes ~2 minutes — double the Vercel Hobby 60s cap. Rather than tracking
 * per-row "last processed" state (schema change + write amplification), we
 * slice a deterministic window whose offset advances by `size` each UTC day:
 *
 *   day N   → items[(N*size) % total .. +size)   (wrapping)
 *   day N+1 → next contiguous slice, etc.
 *
 * Because the offset advances by exactly `size`, any ceil(total/size)
 * consecutive days cover every item at least once (currently 4 days at
 * 363 CIKs / 120 per run). Re-running within the same UTC day re-processes
 * the same window — idempotent routes make that a no-op.
 *
 * Items are sorted by `id` before slicing so the window is stable regardless
 * of DB return order.
 */

export function rotatingWindow<T extends { id: string }>(
  items: T[],
  size: number,
  now: Date = new Date(),
): T[] {
  if (items.length <= size) return items
  const sorted = [...items].sort((a, b) => a.id.localeCompare(b.id))
  // Days since epoch — advances once per UTC midnight.
  const day = Math.floor(now.getTime() / 86_400_000)
  const start = (day * size) % sorted.length
  const out = sorted.slice(start, start + size)
  if (out.length < size) out.push(...sorted.slice(0, size - out.length))
  return out
}

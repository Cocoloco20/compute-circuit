/**
 * Minimal RSS 2.0 helpers. Pure string functions — no XML library needed
 * for a feed this small (one channel, a handful of items).
 */

/** Escape the five XML entities. Provider/customer names routinely carry
 *  `&` ("AT&T", "Bain Capital & Co") — unescaped, that breaks the feed. */
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** RFC 822 date (what RSS `<pubDate>` wants) from a `YYYY-MM-DD` filing
 *  date. Filing dates carry no time of day, so midnight UTC is used. */
export function toRfc822(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00Z`).toUTCString()
}

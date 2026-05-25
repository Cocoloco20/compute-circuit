/**
 * Resolves a company → logo image URL.
 *
 * Returns a URL string the browser can load (same-origin via our
 * /api/logo/[domain] proxy, OR an explicit override URL stored on the
 * companies row), OR null when no usable image exists — in which case the
 * drawer/graph render a monogram badge.
 *
 * Resolution order (matches the schema in migration 0040):
 *   1. company.logo_url  — manual override for cos where the domain-based
 *                          favicon is poor quality. Wins unconditionally
 *                          when set, even if domain is also set.
 *   2. /api/logo/{domain} — domain-based proxy → gstatic faviconV2 (or
 *                          logo.dev if LOGO_DEV_TOKEN is configured).
 *   3. null               — neither override nor domain. Caller renders a
 *                          monogram fallback (first 2 chars of name on a
 *                          color seeded from company.id).
 *
 * Why a proxy and not a direct gstatic URL: gstatic doesn't send
 * Access-Control-Allow-Origin, so cross-origin <img crossOrigin="anonymous">
 * fails preflight, and Three.js needs CORS-clean pixels to upload as a
 * WebGL texture. The proxy serves the bytes from our own origin.
 *
 * Backwards compatible: callers that pass just a domain string still work.
 * New callers should pass the whole company-shaped object so the override
 * is respected.
 */

interface CompanyLike {
  domain: string | null
  logo_url?: string | null
  logo_status?: string | null
}

export function getLogoUrl(input: string | CompanyLike | null | undefined): string | null {
  if (!input) return null
  if (typeof input === 'string') {
    return `/api/logo/${encodeURIComponent(input)}`
  }
  // Object form: prefer the explicit override, fall back to the domain proxy.
  if (input.logo_url) return input.logo_url
  if (input.domain) return `/api/logo/${encodeURIComponent(input.domain)}`
  return null
}

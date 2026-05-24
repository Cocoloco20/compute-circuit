/**
 * Resolves a domain → company-logo image URL.
 *
 * Returns a same-origin URL that hits our /api/logo/[domain] proxy. The proxy
 * forwards to gstatic faviconV2 (or logo.dev if LOGO_DEV_TOKEN is set on the
 * server) and serves the bytes with permissive CORS so Three.js can composite
 * them onto our ring badges without tainting the canvas.
 *
 * Why a proxy: gstatic doesn't send Access-Control-Allow-Origin, so a
 * cross-origin image with `crossOrigin='anonymous'` fails preflight, and
 * Three.js requires CORS-clean pixels to upload as a WebGL texture.
 */
export function getLogoUrl(domain: string | null | undefined): string | null {
  if (!domain) return null
  return `/api/logo/${encodeURIComponent(domain)}`
}

/**
 * Resolves a domain → company-logo image URL.
 *
 * Clearbit's free logo API (logo.clearbit.com) was discontinued in late 2024
 * after the HubSpot acquisition, which broke our original setup. Two paths now:
 *
 *   1) If you set NEXT_PUBLIC_LOGO_DEV_TOKEN (free signup at logo.dev, 5k/mo),
 *      we use that — best quality, designed for this use case.
 *   2) Otherwise we fall back to Google's faviconV2 endpoint, which is free
 *      and CORS-friendly but quality varies by site (SVG favicons = great,
 *      32×32 .ico = blocky). Good enough for an at-a-glance graph.
 *
 * Both sources return CORS-friendly bytes, so Three.js TextureLoader / canvas
 * drawImage work without `crossOrigin` gotchas.
 */
export function getLogoUrl(domain: string | null | undefined, size = 128): string | null {
  if (!domain) return null
  const token = process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN
  if (token) {
    return `https://img.logo.dev/${domain}?token=${token}&size=${size}&format=png`
  }
  return `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://${domain}&size=${size}`
}

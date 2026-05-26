import { NextRequest, NextResponse } from 'next/server'

/**
 * Same-origin logo proxy with a multi-provider fallback chain.
 *
 * Why this exists: the upstream logo sources don't send
 * Access-Control-Allow-Origin headers. Browsers will load the image without
 * `crossOrigin='anonymous'`, but Three.js uses canvas → CanvasTexture to
 * composite the logo onto our ring badge, and a tainted canvas blocks WebGL
 * texture upload. Routing through this route makes them same-origin.
 *
 * The previous single-provider implementation (logo.dev or Google favicon)
 * silently failed for niche cos like Powertech (pti.com.tw) or Solbrain
 * (solbrain.co.kr) that don't appear in any favicon CDN. This refactor walks
 * a chain of providers and returns the bytes from the first one with a real
 * (non-placeholder) image.
 *
 * Provider order (first real image wins):
 *   1. Brandfetch         — best quality, needs BRANDFETCH_CLIENT_ID
 *   2. Logo.dev           — good niche coverage, needs LOGO_DEV_TOKEN
 *   3. Clearbit Logo API  — deprecated but free, resolves many cos
 *   4. Google faviconV2   — universal but low-res
 *   5. DuckDuckGo icons   — final favicon mirror
 *   6. Homepage scrape    — fetch co's own site, parse <link rel="icon">,
 *                           fall back to /favicon.ico. Universal for the
 *                           niche Asian/EU industrials none of the CDNs know.
 *
 * Real-image classification (validateImageResponse):
 *   - HTTP status must be 200
 *   - Content-Type must start with image/
 *   - Body must be at least MIN_BYTES
 *   - First few bytes must match a real image magic header (PNG, JPG, ICO,
 *     GIF, BMP, RIFF/WebP, SVG). Rejects HTML 404 pages mislabeled image/*.
 *
 * Caching:
 *   - In-memory Map keyed by domain, valid for CACHE_TTL_MS. Reused across
 *     warm lambda invocations.
 *   - HTTP Cache-Control: public, max-age=86400, stale-while-revalidate.
 *     Vercel's CDN serves the cached image for repeat visitors.
 *
 * Runtime: node (not edge). Node keeps the module-scoped cache across warm
 * invocations and lets us use longer per-provider timeouts.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 86400

/**
 * Minimum byte size to be considered a real logo (vs placeholder sentinel).
 * Lower than the seed-logos.js threshold (100B) so legit niche-co favicons
 * survive — Powertech and Naura ship 200-400B single-color glyph favicons,
 * which ARE real. The magic-byte check rejects HTML pages or text sentinels
 * that slip through the content-type filter.
 */
const MIN_BYTES = 150
/** In-memory cache TTL — 1h matches the in-flight lambda lifetime well. */
const CACHE_TTL_MS = 60 * 60 * 1000
/** Per-provider timeout. Total worst case = NUM_PROVIDERS * PROVIDER_TIMEOUT_MS. */
const PROVIDER_TIMEOUT_MS = 5000

type CacheEntry = {
  bytes: ArrayBuffer
  contentType: string
  fetchedAt: number
  source: string
}

// Module-scoped cache. Survives warm lambda invocations.
const logoCache = new Map<string, CacheEntry>()

interface ProviderResult {
  bytes: ArrayBuffer
  contentType: string
  source: string
}

/** Fetch with an AbortController-based timeout. */
async function fetchWithTimeout(
  url: string,
  ms: number,
  accept = 'image/*',
): Promise<Response | null> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      // Disable Next's fetch cache — we manage our own in-memory cache.
      cache: 'no-store',
      headers: {
        // Some corporate sites + Brandfetch block default fetch UAs.
        'User-Agent':
          'Mozilla/5.0 (compatible; compute-circuit-logo/1.0; +https://compute-circuit.vercel.app)',
        Accept: accept,
      },
    })
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

/**
 * Inspect the first bytes of a buffer and return true if it looks like a
 * known image format. Rejects HTML / text data masquerading as image/*.
 */
function hasImageMagic(bytes: ArrayBuffer): boolean {
  if (bytes.byteLength < 4) return false
  const u = new Uint8Array(bytes)
  // PNG: 89 50 4E 47
  if (u[0] === 0x89 && u[1] === 0x50 && u[2] === 0x4e && u[3] === 0x47) return true
  // JPG: FF D8 FF
  if (u[0] === 0xff && u[1] === 0xd8 && u[2] === 0xff) return true
  // GIF: 47 49 46 38
  if (u[0] === 0x47 && u[1] === 0x49 && u[2] === 0x46 && u[3] === 0x38) return true
  // ICO: 00 00 01 00
  if (u[0] === 0x00 && u[1] === 0x00 && u[2] === 0x01 && u[3] === 0x00) return true
  // BMP: 42 4D
  if (u[0] === 0x42 && u[1] === 0x4d) return true
  // RIFF (WebP container): 'RIFF'
  if (u[0] === 0x52 && u[1] === 0x49 && u[2] === 0x46 && u[3] === 0x46) return true
  // SVG: leading '<svg' or '<?xml'
  const head = Buffer.from(u.slice(0, 100)).toString('utf8').trimStart().toLowerCase()
  if (head.startsWith('<svg') || head.startsWith('<?xml')) return true
  return false
}

/** Validate a fetched response is a real image. */
async function validateImageResponse(
  r: Response | null,
  source: string,
): Promise<ProviderResult | null> {
  if (!r || !r.ok) return null
  const ct = r.headers.get('content-type') || ''
  if (!ct.toLowerCase().startsWith('image/')) return null
  // Content-Length is a fast pre-filter for tiny placeholders.
  const lenHeader = r.headers.get('content-length')
  if (lenHeader) {
    const len = parseInt(lenHeader, 10)
    if (Number.isFinite(len) && len > 0 && len < MIN_BYTES) return null
  }
  let bytes: ArrayBuffer
  try {
    bytes = await r.arrayBuffer()
  } catch {
    return null
  }
  if (bytes.byteLength < MIN_BYTES) return null
  if (!hasImageMagic(bytes)) return null
  return { bytes, contentType: ct, source }
}

/** Brandfetch — best logo quality, requires a free client ID. */
async function tryBrandfetch(domain: string): Promise<ProviderResult | null> {
  const clientId = process.env.BRANDFETCH_CLIENT_ID
  if (!clientId) return null
  const url = `https://cdn.brandfetch.io/${encodeURIComponent(domain)}/w/512/h/512?c=${encodeURIComponent(clientId)}`
  return validateImageResponse(await fetchWithTimeout(url, PROVIDER_TIMEOUT_MS), 'brandfetch')
}

/** Logo.dev — solid niche coverage, requires a free token. */
async function tryLogoDev(domain: string): Promise<ProviderResult | null> {
  const token = process.env.LOGO_DEV_TOKEN
  if (!token) return null
  const url = `https://img.logo.dev/${encodeURIComponent(domain)}?token=${encodeURIComponent(token)}&size=256&format=png`
  return validateImageResponse(await fetchWithTimeout(url, PROVIDER_TIMEOUT_MS), 'logo.dev')
}

/** Clearbit Logo API — officially deprecated but still serves many cos. */
async function tryClearbit(domain: string): Promise<ProviderResult | null> {
  const url = `https://logo.clearbit.com/${encodeURIComponent(domain)}?size=256`
  return validateImageResponse(await fetchWithTimeout(url, PROVIDER_TIMEOUT_MS), 'clearbit')
}

/** Google faviconV2 — universal coverage but only 128px favicon-tier images. */
async function tryGoogleFavicon(domain: string): Promise<ProviderResult | null> {
  const url = `https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${encodeURIComponent(domain)}&size=128`
  return validateImageResponse(await fetchWithTimeout(url, PROVIDER_TIMEOUT_MS), 'google-faviconV2')
}

/** DuckDuckGo's icon service — last-resort favicon mirror. */
async function tryDuckDuckGoIcon(domain: string): Promise<ProviderResult | null> {
  const url = `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`
  return validateImageResponse(await fetchWithTimeout(url, PROVIDER_TIMEOUT_MS), 'duckduckgo')
}

/**
 * Homepage-scrape — fetch the company's own website and parse the first
 * <link rel="icon|apple-touch-icon|shortcut icon"> or fall back to
 * /favicon.ico. This is the universal fallback that catches niche
 * Asian/EU industrial cos where the favicon CDNs have nothing — those cos
 * host their own favicon and link to it in the HTML head.
 *
 * Tries https://www.{domain} first, then https://{domain} (some cos don't
 * have a www. CNAME). 2 HTTP calls in the happy path.
 */
async function tryHomepageScrape(domain: string): Promise<ProviderResult | null> {
  for (const scheme of ['https://www.', 'https://']) {
    const homepageUrl = `${scheme}${domain}`
    const htmlRes = await fetchWithTimeout(homepageUrl, PROVIDER_TIMEOUT_MS, 'text/html,*/*')
    if (!htmlRes || !htmlRes.ok) continue
    let html = ''
    try {
      html = await htmlRes.text()
    } catch {
      continue
    }
    // Limit work — favicon links are in <head>. Cap at 32KB if no </head>.
    const headEnd = html.indexOf('</head>')
    const head = headEnd > 0 ? html.slice(0, headEnd + 7) : html.slice(0, 32_000)
    const linkRe = /<link\b[^>]*>/gi
    const links: string[] = []
    let m: RegExpExecArray | null
    while ((m = linkRe.exec(head))) links.push(m[0])
    const ordered: Array<{ priority: number; href: string }> = []
    for (const link of links) {
      if (!/rel\s*=\s*["'][^"']*(apple-touch-icon|shortcut\s+icon|\bicon\b|mask-icon)[^"']*["']/i.test(link)) continue
      const hrefMatch = link.match(/href\s*=\s*["']([^"']+)["']/i)
      if (!hrefMatch) continue
      const href = hrefMatch[1].trim()
      let priority = 0
      if (/apple-touch-icon/i.test(link)) priority += 4
      if (/sizes\s*=\s*["'](?:1[0-9]{2}|2[0-9]{2})x/i.test(link)) priority += 3
      if (/type\s*=\s*["']image\/png/i.test(link)) priority += 1
      if (/mask-icon/i.test(link)) priority -= 2
      ordered.push({ priority, href })
    }
    ordered.sort((a, b) => b.priority - a.priority)
    const candidates = ordered.map(o => o.href)
    // Always try /favicon.ico last even if not declared.
    candidates.push('/favicon.ico')
    for (const href of candidates) {
      const abs = absolutize(href, homepageUrl)
      if (!abs) continue
      const iconRes = await fetchWithTimeout(abs, PROVIDER_TIMEOUT_MS)
      const result = await validateImageResponse(iconRes, 'homepage-scrape')
      if (result) return result
    }
  }
  return null
}

/** Convert a possibly-relative href into an absolute URL. */
function absolutize(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString()
  } catch {
    return null
  }
}

/**
 * Provider chain in priority order. We return the first successful one —
 * providers later in the list never run for that domain.
 */
async function resolveLogoBytes(domain: string): Promise<ProviderResult | null> {
  const providers = [
    tryBrandfetch,
    tryLogoDev,
    tryClearbit,
    tryGoogleFavicon,
    tryDuckDuckGoIcon,
    // Homepage scrape last — most reliable for niche cos but slowest.
    tryHomepageScrape,
  ]
  for (const p of providers) {
    try {
      const out = await p(domain)
      if (out) return out
    } catch {
      // Provider threw — try the next.
    }
  }
  return null
}

export async function GET(_req: NextRequest, { params }: { params: { domain: string } }) {
  const domain = (params.domain || '').toLowerCase()
  if (!domain || !/^[a-z0-9.\-]+$/.test(domain)) {
    return new NextResponse('invalid domain', { status: 400 })
  }

  // Cache hit: serve directly. Saves the 6-provider walk on every node hover.
  const cached = logoCache.get(domain)
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return new NextResponse(cached.bytes, {
      status: 200,
      headers: {
        'Content-Type': cached.contentType,
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
        'Access-Control-Allow-Origin': '*',
        'X-Logo-Source': cached.source,
        'X-Logo-Cache': 'HIT',
      },
    })
  }

  const result = await resolveLogoBytes(domain)
  if (!result) {
    return new NextResponse('no logo found across providers', {
      status: 404,
      headers: {
        // Cache the miss for a shorter window so a freshly-added env var
        // (e.g. BRANDFETCH_CLIENT_ID) is picked up within an hour.
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
      },
    })
  }

  // Populate cache for subsequent hits on this lambda.
  logoCache.set(domain, {
    bytes: result.bytes,
    contentType: result.contentType,
    fetchedAt: Date.now(),
    source: result.source,
  })

  return new NextResponse(result.bytes, {
    status: 200,
    headers: {
      'Content-Type': result.contentType,
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      'Access-Control-Allow-Origin': '*',
      'X-Logo-Source': result.source,
      'X-Logo-Cache': 'MISS',
    },
  })
}

/**
 * HEAD support — the cron/seed-logos verifier prefers HEAD to save bytes.
 * Next derives HEAD from GET by default, but that derived version still
 * streams the body. Explicit HEAD short-circuits.
 */
export async function HEAD(req: NextRequest, ctx: { params: { domain: string } }) {
  const res = await GET(req, ctx)
  return new NextResponse(null, {
    status: res.status,
    headers: res.headers,
  })
}

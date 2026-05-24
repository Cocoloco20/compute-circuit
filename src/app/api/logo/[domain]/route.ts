import { NextRequest, NextResponse } from 'next/server'

/**
 * Same-origin logo proxy.
 *
 * Why this exists: the upstream logo sources (Google's faviconV2 endpoint,
 * Clearbit before it died) don't send Access-Control-Allow-Origin headers.
 * Browsers will load the image without `crossOrigin='anonymous'`, but Three.js
 * uses canvas → CanvasTexture to composite the logo onto our ring badge, and
 * a tainted canvas blocks WebGL texture upload.
 *
 * Routing all logo loads through this route makes them same-origin from the
 * browser's perspective — no CORS preflight, canvas stays clean.
 *
 * Caching: we tell both Next's fetch cache and the browser to keep the bytes
 * for a day. Favicons rarely change and the cost of a miss is one round-trip
 * to gstatic.
 */

export const runtime = 'edge' // faster cold start than node runtime
export const revalidate = 86400 // 1 day

export async function GET(_req: NextRequest, { params }: { params: { domain: string } }) {
  const domain = params.domain
  if (!domain || !/^[a-zA-Z0-9.\-]+$/.test(domain)) {
    return new NextResponse('invalid domain', { status: 400 })
  }

  const upstream = process.env.LOGO_DEV_TOKEN
    ? `https://img.logo.dev/${domain}?token=${process.env.LOGO_DEV_TOKEN}&size=128&format=png`
    : `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://${domain}&size=128`

  try {
    const r = await fetch(upstream, {
      // Edge runtime supports next.revalidate for ISR-style caching
      next: { revalidate: 86400 },
    })
    if (!r.ok) {
      return new NextResponse('not found', { status: 404 })
    }
    const buf = await r.arrayBuffer()
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': r.headers.get('Content-Type') ?? 'image/png',
        'Cache-Control': 'public, max-age=86400, s-maxage=86400, immutable',
        // Belt-and-suspenders CORS — same-origin doesn't strictly need it but
        // makes the response usable from other origins if you ever embed.
        'Access-Control-Allow-Origin': '*',
      },
    })
  } catch (err) {
    return new NextResponse('upstream fetch failed: ' + (err instanceof Error ? err.message : 'unknown'), { status: 502 })
  }
}

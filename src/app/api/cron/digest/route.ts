import { NextRequest, NextResponse } from 'next/server'
import { fetchGraph } from '@/lib/graph-data'
import { buildDigest, renderEmailHtml } from '@/lib/digest'
import { sendEmail } from '@/lib/email'

/**
 * /api/cron/digest — Daily 8 AM ET email digest.
 *
 * Scheduled at "0 12 * * *" (12:00 UTC = 8:00 AM ET) via vercel.json.
 * Also callable manually:
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *        https://compute-circuit.vercel.app/api/cron/digest
 *
 * Required env vars:
 *   CRON_SECRET         — shared secret for bearer auth
 *   RESEND_API_KEY      — Resend API key (skip send if missing)
 *   DIGEST_EMAIL        — recipient email address
 *   WATCHLIST_CO_IDS    — comma-separated company IDs (e.g. "abc123,def456")
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // ── Config ────────────────────────────────────────────────────────────────
  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) {
    // Non-fatal: just log and return — lets the daily dispatcher skip gracefully
    console.warn('[digest] RESEND_API_KEY not set — skipping email send')
    return NextResponse.json({ ok: true, skipped: true, reason: 'RESEND_API_KEY missing' })
  }

  const digestEmail = process.env.DIGEST_EMAIL
  if (!digestEmail) {
    return NextResponse.json({ error: 'DIGEST_EMAIL not configured' }, { status: 500 })
  }

  const watchlistRaw = process.env.WATCHLIST_CO_IDS ?? ''
  const watchedCoIds = watchlistRaw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)

  if (watchedCoIds.length === 0) {
    return NextResponse.json({ error: 'WATCHLIST_CO_IDS is empty or not configured' }, { status: 500 })
  }

  // ── Fetch + Build ─────────────────────────────────────────────────────────
  let data
  try {
    data = await fetchGraph()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[digest] fetchGraph failed:', msg)
    return NextResponse.json({ error: `fetchGraph failed: ${msg}` }, { status: 500 })
  }

  const digest = buildDigest(data, watchedCoIds)
  const html   = renderEmailHtml(digest)

  const dateStr = new Date(digest.generatedAt).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    timeZone: 'America/New_York',
  })
  const subject = `Compute Circuit Digest · ${dateStr}`

  // ── Send ──────────────────────────────────────────────────────────────────
  const { id, error } = await sendEmail({ to: digestEmail, subject, html })

  if (error) {
    console.error('[digest] sendEmail failed:', error)
    return NextResponse.json({ error }, { status: 502 })
  }

  console.log(`[digest] sent to ${digestEmail}, id=${id}`)
  return NextResponse.json({
    ok: true,
    emailId: id,
    recipient: digestEmail,
    watchedCos: watchedCoIds.length,
    anySignals: digest.anySignals,
    generatedAt: digest.generatedAt,
  })
}

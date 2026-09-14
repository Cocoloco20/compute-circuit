/**
 * src/lib/email.ts
 *
 * Thin Resend API wrapper. No SDK dependency — just fetch so we stay
 * edge-compatible and avoid adding a package to the bundle.
 *
 * Usage:
 *   const { id, error } = await sendEmail({
 *     to: 'me@example.com',
 *     subject: 'Offtake Digest',
 *     html: '<h1>Hello</h1>',
 *   })
 */

export interface SendEmailOptions {
  to: string
  subject: string
  html: string
  from?: string  // defaults to onboarding@resend.dev until domain is verified
}

export interface SendEmailResult {
  id?: string
  error?: string
}

export async function sendEmail({
  to,
  subject,
  html,
  from = 'Offtake <onboarding@resend.dev>',
}: SendEmailOptions): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    return { error: 'RESEND_API_KEY is not configured' }
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to, subject, html }),
    })

    const data = await res.json().catch(() => ({}))

    if (!res.ok) {
      const msg = (data as { message?: string }).message ?? `HTTP ${res.status}`
      return { error: `Resend API error: ${msg}` }
    }

    return { id: (data as { id?: string }).id }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

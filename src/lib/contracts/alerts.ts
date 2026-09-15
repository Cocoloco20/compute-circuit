/**
 * Webhook alert for newly-written ledger rows.
 *
 * The nightly cron (src/app/api/cron/contracts/route.ts) calls this once
 * per run with whatever it wrote. Fires a plain JSON POST carrying both
 * `text` (Slack incoming-webhook shape) and `content` (Discord webhook
 * shape) so one CONTRACT_WEBHOOK_URL works for either without the caller
 * picking a platform. No-ops silently when CONTRACT_WEBHOOK_URL is unset
 * or there is nothing new to report — most nights are both.
 */

import type { DisclosureRow } from './ledger'
import { usd } from '@/lib/format'
import { upstreamSignal } from '@/lib/cron-budget'

const MAX_LINES = 10

function formatRow(r: DisclosureRow): string {
  const counterparty = r.customer_disclosed ? (r.customer_name ?? '—') : 'undisclosed'
  const amount = r.total_value_usd ? usd(r.total_value_usd) : (r.capacity_mw ? `${r.capacity_mw}MW` : null)
  const tail = amount ? ` — ${amount}` : ''
  return `• ${r.provider_name} → ${counterparty} (${r.kind})${tail}`
}

/** Pure and testable: the message body, independent of whether it gets sent. */
export function formatAlertMessage(rows: DisclosureRow[]): string {
  const lines = rows.slice(0, MAX_LINES).map(formatRow)
  const overflow = rows.length - lines.length
  const header = `${rows.length} new contract disclosure${rows.length === 1 ? '' : 's'} in the Offtake ledger:`
  const body = [header, ...lines, overflow > 0 ? `…and ${overflow} more` : null]
    .filter((l): l is string => l != null)
    .join('\n')
  return body
}

/** Fire-and-forget: never throws, never blocks the cron's own response. */
export async function postContractAlert(rows: DisclosureRow[]): Promise<void> {
  const url = process.env.CONTRACT_WEBHOOK_URL
  if (!url || rows.length === 0) return
  const text = formatAlertMessage(rows)
  try {
    await fetch(url, {
      method: 'POST',
      signal: upstreamSignal(5_000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, content: text }),
    })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[contracts/alerts] webhook post failed:', err instanceof Error ? err.message : String(err))
  }
}

import { NextResponse } from 'next/server'
import { fetchAllLedgerRows, lastNDaysRows, KIND_LABEL, type LedgerRow } from '@/lib/contract-ledger-data'
import { escapeXml, toRfc822 } from '@/lib/rss'

/** RSS 2.0 feed of the last 7 days of contract disclosures — the same
 *  window as /wire, as XML for a feed reader. */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const WINDOW_DAYS = 7
const SITE_URL = 'https://offtake-ledger.vercel.app'
const FALLBACK_LINK = `${SITE_URL}/contracts`

function itemXml(r: LedgerRow): string {
  const customer = r.customer_disclosed ? (r.customer_name ?? 'undisclosed') : 'undisclosed'
  const title = `${r.provider_name} → ${customer}, ${KIND_LABEL[r.kind] ?? r.kind}`
  const link = r.source_url ?? FALLBACK_LINK
  return [
    '<item>',
    `<title>${escapeXml(title)}</title>`,
    `<description>${escapeXml(r.excerpt ?? '')}</description>`,
    `<link>${escapeXml(link)}</link>`,
    `<guid isPermaLink="false">${escapeXml(r.id)}</guid>`,
    `<pubDate>${toRfc822(r.filing_date)}</pubDate>`,
    '</item>',
  ].join('')
}

export async function GET() {
  const { rows: all } = await fetchAllLedgerRows()
  const rows = lastNDaysRows(all, WINDOW_DAYS)

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<title>Offtake — Contract Wire</title>
<link>${SITE_URL}/wire</link>
<description>The last 7 days of disclosed AI compute, colocation, hosting and power contracts, read from SEC filings.</description>
${rows.map(itemXml).join('\n')}
</channel>
</rss>
`

  return new NextResponse(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  })
}

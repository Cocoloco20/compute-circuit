/**
 * One-shot: normalize companies.country to ISO-2 codes.
 *
 * The Phase 7B imports (Forbes Global 2000 / FT 500 EU) wrote full country
 * names ("United States", "South Korea") while the original seed used ISO-2
 * ("US", "KR"). Mixed forms break everything keyed on the column:
 *   - countryToFlag() requires exactly 2 letters → 1,800+ cos render NO flag
 *   - world-map grouping and Context-tab same-country matching split each
 *     country into two buckets
 *
 * ISO-2 is canonical (it's what the UI consumes). Unmapped values are
 * printed and left untouched rather than guessed.
 *
 * Run: npx tsx scripts/normalize-countries.ts
 */
import { createClient } from '@supabase/supabase-js'
import * as path from 'path'
import { config } from 'dotenv'

config({ path: path.join(__dirname, '..', '.env.local') })
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const NAME_TO_ISO: Record<string, string> = {
  'United States': 'US', 'China': 'CN', 'Japan': 'JP', 'India': 'IN',
  'United Kingdom': 'GB', 'South Korea': 'KR', 'Canada': 'CA', 'Germany': 'DE',
  'France': 'FR', 'Switzerland': 'CH', 'Hong Kong': 'HK', 'Taiwan': 'TW',
  'Australia': 'AU', 'Italy': 'IT', 'Brazil': 'BR', 'Sweden': 'SE',
  'Netherlands': 'NL', 'Ireland': 'IE', 'Spain': 'ES', 'Saudi Arabia': 'SA',
  'Thailand': 'TH', 'Mexico': 'MX', 'Denmark': 'DK', 'United Arab Emirates': 'AE',
  'Israel': 'IL', 'South Africa': 'ZA', 'Singapore': 'SG', 'Turkey': 'TR',
  'Austria': 'AT', 'Belgium': 'BE', 'Bermuda': 'BM', 'Cayman Islands': 'KY',
  'Chile': 'CL', 'Colombia': 'CO', 'Croatia': 'HR', 'Cyprus': 'CY',
  'Czech Republic': 'CZ', 'Egypt': 'EG', 'Finland': 'FI', 'Greece': 'GR',
  'Hungary': 'HU', 'Indonesia': 'ID', 'Jordan': 'JO', 'Kazakhstan': 'KZ',
  'Kuwait': 'KW', 'Luxembourg': 'LU', 'Malaysia': 'MY', 'Morocco': 'MA',
  'Nigeria': 'NG', 'Norway': 'NO', 'Oman': 'OM', 'Peru': 'PE',
  'Philippines': 'PH', 'Poland': 'PL', 'Portugal': 'PT', 'Qatar': 'QA',
  'Romania': 'RO', 'Slovenia': 'SI', 'Vietnam': 'VN', 'Argentina': 'AR',
}

async function main() {
  const rows: Array<{ id: string; country: string }> = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('companies').select('id, country').range(from, from + 999).order('id')
    if (error) throw error
    for (const r of (data ?? []) as Array<{ id: string; country: string | null }>) {
      if (r.country && r.country.length !== 2) rows.push({ id: r.id, country: r.country })
    }
    if (!data || data.length < 1000) break
  }
  console.log(`${rows.length} rows with non-ISO country values`)

  const unmapped = new Map<string, number>()
  let updated = 0
  const CONC = 10
  for (let i = 0; i < rows.length; i += CONC) {
    await Promise.all(rows.slice(i, i + CONC).map(async (r) => {
      const iso = NAME_TO_ISO[r.country]
      if (!iso) { unmapped.set(r.country, (unmapped.get(r.country) ?? 0) + 1); return }
      const { error } = await sb.from('companies').update({ country: iso }).eq('id', r.id)
      if (!error) updated++
      else console.warn(`  ✗ ${r.id}: ${error.message}`)
    }))
  }
  console.log(`✓ normalized ${updated} rows to ISO-2`)
  if (unmapped.size) {
    console.log('UNMAPPED (left untouched):')
    for (const [k, v] of unmapped) console.log(` ${v} | ${k}`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })

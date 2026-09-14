/**
 * The contract ledger's universe: who we read filings FROM, and how a
 * counterparty NAME in a filing maps back to a company row.
 *
 * Providers are the filers whose 8-Ks/6-Ks disclose capacity, hosting,
 * lease, power and equipment contracts: neoclouds, powered-shell hosts,
 * ex-miners pivoting to HPC, and the hyperscalers/vendors on the other side
 * of those deals (whose own filings occasionally disclose the same contract
 * from the buyer's side — the ledger keeps both, keyed per filing).
 *
 * Ids are companies.id. Every provider must have a CIK on its row; the
 * backfill and the cron read that from the table, not from here.
 */

/** Filers we scan, in priority order (most contract-dense first). */
export const PROVIDER_IDS: readonly string[] = [
  // Neoclouds / GPU cloud
  'crwv', 'nbis', 'iren', 'wyfi',
  // Powered shell / HPC hosting (mostly ex-bitcoin miners)
  'cifr', 'wulf', 'apld', 'corz', 'hut', 'glxy', 'btbt', 'riot', 'mara',
  'clsk', 'bitf', 'slnh', 'btdr', 'hive',
  // Data-center REITs
  'dlr', 'eqix',
  // The other side of the table: buyers and vendors whose filings name
  // the same deals (Oracle/OpenAI, Nvidia backstops, Broadcom, Dell, SMCI)
  'orcl', 'nvda', 'amd', 'avgo', 'dell', 'smci', 'vrt', 'gev',
  'msft', 'googl', 'amzn', 'meta-ai',
]

/**
 * Name → company id. Lower-cased substring match against the name a filing
 * uses. Order matters: longer, more specific keys are listed first so
 * "Core Scientific" resolves before "Core" could match anything, and
 * "Google Cloud" before "Google". Unmatched names are stored as text with
 * a null id — never guessed.
 */
export const COUNTERPARTY_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ['core scientific', 'corz'],
  ['coreweave', 'crwv'],
  ['nebius', 'nbis'],
  ['iren', 'iren'],
  ['whitefiber', 'wyfi'],
  ['cipher mining', 'cifr'], ['cipher digital', 'cifr'],
  ['terawulf', 'wulf'],
  ['applied digital', 'apld'],
  ['hut 8', 'hut'],
  ['galaxy digital', 'glxy'], ['galaxy', 'glxy'],
  ['bit digital', 'btbt'],
  ['riot platforms', 'riot'],
  ['mara holdings', 'mara'], ['marathon digital', 'mara'],
  ['cleanspark', 'clsk'],
  ['bitfarms', 'bitf'],
  ['soluna', 'slnh'],
  ['bitdeer', 'btdr'],
  ['hive digital', 'hive'],
  ['digital realty', 'dlr'],
  ['equinix', 'eqix'],
  ['fluidstack', 'fluidstack'],
  ['nscale', 'nscale'],
  ['crusoe', 'crusoe'],
  ['lambda', 'lambda'],
  ['together ai', 'together'],
  ['microsoft', 'msft'], ['azure', 'msft'],
  ['google cloud', 'googl'], ['alphabet', 'googl'], ['google', 'googl'],
  ['amazon web services', 'amzn'], ['aws', 'amzn'], ['amazon', 'amzn'],
  ['meta platforms', 'meta-ai'], ['meta', 'meta-ai'],
  ['openai', 'openai'],
  ['anthropic', 'anthropic'],
  ['xai', 'xai'],
  ['oracle', 'orcl'],
  ['nvidia', 'nvda'],
  ['advanced micro devices', 'amd'], ['amd', 'amd'],
  ['broadcom', 'avgo'],
  ['dell', 'dell'],
  ['super micro', 'smci'], ['supermicro', 'smci'],
  ['vertiv', 'vrt'],
  ['ge vernova', 'gev'],
  ['softbank', 'softbank'],
]

/**
 * Resolve a disclosed party name to a company id, or null. Substring match
 * on word boundaries so "Meta" does not match "metal" and "AWS" does not
 * match "laws".
 */
export function resolvePartyId(name: string | null | undefined): string | null {
  if (!name) return null
  const n = name.toLowerCase()
  for (const [alias, id] of COUNTERPARTY_ALIASES) {
    const re = new RegExp(`(^|[^a-z0-9])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i')
    if (re.test(n)) return id
  }
  return null
}

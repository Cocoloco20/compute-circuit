/**
 * Per-investor search-term config for the Form-D scraper.
 *
 * The term is what EDGAR full-text search looks for. We want it specific
 * enough that we mostly hit the real firm's filings, not similarly-named
 * entities. Quotes around it (added by the scraper) force phrase match.
 *
 * Investors not listed here are simply skipped — easy to add more by
 * dropping a row in. Set `term: null` to explicitly disable.
 */

export interface ScraperConfig {
  id: string             // investors.id
  term: string | null    // EDGAR FTS phrase
  notes?: string
}

export const SCRAPER_CONFIGS: ScraperConfig[] = [
  { id: 'sequoia',       term: 'Sequoia Capital',         notes: 'Beware Sequoia Capital China/India sub-funds in hits.' },
  { id: 'a16z',          term: 'Andreessen Horowitz' },
  { id: 'founders-fund', term: 'Founders Fund' },
  { id: 'khosla',        term: 'Khosla Ventures' },
  { id: 'coatue',        term: 'Coatue Management',       notes: 'Overlaps with 13F holdings but catches private rounds.' },
  { id: 'thrive',        term: 'Thrive Capital' },
  { id: 'greenoaks',     term: 'Greenoaks Capital' },
  { id: 'softbank',      term: 'SoftBank Vision Fund',    notes: 'Use the fund-specific name to filter out SoftBank Group OpCo filings.' },
  // ARK is mostly public-market; skip Form-D discovery.
  { id: 'ark',           term: null },
  // BlackRock / Tiger / Whale Rock have hedge-fund 13F coverage already.
  { id: 'blackrock',     term: null },
  { id: 'tiger-global',  term: null },
  { id: 'whale-rock',    term: null },
]

/** Slugify a company name into a stable id ("OpenAI Inc." → "openai-inc"). */
export function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

/**
 * Normalize a company name for fuzzy matching (strip corporate suffixes,
 * collapse whitespace, uppercase). Used to detect that an EDGAR-discovered
 * "NVIDIA CORPORATION" matches our existing "NVIDIA" row.
 */
export function normalizeName(s: string): string {
  return s
    .toUpperCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\b(INC|CORP|CORPORATION|CO|LTD|HOLDINGS|GROUP|N\s*V|SA|AG|PLC|LLC|LP|LP\.|L\.P\.|LLLP)\b/g, '')
    .trim()
    .replace(/\s+/g, ' ')
}

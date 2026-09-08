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

  // ---- roster expansion 2026-09-08 -------------------------------------
  // Terms are EDGAR full-text phrases, so they must be specific enough to
  // avoid collecting unrelated filers. Short or generic firm names are the
  // trap here: a bare "Benchmark" or "Accel" matches thousands of unrelated
  // Form Ds, and a polluted company_backers table is worse than a sparse one
  // because it silently misrepresents who actually backed what.
  { id: 'lightspeed',       term: 'Lightspeed Venture Partners' },
  { id: 'general-catalyst', term: 'General Catalyst' },
  { id: 'insight',          term: 'Insight Partners',        notes: 'Formerly Insight Venture Partners; older filings use that.' },
  { id: 'benchmark',        term: 'Benchmark Capital',       notes: 'Never search bare "Benchmark" — matches thousands of unrelated filings.' },
  { id: 'accel',            term: 'Accel Partners',          notes: 'Firm rebranded to plain "Accel"; that term is too generic for FTS, so recent filings will under-match.' },
  { id: 'index-ventures',   term: 'Index Ventures' },
  { id: 'kleiner-perkins',  term: 'Kleiner Perkins' },
  { id: 'greylock',         term: 'Greylock Partners' },
  { id: 'bessemer',         term: 'Bessemer Venture Partners' },
  { id: 'nea',              term: 'New Enterprise Associates', notes: 'Never "NEA" — too short for phrase match.' },
  { id: 'first-round',      term: 'First Round Capital' },
  { id: 'initialized',      term: 'Initialized Capital' },
  { id: 'craft',            term: 'Craft Ventures' },
  { id: 'usv',              term: 'Union Square Ventures' },
  { id: 'bcv',              term: 'Bain Capital Ventures' },
  { id: 'menlo',            term: 'Menlo Ventures' },
  { id: 'redpoint',         term: 'Redpoint Ventures' },
  { id: 'battery',          term: 'Battery Ventures' },
  { id: 'ivp',              term: 'Institutional Venture Partners', notes: 'Never "IVP".' },
  { id: 'norwest',          term: 'Norwest Venture Partners' },
  // YC does appear in some Form Ds, but its real coverage is its own public
  // company directory (~5k companies) — Form D will find a small fraction.
  // Treat this as partial until the directory importer lands.
  { id: 'ycombinator',      term: 'Y Combinator',            notes: 'PARTIAL coverage via Form D; the YC directory is the real source.' },
  { id: 'gv',               term: 'GV Management Company',   notes: 'Google Ventures files under several entity names; expect under-match.' },

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

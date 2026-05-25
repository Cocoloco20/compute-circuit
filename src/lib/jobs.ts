/**
 * Job board client — Greenhouse / Lever / Ashby.
 *
 * All three providers expose a free, no-auth, JSON public API keyed by a
 * board slug. We snapshot per-company open-req count + per-function breakdown
 * once a day so we can chart hiring velocity (a cheap proxy for growth
 * investment / pivots) and surface a "Hiring pulse" drawer chip.
 *
 *   - Greenhouse: GET https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true
 *   - Lever:      GET https://api.lever.co/v0/postings/{slug}?mode=json
 *   - Ashby:      GET https://api.ashbyhq.com/posting-api/job-board/{slug}
 *
 * Companies on Workday / iCIMS / SuccessFactors / Taleo / etc. are excluded —
 * those ATSes don't have a stable public JSON endpoint without scraping. Most
 * of the listed-equity names (NVDA / AMD / INTC / AVGO / QCOM / hyperscalers,
 * the semicap pack) fall in that bucket. See JOB_BOARDS below for the
 * verified slugs (curl-tested against the live endpoint as of 2026-05).
 */

export type JobProvider = 'greenhouse' | 'lever' | 'ashby'

export interface JobBoardConfig {
  provider: JobProvider
  slug: string
}

export interface JobsSnapshot {
  totalOpen: number
  /** function/department name → open req count, e.g. {"Engineering": 50, "Research": 12} */
  byCategory: Record<string, number>
}

/**
 * Verified mappings. Slugs were live-tested via curl on 2026-05-25 and each
 * returned >= 24 open reqs. Add more here as you confirm a board exists for
 * a custom-careers company.
 *
 * Excluded (use a custom / Workday-style careers page, no public JSON):
 *   nvda, amd, avgo, mrvl, arm, qcom, intc, asml, amat, lrcx, klac, tsm,
 *   mu, vrt, anet, eqix, dlr, amzn, msft, googl, orcl, ibm, meta-ai, groq.
 */
export const JOB_BOARDS: Record<string, JobBoardConfig> = {
  anthropic:   { provider: 'greenhouse', slug: 'anthropic' },
  openai:      { provider: 'ashby',      slug: 'openai' },
  xai:         { provider: 'greenhouse', slug: 'xai' },
  cohere:      { provider: 'ashby',      slug: 'cohere' },
  mistral:     { provider: 'lever',      slug: 'mistral' },
  sambanova:   { provider: 'greenhouse', slug: 'sambanovasystems' },
  tenstorrent: { provider: 'greenhouse', slug: 'tenstorrent' },
  cerebras:    { provider: 'greenhouse', slug: 'cerebrassystems' },
  crwv:        { provider: 'greenhouse', slug: 'coreweave' },
  nbis:        { provider: 'greenhouse', slug: 'nebius' },
}

const UA = 'compute-circuit (research tool) luigui.h2002@gmail.com'

interface GreenhouseDepartment { name?: string }
interface GreenhouseJob { departments?: GreenhouseDepartment[] }
interface GreenhouseResponse { jobs?: GreenhouseJob[] }

interface LeverPosting { categories?: { team?: string; department?: string } }
type LeverResponse = LeverPosting[]

interface AshbyJob { department?: string | null; team?: string | null }
interface AshbyResponse { jobs?: AshbyJob[] }

const UNCATEGORIZED = 'Uncategorized'

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
    if (!r.ok) return null
    return (await r.json()) as T
  } catch {
    return null
  }
}

function bumpCategory(byCategory: Record<string, number>, raw: string | null | undefined): void {
  const name = (raw && raw.trim()) || UNCATEGORIZED
  byCategory[name] = (byCategory[name] ?? 0) + 1
}

async function fetchGreenhouse(slug: string): Promise<JobsSnapshot | null> {
  // ?content=true is required to get the `departments` array populated on
  // each job — without it the field is omitted entirely.
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`
  const data = await fetchJson<GreenhouseResponse>(url)
  if (!data || !Array.isArray(data.jobs)) return null
  const byCategory: Record<string, number> = {}
  for (const job of data.jobs) {
    const dept = job.departments?.find(d => d?.name)?.name ?? null
    bumpCategory(byCategory, dept)
  }
  return { totalOpen: data.jobs.length, byCategory }
}

async function fetchLever(slug: string): Promise<JobsSnapshot | null> {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`
  const data = await fetchJson<LeverResponse>(url)
  if (!Array.isArray(data)) return null
  const byCategory: Record<string, number> = {}
  for (const post of data) {
    // Lever's `categories.team` is the closest analogue to a department.
    const team = post.categories?.team ?? post.categories?.department ?? null
    bumpCategory(byCategory, team)
  }
  return { totalOpen: data.length, byCategory }
}

async function fetchAshby(slug: string): Promise<JobsSnapshot | null> {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`
  const data = await fetchJson<AshbyResponse>(url)
  if (!data || !Array.isArray(data.jobs)) return null
  const byCategory: Record<string, number> = {}
  for (const job of data.jobs) {
    bumpCategory(byCategory, job.department ?? job.team ?? null)
  }
  return { totalOpen: data.jobs.length, byCategory }
}

export async function fetchJobsSnapshot(cfg: JobBoardConfig): Promise<JobsSnapshot | null> {
  switch (cfg.provider) {
    case 'greenhouse': return fetchGreenhouse(cfg.slug)
    case 'lever':      return fetchLever(cfg.slug)
    case 'ashby':      return fetchAshby(cfg.slug)
    default:           return null
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Fetch all configured boards sequentially with a tiny pause between calls. */
export async function fetchAllJobBoards(
  entries: Array<{ companyId: string; cfg: JobBoardConfig }>,
): Promise<Array<{ companyId: string; cfg: JobBoardConfig; snap: JobsSnapshot | null }>> {
  const out: Array<{ companyId: string; cfg: JobBoardConfig; snap: JobsSnapshot | null }> = []
  for (const e of entries) {
    const snap = await fetchJobsSnapshot(e.cfg)
    out.push({ companyId: e.companyId, cfg: e.cfg, snap })
    await sleep(120)
  }
  return out
}

/**
 * GitHub REST API client — snapshot a company's primary open-source repo.
 *
 * Per repo we hit four endpoints:
 *   GET /repos/{owner}/{name}                     — stars, default branch
 *   GET /search/issues?q=...is:pr+merged:>=DATE   — merged PR count in last 30d
 *   GET /search/issues?q=...is:pr+created:>=DATE  — opened-this-period count
 *   GET /repos/{owner}/{name}/releases/latest     — last release tag + date
 *   GET /repos/{owner}/{name}/commits?since=DATE  — unique authors → contributors_30d
 *
 * Unauthenticated limit is 60 req/hour for core endpoints + 10 req/min for
 * search. With ~20 cos × 3 core + 2 search reqs we're at ~60 core / ~40 search
 * per run — just under the cap with graceful 403/404 fallback. If a
 * GITHUB_TOKEN env var is set we get 5000 core / 30 search per minute.
 *
 * 404 on releases means "no GitHub Releases" (the repo uses tags only or
 * none at all). Treated as a valid empty release, not an error.
 *
 * Returns null only on hard transport/parse failure — partial data (e.g.
 * stars but no release) yields a snapshot with the missing fields nulled.
 */

const UA = 'compute-circuit (research tool) luigui.h2002@gmail.com'

interface RepoMeta {
  stargazers_count?: number
  default_branch?: string
}

interface SearchIssuesResp {
  total_count?: number
}

interface ReleaseResp {
  tag_name?: string
  published_at?: string  // ISO timestamp
}

interface CommitResp {
  author?: { login?: string } | null
  commit?: { author?: { name?: string; email?: string } | null }
}

interface CommitActivityWeek {
  days: number[]
  total: number
  week: number
}

interface ContributorWeek {
  w: number
  a: number
  d: number
  c: number
}

interface ContributorStats {
  total: number
  weeks: ContributorWeek[]
  author: { login: string }
}

export interface RepoActivitySnapshot {
  repoFullName: string
  stars: number
  prs30dMerged: number
  prs30dOpen: number
  contributors30d: number
  lastReleaseTag: string | null
  lastReleaseDate: string | null  // YYYY-MM-DD
  commits_7d: number
  commits_30d: number
  distinct_committers_30d: number
  lines_added_30d: number
  lines_removed_30d: number
  commits_weekly_history: Array<{ week_starting: string; count: number }>
}

function ghHeaders(): HeadersInit {
  const h: Record<string, string> = {
    'User-Agent': UA,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  const tok = process.env.GITHUB_TOKEN
  if (tok) h.Authorization = `Bearer ${tok}`
  return h
}

/** Fetch JSON with one retry on transient 5xx / 429 / 403-rate-limit. */
async function ghFetch<T>(url: string): Promise<T | null> {
  const opts: RequestInit = { headers: ghHeaders() }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, opts)
      if (r.status === 404) return null
      if (r.ok) return (await r.json()) as T
      // Retry once on rate-limit-ish errors
      const retriable = r.status === 429 || r.status === 403 || r.status >= 500
      if (!retriable || attempt === 1) return null
      await new Promise((res) => setTimeout(res, 1500))
    } catch {
      if (attempt === 1) return null
      await new Promise((res) => setTimeout(res, 1500))
    }
  }
  return null
}

export async function fetchRepoActivity(repoFullName: string): Promise<RepoActivitySnapshot | null> {
  // Validate "owner/name" shape — the GitHub search query is unforgiving.
  if (!repoFullName.includes('/')) return null

  const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)  // YYYY-MM-DD

  // 1. Repo metadata (stars). Hard requirement — if this fails the repo is
  //    private/renamed/gone and the row is meaningless.
  const meta = await ghFetch<RepoMeta>(`https://api.github.com/repos/${repoFullName}`)
  if (!meta) return null
  const stars = Number.isFinite(meta.stargazers_count) ? (meta.stargazers_count as number) : 0

  // 2. PR velocity — search API is the cheapest way to count without
  //    paginating. `is:pr is:merged merged:>=YYYY-MM-DD` is what GitHub's
  //    own filters use under the hood. Colons must be percent-encoded; the
  //    + separator between terms is allowed as-is.
  const qMerged = `repo%3A${repoFullName}+is%3Apr+is%3Amerged+merged%3A%3E%3D${since}`
  const qOpened = `repo%3A${repoFullName}+is%3Apr+created%3A%3E%3D${since}`
  const merged = await ghFetch<SearchIssuesResp>(`https://api.github.com/search/issues?q=${qMerged}&per_page=1`)
  const opened = await ghFetch<SearchIssuesResp>(`https://api.github.com/search/issues?q=${qOpened}&per_page=1`)
  const prs30dMerged = merged?.total_count ?? 0
  const prs30dOpen = opened?.total_count ?? 0

  // 3. Latest release (404 = no GitHub Releases, fine).
  const rel = await ghFetch<ReleaseResp>(`https://api.github.com/repos/${repoFullName}/releases/latest`)
  const lastReleaseTag = rel?.tag_name ?? null
  const lastReleaseDate = rel?.published_at ? rel.published_at.slice(0, 10) : null

  // 4. Unique contributors over last 30d via commits API. per_page=100 gives
  //    one network call for the vast majority of repos.
  const commitsUrl = `https://api.github.com/repos/${repoFullName}/commits?since=${since}T00:00:00Z&per_page=100`
  const commits = await ghFetch<CommitResp[]>(commitsUrl)
  const authorSet = new Set<string>()
  if (Array.isArray(commits)) {
    for (const c of commits) {
      // Prefer the GitHub login (deduped across email aliases); fall back to
      // the raw commit author name/email pair for bots & web-merge commits.
      const key = c.author?.login
        ?? c.commit?.author?.email
        ?? c.commit?.author?.name
      if (key) authorSet.add(key.toLowerCase())
    }
  }

  // 5. Commit activity & Contributors stats (using 202 retry logic)
  let commits_7d = 0
  let commits_30d = 0
  let commits_weekly_history: Array<{ week_starting: string; count: number }> = []

  const commitActivity = await fetchCommitActivity(repoFullName)
  if (Array.isArray(commitActivity) && commitActivity.length > 0) {
    const lastWeek = commitActivity[commitActivity.length - 1]
    commits_7d = lastWeek?.total ?? 0
    const last4Weeks = commitActivity.slice(-4)
    commits_30d = last4Weeks.reduce((sum: number, w) => sum + (w.total || 0), 0)
    commits_weekly_history = commitActivity.slice(-12).map((w) => ({
      week_starting: new Date(w.week * 1000).toISOString().slice(0, 10),
      count: w.total || 0,
    }))
  }

  let distinct_committers_30d = 0
  let lines_added_30d = 0
  let lines_removed_30d = 0

  const contributors = await fetchContributorsStats(repoFullName)
  if (Array.isArray(contributors)) {
    for (const contrib of contributors) {
      if (!contrib.weeks) continue
      const last4Weeks = contrib.weeks.slice(-4)
      let active = false
      for (const w of last4Weeks) {
        if (w.c > 0) active = true
        lines_added_30d += w.a || 0
        lines_removed_30d += w.d || 0
      }
      if (active) {
        distinct_committers_30d++
      }
    }
  }

  return {
    repoFullName,
    stars,
    prs30dMerged,
    prs30dOpen,
    contributors30d: authorSet.size,
    lastReleaseTag,
    lastReleaseDate,
    commits_7d,
    commits_30d,
    distinct_committers_30d,
    lines_added_30d,
    lines_removed_30d,
    commits_weekly_history,
  }
}

async function fetchCommitActivity(repoFullName: string): Promise<CommitActivityWeek[] | null> {
  const url = `https://api.github.com/repos/${repoFullName}/stats/commit_activity`
  const opts: RequestInit = { headers: ghHeaders() }
  
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, opts)
      if (r.status === 202) {
        if (attempt === 1) return null
        await new Promise(res => setTimeout(res, 3000))
        continue
      }
      if (r.ok) {
        return (await r.json()) as CommitActivityWeek[]
      }
      return null
    } catch {
      return null
    }
  }
  return null
}

async function fetchContributorsStats(repoFullName: string): Promise<ContributorStats[] | null> {
  const url = `https://api.github.com/repos/${repoFullName}/stats/contributors`
  const opts: RequestInit = { headers: ghHeaders() }
  
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, opts)
      if (r.status === 202) {
        if (attempt === 1) return null
        await new Promise(res => setTimeout(res, 3000))
        continue
      }
      if (r.ok) {
        return (await r.json()) as ContributorStats[]
      }
      return null
    } catch {
      return null
    }
  }
  return null
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Fetch many repos sequentially with a small delay between each.
 * Search API has a stricter limit (10 req/min unauth) so we space requests
 * out — 350ms between repos gives ~2.85 repos/sec, well under the 10/min
 * search budget even with two search calls per repo.
 */
export async function fetchAllRepoActivity(
  entries: Array<{ companyId: string; repo: string }>,
): Promise<Array<{ companyId: string; snap: RepoActivitySnapshot | null }>> {
  const out: Array<{ companyId: string; snap: RepoActivitySnapshot | null }> = []
  for (const e of entries) {
    const snap = await fetchRepoActivity(e.repo)
    out.push({ companyId: e.companyId, snap })
    await sleep(350)
  }
  return out
}

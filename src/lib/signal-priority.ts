import type { GraphData } from './graph-data'
import type { GithubActivity } from '@/types/db'

export interface PrioritizedSignal {
  kind: string
  score: number
  label: string
}

/**
 * Ranks decision-relevant signals for a given company.
 */
export function rankSignalsForCo(companyId: string, data: GraphData): PrioritizedSignal[] {
  const signals: PrioritizedSignal[] = []

  // arXiv paper output research-output proxy signal
  const arxivSnap = data.arxivSnapshots?.find(s => s.company_id === companyId)
  if (arxivSnap && arxivSnap.papers_30d > 0) {
    signals.push({
      kind: 'arxiv-velocity',
      score: arxivSnap.papers_30d,
      label: `arXiv velocity: ${arxivSnap.papers_30d} papers (30d)`,
    })
  }

  // GitHub commit velocity signal
  const ghSnaps = data.githubActivity?.filter(s => s.company_id === companyId)
  if (ghSnaps && ghSnaps.length > 0) {
    const sorted = ghSnaps.slice().sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date))
    const latest = sorted[0]
    if (latest && latest.commits_30d > 0) {
      // Find snapshot closest to 7 days ago
      const latestT = new Date(latest.snapshot_date).getTime()
      const target7 = latestT - 7 * 86_400_000
      let prior7: GithubActivity | null = null
      let bestDelta = Infinity
      for (const s of sorted) {
        const d = Math.abs(new Date(s.snapshot_date).getTime() - target7)
        if (d < bestDelta) {
          bestDelta = d
          prior7 = s
        }
      }

      const priorCommits = (prior7 && bestDelta < 4 * 86_400_000 && prior7.commits_30d != null) ? prior7.commits_30d : 0
      const delta = latest.commits_30d - priorCommits
      
      const isAcceleration = delta > 0
      const score = isAcceleration ? 30 : 20
      const label = isAcceleration
        ? `GitHub acceleration: +${delta} commits delta (30d)`
        : `GitHub activity: ${latest.commits_30d} commits (30d)`

      signals.push({
        kind: 'github-velocity',
        score,
        label,
      })
    }
  }

  // Sort signals by score descending
  return signals.sort((a, b) => b.score - a.score)
}


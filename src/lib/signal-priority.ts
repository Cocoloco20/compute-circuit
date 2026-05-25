import type { GraphData } from './graph-data'

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

  // Sort signals by score descending
  return signals.sort((a, b) => b.score - a.score)
}

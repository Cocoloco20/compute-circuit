/**
 * /pipeline — deal flow as a list.
 *
 * Additive and independent, like /terminal: shares no code path with `/`.
 * Reads under the service role in a server component; every write goes
 * through /api/pipeline, which enforces the decision gate.
 */

import Link from 'next/link'
import { fetchPipeline, STALE_STAGE_DAYS } from '@/lib/pipeline-data'
import PipelineBoard from '@/components/terminal/pipeline-board'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Pipeline — Compute Circuit' }

export default async function PipelinePage() {
  const data = await fetchPipeline()
  const stalled = data.rows.filter(r =>
    !['Closed', 'Passed'].includes(r.stage) && r.daysInStage > STALE_STAGE_DAYS).length

  return (
    <main className="min-h-screen bg-[#05060a] px-4 py-6 text-[#F2F3F5] sm:px-8 sm:py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Pipeline</h1>
            <p className="mt-0.5 text-xs text-[#6B6F7A]">
              Moving a card to Passed, Term Sheet or Closed records why.
            </p>
          </div>
          <nav className="flex items-center gap-3">
            <Link href="/decisions" className="text-xs text-[#6B6F7A] underline-offset-2 hover:text-[#A5A8B0] hover:underline">Decisions</Link>
            <Link href="/terminal" className="text-xs text-[#6B6F7A] underline-offset-2 hover:text-[#A5A8B0] hover:underline">Terminal</Link>
          </nav>
        </header>

        {data.error ? (
          <div className="rounded-lg border border-[#F87171]/30 bg-[#0D0E13] px-4 py-3">
            <p className="text-sm text-[#F87171]">Failed to load the pipeline.</p>
            <p className="mt-1 font-mono text-[11px] text-[#6B6F7A]">{data.error}</p>
          </div>
        ) : (
          <PipelineBoard rows={data.rows} stale={stalled} />
        )}
      </div>
    </main>
  )
}

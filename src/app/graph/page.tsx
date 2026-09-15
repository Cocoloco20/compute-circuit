/**
 * Top-level server component. Fetches the entire graph from Supabase in one
 * round trip (parallel reads inside fetchGraph) and hands the result to the
 * client-side 3D component.
 *
 * Why server-fetch and not an API route?
 *   - No client-side fetch waterfall — HTML ships with data already on the page.
 *   - The graph is small (KB, not MB) so streaming it inline is faster.
 *   - When mutations land in Phase 2+, those go via Route Handlers / Server
 *     Actions; this page stays read-only.
 *
 * force-dynamic = always run on request, never pre-render. Avoids build-time
 * Supabase calls that fail when env vars aren't wired yet (first Vercel deploy).
 */

import { fetchGraph } from '@/lib/graph-data'
import ComputeGraph from '@/components/compute-graph'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Graph — Offtake',
  description: 'The AI-compute supply-chain graph: companies, investors, capital flows and bottlenecks — the research backbone behind the Offtake contract ledger.',
}

export default async function Page() {
  let data
  try {
    data = await fetchGraph()
  } catch (err) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#05060a] p-8 text-zinc-200">
        <div className="max-w-lg space-y-3 text-sm">
          <h1 className="text-base font-semibold text-red-400">Couldn&apos;t load graph data</h1>
          <p className="text-zinc-400">
            Supabase fetch failed. Check that{' '}
            <code className="text-zinc-200">NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
            <code className="text-zinc-200">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> are set in this
            environment, and that the migration has been applied.
          </p>
          <pre className="overflow-x-auto rounded border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-400">
            {err instanceof Error ? err.message : String(err)}
          </pre>
        </div>
      </main>
    )
  }
  return <ComputeGraph data={data} />
}

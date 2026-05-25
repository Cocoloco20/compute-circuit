/**
 * Test the rankSignalsForCo function against real DB state for the 5 demo cos.
 * Run with: npx tsx scripts/test_ranking.ts
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
import { createClient } from '@supabase/supabase-js'
import { rankSignalsForCo } from '../src/lib/signal-priority'
import type { GraphData, SignalCompanyLink } from '../src/lib/graph-data'
import type {
  Signal,
  Holding,
  Fundamental,
  InsiderTransaction,
  FundingRound,
  TranscriptSignal,
  GpuSpotPrice,
  HfActivity,
  GithubActivity,
  GridDemandSnapshot,
  PatentSnapshotRow,
  JobSnapshotRow,
  ModelLeaderboardEntry,
  Company,
  Investor,
  Layer,
  CompanyBacker,
  Flow,
  Bottleneck,
  BottleneckBeneficiary,
  EiaCommoditySnapshot,
  EiaFuelMixSnapshot,
  EiaInternationalSnapshot,
  AeoProjection,
} from '../src/types/db'

// Read from env — NEVER hardcode the service-role key in committed code.
// Run with: NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... tsx scripts/test_ranking.ts
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars required',
  )
}
const sb = createClient(supabaseUrl, supabaseKey)

async function main() {
  const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10)
  const ninetyAgo = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10)
  const oneEighty = new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10)
  const thirtyFive = new Date(Date.now() - 35 * 86_400_000).toISOString().slice(0, 10)
  const twoYears = new Date(Date.now() - 730 * 86_400_000).toISOString().slice(0, 10)

  // Just enough data to run the ranker — drop columns we don't need
  const [l, i, c, b, f, bn, bb, s, h, fnd, ins, fr, tr, hf, gh, gd, pat, jb, ml] = await Promise.all([
    sb.from('layers').select('*'),
    sb.from('investors').select('*'),
    sb.from('companies').select('*'),
    sb.from('company_backers').select('*'),
    sb.from('flows').select('*'),
    sb.from('bottlenecks').select('*'),
    sb.from('bottleneck_beneficiaries').select('*'),
    sb.from('signals').select('*').gte('date', yearAgo).limit(2000),
    sb.from('holdings').select('*').limit(500),
    sb.from('fundamentals').select('*').gte('period', twoYears).order('period', { ascending: false }).limit(2000),
    sb.from('insider_transactions').select('*').gte('filing_date', ninetyAgo).limit(500),
    sb.from('funding_rounds').select('*').gte('filed_date', oneEighty).limit(500),
    sb.from('transcript_signals').select('*').gte('filed_date', oneEighty).limit(500),
    sb.from('hf_activity').select('*').limit(200),
    sb.from('github_activity').select('*').limit(200),
    sb.from('grid_demand_snapshots').select('*').gte('snapshot_date', thirtyFive).limit(500),
    sb.from('patent_snapshots').select('*').gte('snapshot_date', thirtyFive).limit(1500),
    sb.from('job_snapshots').select('*').gte('snapshot_date', thirtyFive).limit(500),
    sb.from('model_leaderboard').select('*').gte('snapshot_date', thirtyFive).limit(200),
  ])
  const signals = (s.data ?? []) as Signal[]
  const sigIds = signals.map(x => x.id)
  let scData: SignalCompanyLink[] = []
  for (let i2 = 0; i2 < sigIds.length; i2 += 200) {
    const chunk = sigIds.slice(i2, i2 + 200)
    const r = await sb.from('signal_companies').select('*').in('signal_id', chunk)
    scData = scData.concat((r.data ?? []) as SignalCompanyLink[])
  }

  const data: GraphData = {
    layers: (l.data ?? []) as Layer[],
    investors: (i.data ?? []) as Investor[],
    companies: (c.data ?? []) as Company[],
    backers: (b.data ?? []) as CompanyBacker[],
    flows: (f.data ?? []) as Flow[],
    bottlenecks: (bn.data ?? []) as Bottleneck[],
    bottleneckBeneficiaries: (bb.data ?? []) as BottleneckBeneficiary[],
    signals,
    signalCompanies: scData,
    holdings: (h.data ?? []) as Holding[],
    fundamentals: (fnd.data ?? []) as Fundamental[],
    insiders: (ins.data ?? []) as InsiderTransaction[],
    fundingRounds: (fr.data ?? []) as FundingRound[],
    transcripts: (tr.data ?? []) as TranscriptSignal[],
    gpuSpot: [] as GpuSpotPrice[],
    hfActivity: (hf.data ?? []) as HfActivity[],
    githubActivity: (gh.data ?? []) as GithubActivity[],
    gridDemand: (gd.data ?? []) as GridDemandSnapshot[],
    patents: (pat.data ?? []) as PatentSnapshotRow[],
    jobs: (jb.data ?? []) as JobSnapshotRow[],
    modelLeaderboard: (ml.data ?? []) as ModelLeaderboardEntry[],
    eiaCommodities: [] as EiaCommoditySnapshot[],
    eiaFuelMix: [] as EiaFuelMixSnapshot[],
    eiaInternational: [] as EiaInternationalSnapshot[],
    aeoProjections: [] as AeoProjection[],
    lastUpdates: {
      price: null, news: null, filings: null, insider: null,
      fundingRounds: null, transcripts: null, gpuSpot: null, hf: null,
      github: null, holdings: null, grid: null, patents: null,
      jobs: null, leaderboard: null,
    },
  }

  const NAMES = ['NVIDIA', 'Databricks', 'Crusoe', 'Apptronik', 'Vertiv']
  for (const name of NAMES) {
    const co = data.companies.find(c => c.name === name || c.name.startsWith(name + ' '))
    if (!co) {
      console.log(`\n=== ${name}: NOT FOUND ===`)
      continue
    }
    const ranked = rankSignalsForCo(co.id, data)
    console.log(`\n=== ${name} (${co.id}) ===`)
    ranked.forEach((r, idx) => {
      const flag = idx < 3 ? 'TOP' : 'mor'
      console.log(`  [${flag}] ${r.score.toString().padStart(2)}  ${r.kind.padEnd(20)} ${r.headline}`)
    })
  }
}

main().catch(e => { console.error(e); process.exit(1) })

import { supabaseServer } from './supabase/server'
import type {
  Layer,
  Investor,
  Company,
  CompanyBacker,
  Flow,
  Bottleneck,
  BottleneckBeneficiary,
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
  EiaCommoditySnapshot,
  EiaFuelMixSnapshot,
  EiaInternationalSnapshot,
  AeoProjection,
  ModelLeaderboardEntry,
} from '@/types/db'

export interface SignalCompanyLink {
  signal_id: string
  company_id: string
}

export interface GraphData {
  layers: Layer[]
  investors: Investor[]
  companies: Company[]
  backers: CompanyBacker[]
  flows: Flow[]
  bottlenecks: Bottleneck[]
  bottleneckBeneficiaries: BottleneckBeneficiary[]
  signals: Signal[]               // recent only — last 365 days
  signalCompanies: SignalCompanyLink[]
  holdings: Holding[]             // 13F holdings matched to our companies only
  fundamentals: Fundamental[]     // XBRL metrics, last 2 years per company
  insiders: InsiderTransaction[]  // Form 4 transactions, last 90 days
  fundingRounds: FundingRound[]   // Form D filings, last 180 days
  transcripts: TranscriptSignal[] // Earnings-8K NLP signals, last 180 days
  gpuSpot: GpuSpotPrice[]         // GPU spot-price snapshots, last 35 days
  hfActivity: HfActivity[]        // latest HF snapshot per company
  githubActivity: GithubActivity[] // latest GitHub repo snapshot per company
  gridDemand: GridDemandSnapshot[] // EIA grid demand, last 35 days for delta
  patents: PatentSnapshotRow[]    // USPTO TTM snapshots, last 35 days for delta
  jobs: JobSnapshotRow[]          // Hiring pulse snapshots, last 35 days for delta
  modelLeaderboard: ModelLeaderboardEntry[] // Chatbot Arena / AA model ELO rankings, last 35 days
  eiaCommodities: EiaCommoditySnapshot[]    // Henry Hub, coal stocks, nuke outage, ...
  eiaFuelMix: EiaFuelMixSnapshot[]          // Per-region generation mix + carbon intensity
  eiaInternational: EiaInternationalSnapshot[]  // Fab-country electricity stats
  aeoProjections: AeoProjection[]           // AEO 2026 long-term forecast (data center demand)
  lastUpdates: {                  // GasCity-style "instrument is live" telemetry
    price: string | null          // ISO of most-recent companies.price_updated_at
    news: string | null           // most-recent signals.date where source='google-news'
    filings: string | null        // most-recent signals.date where source='sec-edgar'
    insider: string | null        // most-recent insider_transactions.filing_date
    fundingRounds: string | null  // most-recent funding_rounds.filed_date
    transcripts: string | null    // most-recent transcript_signals.filed_date
    gpuSpot: string | null        // most-recent gpu_spot_prices.snapshot_date
    hf: string | null             // most-recent hf_activity.snapshot_date
    github: string | null         // most-recent github_activity.snapshot_date
    holdings: string | null       // most-recent holdings.period
    grid: string | null           // most-recent grid_demand_snapshots.snapshot_date
    patents: string | null        // most-recent patent_snapshots.snapshot_date
    jobs: string | null           // most-recent job_snapshots.snapshot_date
    leaderboard: string | null    // most-recent model_leaderboard.snapshot_date
  }
}

/**
 * Single round-trip-ish fetch of the entire graph. Supabase reads run in
 * parallel; if any error, throws with all messages so caller doesn't have to
 * deal with partial state.
 *
 * Called from the server component (page.tsx). Result is passed as a prop
 * to the client-side 3D component — no client-side fetch waterfall.
 */
export async function fetchGraph(): Promise<GraphData> {
  const sb = supabaseServer()
  // Cap signals to the last 365 days so the initial payload stays small even
  // as filings accumulate. Full history is still in Postgres for ad-hoc queries.
  const yearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const [l, i, c, b, f, bn, bb, s] = await Promise.all([
    sb.from('layers').select('*').order('order_index'),
    sb.from('investors').select('*').order('name'),
    sb.from('companies').select('*').order('name'),
    sb.from('company_backers').select('*'),
    sb.from('flows').select('*'),
    sb.from('bottlenecks').select('*'),
    sb.from('bottleneck_beneficiaries').select('*'),
    sb.from('signals').select('*').gte('date', yearAgo).order('date', { ascending: false }).limit(2000),
  ])

  // signal_companies has thousands of rows (one per filing). The default 1000-row
  // Supabase cap silently drops links for later-alphabetical companies — so we
  // fetch only the links for our already-windowed signal IDs in a second query.
  //
  // CHUNK the .in() lookup: with ~900+ signals (8-Ks + news), the resulting
  // URL exceeds Supabase REST's URL-length cap and returns 400 Bad Request.
  // 200 IDs per chunk keeps URLs comfortably small.
  const signals = (s.data ?? []) as Signal[]
  const sigIds = signals.map(x => x.id)
  let scData: SignalCompanyLink[] = []
  let scError: { message: string } | null = null
  for (let i = 0; i < sigIds.length; i += 200) {
    const chunk = sigIds.slice(i, i + 200)
    const r = await sb.from('signal_companies').select('*').in('signal_id', chunk)
    if (r.error) { scError = r.error; break }
    scData = scData.concat((r.data ?? []) as SignalCompanyLink[])
  }
  const sc = { data: scData, error: scError }

  // Holdings: only those matched to one of OUR companies (small subset of the
  // total holdings table — typically a few dozen rows). Full per-filer 13Fs
  // stay queryable server-side for ad-hoc analysis.
  const h = await sb
    .from('holdings')
    .select('*')
    .not('company_id', 'is', null)
    .order('period', { ascending: false })
    .order('value_usd', { ascending: false })
    .limit(500)

  // Fundamentals: last 2 years per company. We have ~32 public cos × ~12 metrics × ~8 periods
  // = ~3000 rows max, but most cos won't have all metrics — typically ~1000 rows.
  const twoYearsAgo = new Date(Date.now() - 730 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const fnd = await sb
    .from('fundamentals')
    .select('*')
    .gte('period', twoYearsAgo)
    .order('period', { ascending: false })
    .limit(2000)

  // Insider transactions: last 90 days. Daily cron caps backfill at 120 XML
  // fetches/run so this table stays manageable.
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const ins = await sb
    .from('insider_transactions')
    .select('*')
    .gte('filing_date', ninetyDaysAgo)
    .order('filing_date', { ascending: false })
    .limit(500)

  // Funding rounds: last 180 days. Daily cron only scans private CIKed cos,
  // each with 0-2 Form D filings/quarter — total volume is small (<200 rows).
  const oneEightyDaysAgo = new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10)
  const fr = await sb
    .from('funding_rounds')
    .select('*')
    .gte('filed_date', oneEightyDaysAgo)
    .order('filed_date', { ascending: false })
    .limit(200)

  // Transcript signals: last 180 days. ~30 public CIKed cos × ≤ 4 quarterly
  // earnings 8-Ks/yr → ≤ 60 rows in window, well under the cap.
  const tr = await sb
    .from('transcript_signals')
    .select('*')
    .gte('filed_date', oneEightyDaysAgo)
    .order('filed_date', { ascending: false })
    .limit(500)

  // GPU spot prices: last 35 days. 8 canonical models × 3 sources × 35 days
  // = up to 840 rows — keep the limit ample so deltas always render.
  const gpu = await sb
    .from('gpu_spot_prices')
    .select('*')
    .gte('snapshot_date', new Date(Date.now() - 35 * 86_400_000).toISOString().slice(0, 10))
    .order('snapshot_date', { ascending: false })
    .limit(500)

  // HF activity: most recent snapshot per company. With ~20 hf-tagged cos
  // × 1 snapshot/day this is trivial.
  const hf = await sb
    .from('hf_activity')
    .select('*')
    .order('snapshot_date', { ascending: false })
    .limit(200)

  // GitHub activity: most recent snapshot per company. Same shape as HF —
  // ~20 cos × 1 snapshot/day.
  const gh = await sb
    .from('github_activity')
    .select('*')
    .order('snapshot_date', { ascending: false })
    .limit(200)

  // 35-day window for the three "delta" signals so drawer chips can compare
  // today vs 7d and 30d ago. Volumes are tiny:
  //   grid_demand: 7 cos × 35 = 245
  //   patents:     21 cos × 35 = 735
  //   jobs:        10 cos × 35 = 350
  const thirtyFiveDaysAgo = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const [gd, pat, jb, ml, eiaCom, eiaFmx, eiaIntl, aeo] = await Promise.all([
    sb.from('grid_demand_snapshots').select('*')
      .gte('snapshot_date', thirtyFiveDaysAgo)
      .order('snapshot_date', { ascending: false }).limit(500),
    sb.from('patent_snapshots').select('*')
      .gte('snapshot_date', thirtyFiveDaysAgo)
      .order('snapshot_date', { ascending: false }).limit(1500),
    sb.from('job_snapshots').select('*')
      .gte('snapshot_date', thirtyFiveDaysAgo)
      .order('snapshot_date', { ascending: false }).limit(500),
    sb.from('model_leaderboard').select('*')
      .gte('snapshot_date', thirtyFiveDaysAgo)
      .order('snapshot_date', { ascending: false }).limit(200),
    // Commodity series often update monthly/annual — pull a wider window
    // (180d) so we can always compute a delta-vs-prior.
    sb.from('eia_commodity_snapshots').select('*')
      .gte('snapshot_date', new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10))
      .order('snapshot_date', { ascending: false }).limit(1000),
    sb.from('eia_fuelmix_snapshots').select('*')
      .gte('snapshot_date', thirtyFiveDaysAgo)
      .order('snapshot_date', { ascending: false }).limit(500),
    // International annual — pull 5 years for trend context
    sb.from('eia_international_snapshots').select('*')
      .order('snapshot_date', { ascending: false }).limit(50),
    // AEO projections — static reference data, refreshed annually
    sb.from('aeo_projections').select('*')
      .order('projection_year', { ascending: true }).limit(300),
  ])

  // All optional signal tables — non-fatal on read error (table empty,
  // RLS denied, API key missing pre-cron).
  for (const r of [gd, pat, jb, ml, eiaCom, eiaFmx, eiaIntl, aeo] as Array<{ error: { message: string } | null }>) {
    if (r.error) {
      // eslint-disable-next-line no-console
      console.warn('[graph-data] optional signal table read failed:', r.error.message)
    }
  }

  const errors = [l, i, c, b, f, bn, bb, s, sc, h, fnd, ins, fr, tr, gpu, hf, gh].map(r => r.error).filter(Boolean)
  if (errors.length > 0) {
    throw new Error('Supabase fetch failed: ' + errors.map(e => e!.message).join('; '))
  }
  return {
    layers: (l.data ?? []) as Layer[],
    investors: (i.data ?? []) as Investor[],
    companies: (c.data ?? []) as Company[],
    backers: (b.data ?? []) as CompanyBacker[],
    flows: (f.data ?? []) as Flow[],
    bottlenecks: (bn.data ?? []) as Bottleneck[],
    bottleneckBeneficiaries: (bb.data ?? []) as BottleneckBeneficiary[],
    signals,
    signalCompanies: (sc.data ?? []) as SignalCompanyLink[],
    holdings: (h.data ?? []) as Holding[],
    fundamentals: (fnd.data ?? []) as Fundamental[],
    insiders: (ins.data ?? []) as InsiderTransaction[],
    fundingRounds: (fr.data ?? []) as FundingRound[],
    transcripts: (tr.data ?? []) as TranscriptSignal[],
    gpuSpot: (gpu.data ?? []) as GpuSpotPrice[],
    hfActivity: (hf.data ?? []) as HfActivity[],
    githubActivity: (gh.data ?? []) as GithubActivity[],
    gridDemand: (gd.data ?? []) as GridDemandSnapshot[],
    patents: (pat.data ?? []) as PatentSnapshotRow[],
    jobs: (jb.data ?? []) as JobSnapshotRow[],
    modelLeaderboard: (ml.data ?? []) as ModelLeaderboardEntry[],
    eiaCommodities: (eiaCom.data ?? []) as EiaCommoditySnapshot[],
    eiaFuelMix: (eiaFmx.data ?? []) as EiaFuelMixSnapshot[],
    eiaInternational: (eiaIntl.data ?? []) as EiaInternationalSnapshot[],
    aeoProjections: (aeo.data ?? []) as AeoProjection[],
    lastUpdates: {
      price: ((c.data ?? []) as Company[])
        .map(co => co.price_updated_at)
        .filter((x): x is string => !!x)
        .sort()
        .at(-1) ?? null,
      news: ((s.data ?? []) as Signal[])
        .filter(x => x.source === 'google-news')
        .map(x => x.date)
        .sort()
        .at(-1) ?? null,
      filings: ((s.data ?? []) as Signal[])
        .filter(x => x.source === 'sec-edgar')
        .map(x => x.date)
        .sort()
        .at(-1) ?? null,
      insider: ((ins.data ?? []) as InsiderTransaction[])
        .map(x => x.filing_date)
        .sort()
        .at(-1) ?? null,
      fundingRounds: ((fr.data ?? []) as FundingRound[])
        .map(x => x.filed_date)
        .sort()
        .at(-1) ?? null,
      transcripts: ((tr.data ?? []) as TranscriptSignal[])
        .map(x => x.filed_date)
        .sort()
        .at(-1) ?? null,
      gpuSpot: ((gpu.data ?? []) as GpuSpotPrice[])
        .map(x => x.snapshot_date)
        .sort()
        .at(-1) ?? null,
      hf: ((hf.data ?? []) as HfActivity[])
        .map(x => x.snapshot_date)
        .sort()
        .at(-1) ?? null,
      github: ((gh.data ?? []) as GithubActivity[])
        .map(x => x.snapshot_date)
        .sort()
        .at(-1) ?? null,
      holdings: ((h.data ?? []) as Holding[])
        .map(x => x.period)
        .sort()
        .at(-1) ?? null,
      grid: ((gd.data ?? []) as GridDemandSnapshot[])
        .map(x => x.snapshot_date)
        .sort()
        .at(-1) ?? null,
      patents: ((pat.data ?? []) as PatentSnapshotRow[])
        .map(x => x.snapshot_date)
        .sort()
        .at(-1) ?? null,
      jobs: ((jb.data ?? []) as JobSnapshotRow[])
        .map(x => x.snapshot_date)
        .sort()
        .at(-1) ?? null,
      leaderboard: ((ml.data ?? []) as ModelLeaderboardEntry[])
        .map(x => x.snapshot_date)
        .sort()
        .at(-1) ?? null,
    },
  }
}

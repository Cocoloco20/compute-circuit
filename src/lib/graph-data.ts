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
  GpuHyperscalerPricing,
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
  SocialMention,
  InterestSignal,
  ArxivPaper,
  ArxivSnapshot,
  Agency,
  ComputeContract,
  WatchlistEntry,
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
  gpuHyperscaler: GpuHyperscalerPricing[] // AWS/Azure/GCP spot pricing, last 14 days
  hfActivity: HfActivity[]        // latest HF snapshot per company
  githubActivity: GithubActivity[] // latest GitHub repo snapshot per company
  gridDemand: GridDemandSnapshot[] // EIA grid demand, last 35 days for delta
  patents: PatentSnapshotRow[]    // USPTO TTM snapshots, last 35 days for delta
  jobs: JobSnapshotRow[]          // Hiring pulse snapshots, last 35 days for delta
  modelLeaderboard: ModelLeaderboardEntry[] // Chatbot Arena / AA model ELO rankings, last 35 days
  socialMentions: SocialMention[] // Social mention snapshots, last 14 days
  interestSignals: InterestSignal[] // Interest signal snapshots, last 35 days
  arxivSnapshots: ArxivSnapshot[]
  arxivPapers: ArxivPaper[]
  eiaCommodities: EiaCommoditySnapshot[]    // Henry Hub, coal stocks, nuke outage, ...
  eiaFuelMix: EiaFuelMixSnapshot[]          // Per-region generation mix + carbon intensity
  eiaInternational: EiaInternationalSnapshot[]  // Fab-country electricity stats
  aeoProjections: AeoProjection[]           // AEO 2026 long-term forecast (data center demand)
  agencies: Agency[]
  computeContracts: ComputeContract[]
  watchlist: WatchlistEntry[]              // Phase 9 — the investor layer      // Phase 8 — buyer→seller mega-deal ledger                        // Phase 7A — regulators / export-control / standards
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
    social: string | null         // most-recent social_mentions.snapshot_date
    interest: string | null       // most-recent interest_signals.snapshot_date
    arxiv: string | null          // most-recent arxiv_snapshots.snapshot_date
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
    // Explicit columns: select('*') also ships source_key — a ~120-byte
    // dedup string per row ('news:{co}:{url}') that no client code reads.
    // At 2,000 signals that's ~240KB of dead payload.
    sb.from('signals').select('id, date, source, headline, impact, url, accession_number, form_type, created_at').gte('date', yearAgo).order('date', { ascending: false }).limit(2000),
  ])

  // ---------------------------------------------------------------------
  // Everything below depends only on `signals` (or nothing at all), so it
  // all runs in ONE parallel wave. The previous shape — one await per table
  // plus ~20 sequential fundamentals pages — serialized ~30 round-trips to
  // a us-west-1 database and dominated the page's 11s render time.
  // ---------------------------------------------------------------------
  const signals = (s.data ?? []) as Signal[]
  const twoYearsAgo = new Date(Date.now() - 730 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const oneEightyDaysAgo = new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10)
  const thirtyFiveDaysAgo = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const PAGE = 1000

  // signal_companies: links only for our already-windowed signal IDs.
  // CHUNK the .in() lookup (200 IDs/chunk) — a single .in() with 2000 IDs
  // exceeds Supabase REST's URL-length cap and 400s. Chunks run in parallel.
  const fetchSignalCompanies = async (): Promise<{ data: SignalCompanyLink[]; error: { message: string } | null }> => {
    const sigIds = signals.map(x => x.id)
    const chunks: string[][] = []
    for (let i = 0; i < sigIds.length; i += 200) chunks.push(sigIds.slice(i, i + 200))
    const results = await Promise.all(chunks.map(chunk =>
      sb.from('signal_companies').select('signal_id, company_id').in('signal_id', chunk)))
    const err = results.find(r => r.error)?.error ?? null
    return { data: results.flatMap(r => (r.data ?? []) as SignalCompanyLink[]), error: err }
  }

  // Fundamentals: last 2 years, explicit columns — the single biggest item
  // in the page payload (~21K rows post-Phase-7B). The UI only reads
  // company_id / period / period_type / metric / value; id / unit / source /
  // updated_at were ~40% of each row's JSON for zero reads. Count first,
  // then fetch all pages in parallel (Supabase REST caps each response at
  // 1000 rows regardless of .limit). Rows inserted between the count and
  // the page fetches can shift a boundary row — harmless for a dashboard.
  const fetchFundamentals = async (): Promise<{ data: Fundamental[]; error: { message: string } | null }> => {
    const cnt = await sb.from('fundamentals')
      .select('company_id', { count: 'exact', head: true })
      .gte('period', twoYearsAgo)
    if (cnt.error) return { data: [], error: cnt.error }
    const total = Math.min(cnt.count ?? 0, 40_000) // safety cap vs runaway table
    const pages = []
    for (let offset = 0; offset < total; offset += PAGE) {
      pages.push(sb.from('fundamentals')
        .select('company_id, period, period_type, metric, value')
        .gte('period', twoYearsAgo)
        .order('period', { ascending: false })
        .range(offset, offset + PAGE - 1))
    }
    const results = await Promise.all(pages)
    const err = results.find(r => r.error)?.error ?? null
    return { data: results.flatMap(r => (r.data ?? []) as Fundamental[]), error: err }
  }

  const [
    sc, fnd, h, ins, fr, tr, gpu, gpuHs, hf, gh,
    gd, pat, jb, ml, eiaCom, eiaFmx, eiaIntl, aeo, sm, intSig, axSnap, axPapers,
    ag, cc, wl,
  ] = await Promise.all([
    fetchSignalCompanies(),
    fetchFundamentals(),
    // Holdings matched to one of OUR companies (small subset of the table).
    sb.from('holdings').select('*')
      .not('company_id', 'is', null)
      .order('period', { ascending: false })
      .order('value_usd', { ascending: false }).limit(500),
    // Insider transactions: last 90 days.
    sb.from('insider_transactions').select('*')
      .gte('filing_date', ninetyDaysAgo)
      .order('filing_date', { ascending: false }).limit(500),
    // Funding rounds: last 180 days (<200 rows).
    sb.from('funding_rounds').select('*')
      .gte('filed_date', oneEightyDaysAgo)
      .order('filed_date', { ascending: false }).limit(200),
    // Transcript signals: last 180 days.
    sb.from('transcript_signals').select('*')
      .gte('filed_date', oneEightyDaysAgo)
      .order('filed_date', { ascending: false }).limit(500),
    // GPU spot prices: last 35 days.
    sb.from('gpu_spot_prices').select('*')
      .gte('snapshot_date', thirtyFiveDaysAgo)
      .order('snapshot_date', { ascending: false }).limit(500),
    // GPU hyperscaler pricing: last 14 days. Non-fatal (warned below).
    sb.from('gpu_hyperscaler_pricing').select('*')
      .gte('snapshot_date', fourteenDaysAgo)
      .order('snapshot_date', { ascending: false }).limit(500),
    // HF activity: most recent snapshots (~20 hf-tagged cos).
    sb.from('hf_activity').select('*')
      .order('snapshot_date', { ascending: false }).limit(200),
    // GitHub activity: last 35 days for delta.
    sb.from('github_activity').select('*')
      .gte('snapshot_date', thirtyFiveDaysAgo)
      .order('snapshot_date', { ascending: false }).limit(1000),
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
    // Social mentions — last 14 days, limit 500
    sb.from('social_mentions').select('*')
      .gte('snapshot_date', fourteenDaysAgo)
      .order('snapshot_date', { ascending: false }).limit(500),
    // Interest signals — last 35 days, limit 500
    sb.from('interest_signals').select('*')
      .gte('snapshot_date', thirtyFiveDaysAgo)
      .order('snapshot_date', { ascending: false }).limit(500),
    // ArXiv Snapshots
    sb.from('arxiv_snapshots').select('*')
      .gte('snapshot_date', thirtyFiveDaysAgo)
      .order('snapshot_date', { ascending: false }).limit(200),
    // ArXiv Papers
    sb.from('arxiv_papers').select('*')
      .gte('published_date', ninetyDaysAgo)
      .order('published_date', { ascending: false }).limit(500),
    // Phase 7A — agencies (regulators / export-control bodies). Tiny table.
    sb.from('agencies').select('*').order('name').limit(50),
    // Phase 8 — compute contracts ledger (hand-curated, <100 rows).
    sb.from('compute_contracts').select('*').order('announced', { ascending: false }).limit(200),
    // Phase 9 — user watchlist (single-user tool, tiny table).
    sb.from('watchlist').select('*').order('added_at').limit(200),
  ])

  // Non-fatal reads — table may be empty / missing migration / RLS-denied.
  // Warn instead of failing the whole page.
  for (const r of [gpuHs, ag, cc, wl, gd, pat, jb, ml, eiaCom, eiaFmx, eiaIntl, aeo, sm, intSig, axSnap, axPapers] as Array<{ error: { message: string } | null }>) {
    if (r.error) {
      // eslint-disable-next-line no-console
      console.warn('[graph-data] optional table read failed:', r.error.message)
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
    gpuHyperscaler: (gpuHs.data ?? []) as GpuHyperscalerPricing[],
    hfActivity: (hf.data ?? []) as HfActivity[],
    githubActivity: (gh.data ?? []) as GithubActivity[],
    gridDemand: (gd.data ?? []) as GridDemandSnapshot[],
    patents: (pat.data ?? []) as PatentSnapshotRow[],
    jobs: (jb.data ?? []) as JobSnapshotRow[],
    modelLeaderboard: (ml.data ?? []) as ModelLeaderboardEntry[],
    socialMentions: (sm.data ?? []) as SocialMention[],
    interestSignals: (intSig.data ?? []) as InterestSignal[],
    arxivSnapshots: (axSnap.data ?? []) as ArxivSnapshot[],
    arxivPapers: (axPapers.data ?? []) as ArxivPaper[],
    eiaCommodities: (eiaCom.data ?? []) as EiaCommoditySnapshot[],
    eiaFuelMix: (eiaFmx.data ?? []) as EiaFuelMixSnapshot[],
    eiaInternational: (eiaIntl.data ?? []) as EiaInternationalSnapshot[],
    aeoProjections: (aeo.data ?? []) as AeoProjection[],
    agencies: (ag.data ?? []) as Agency[],
    computeContracts: (cc.data ?? []) as ComputeContract[],
    watchlist: (wl.data ?? []) as WatchlistEntry[],
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
      social: ((sm.data ?? []) as SocialMention[])
        .map(x => x.snapshot_date)
        .sort()
        .at(-1) ?? null,
      interest: ((intSig.data ?? []) as InterestSignal[])
        .map(x => x.snapshot_date)
        .sort()
        .at(-1) ?? null,
      arxiv: ((axSnap.data ?? []) as ArxivSnapshot[])
        .map(x => x.snapshot_date)
        .sort()
        .at(-1) ?? null,
    },
  }
}

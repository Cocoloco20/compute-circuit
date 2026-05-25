// Hand-written DB types matching supabase/migrations/0001_init.sql.
// When you install the Supabase CLI later, regenerate with:
//   supabase gen types typescript --project-id YOUR_PROJECT > src/types/db.ts

export type FlowType = 'money' | 'compute' | 'energy' | 'equipment' | 'intel' | 'venture'
export type NodeKind = 'company' | 'investor'

export interface Layer {
  id: string
  name: string
  order_index: number
  y_position: number
}

export interface Investor {
  id: string
  name: string
  domain: string | null
  thesis: string | null
  cik: string | null         // SEC CIK for 13F filers
  files_13f: boolean         // does the cron pull this filer's holdings?
  created_at: string
}

export interface Holding {
  id: string
  investor_id: string
  company_id: string | null
  cusip: string
  issuer_name: string
  title_of_class: string | null
  period: string             // ISO date — quarter-end
  shares: number | null
  value_usd: number | null
  accession: string
  created_at: string
}

export interface Company {
  id: string
  ticker: string | null
  name: string
  domain: string | null
  layer_id: string | null
  weight: number
  private: boolean
  position_held: boolean
  conviction: string | null
  thesis: string | null
  share: number | null
  notes: string | null
  cik: string | null  // SEC Central Index Key — populated by CIK backfill
  cusip: string | null // CUSIP for 13F holdings join (companies.cusip → holdings.cusip)
  discovered_via: string | null  // null = manual seed; otherwise investor.id of the scraper
  discovered_at: string | null
  // Market snapshot (refreshed daily by /api/cron/prices)
  last_price: number | null
  prev_close: number | null
  fifty_two_week_high: number | null
  fifty_two_week_low: number | null
  price_currency: string | null
  price_updated_at: string | null
  price_history: Array<[string, number]>  // [[YYYY-MM-DD, close], ...] up to 90, oldest first
  hf_org: string | null  // Hugging Face org slug (e.g. 'nvidia', 'meta-llama')
  github_repo: string | null  // GitHub "owner/name" of primary OSS repo (e.g. 'openai/openai-python')
  eia_region: string | null  // EIA balancing-authority code ('PJM', 'ERCO', 'FLA', 'US48')
  assignee_name: string | null  // USPTO assignee name for patent search (e.g. 'NVIDIA Corporation')
  // AI-generated thesis (Phase 7c). Coexists with manual `thesis` field above:
  // analysts can write a `thesis`; the generator writes to `thesis_ai`.
  thesis_ai: string | null
  thesis_risk_ai: string | null
  thesis_generated_at: string | null
  wikipedia_slug: string | null
  google_trends_term: string | null
  created_at: string
  updated_at: string
}

export interface InterestSignal {
  id: string
  company_id: string
  snapshot_date: string
  wikipedia_views_7d: number | null
  wikipedia_views_28d: number | null
  wikipedia_yoy_pct: number | null
  google_trends_score: number | null
  google_trends_7d_delta: number | null
  created_at: string
}

export interface GridDemandSnapshot {
  id: string
  company_id: string
  snapshot_date: string
  region: string
  current_7d_avg_mwh: number | null
  yoy_change_pct: number | null
  last_hourly_mwh: number | null
  last_hour: string | null
  created_at: string
}

export interface EiaCommoditySnapshot {
  id: string
  series_id: string         // 'NG.HENRY_HUB.D' | 'NUC.OUTAGE_US.D' | ...
  snapshot_date: string
  value: number
  unit: string
  label: string | null
  source_series: string | null
  created_at: string
}

export interface EiaFuelMixSnapshot {
  id: string
  region: string
  snapshot_date: string
  fuel_mix: Record<string, number>  // { nuclear: 33.2, natural_gas: 41.1, ... } — % of 24h gen
  total_mwh: number | null
  carbon_g_per_kwh: number | null
  created_at: string
}

export interface EiaInternationalSnapshot {
  id: string
  country_id: string                // 'TWN' | 'KOR' | 'JPN' | 'NLD' | 'SGP' | 'IRL'
  country_label: string
  fab_exposure: string              // 'TSMC' | 'Samsung / SK Hynix' | ...
  snapshot_date: string
  latest_year: number
  net_generation_twh: number
  yoy_pct: number | null
  created_at: string
}

export interface AeoProjection {
  id: string
  scenario: string                  // 'HIGHELDMD' | 'CB2026' | 'AEO2025REF'
  metric: string                    // 'dc_demand_purchased' | 'dc_demand_delivered' | 'dc_demand_total_use'
  projection_year: number
  value_quads: number
  value_twh: number
  source: string                    // 'AEO 2026'
  extracted_at: string
}

export interface FundingRound {
  id: string
  company_id: string
  filed_date: string                    // YYYY-MM-DD
  accession: string                     // SEC accession; dedup key
  total_amount_sold_usd: number | null
  total_offering_amount_usd: number | null
  total_amount_remaining_usd: number | null
  has_amount_indefinite: boolean        // true if any of the amount fields was "Indefinite"
  investors_named: string[]             // related-person names from Form D
  source_url: string | null
  created_at: string
}

export interface TranscriptSignal {
  id: string
  company_id: string
  filed_date: string                    // YYYY-MM-DD
  accession: string                     // SEC accession; dedup key
  ai_mentions: number
  gpu_mentions: number
  capex_mentions: number
  data_center_mentions: number
  token_mentions: number
  extracted_phrases: Array<{ phrase: string; context_snippet: string }>
  source_url: string | null
  created_at: string
}

export interface InsiderTransaction {
  id: string
  company_id: string
  accession: string
  filing_date: string
  transaction_date: string | null
  reporting_owner: string | null
  reporting_owner_role: string | null
  is_officer: boolean | null
  is_director: boolean | null
  is_ten_percent_owner: boolean | null
  security_title: string | null
  shares: number | null
  price_per_share: number | null
  value_usd: number | null
  transaction_code: string | null    // 'S' | 'P' | 'M' | 'G' | 'F' | ...
  acquired_or_disposed: string | null // 'A' | 'D'
  source_url: string | null
  created_at: string
}

export interface HfActivity {
  id: string
  company_id: string
  snapshot_date: string
  org_slug: string
  model_count: number
  total_downloads_30d: number
  top_model_id: string | null
  top_model_downloads: number | null
  last_release_date: string | null
  created_at: string
}

export interface ModelLeaderboardEntry {
  id: string
  snapshot_date: string
  source: string                            // 'lmarena' | 'artificialanalysis'
  model_name: string                        // e.g. 'claude-opus-4-7-thinking'
  company_id: string | null                 // null if not in DB
  elo_score: number | null                  // nullable; LMArena public page doesn't expose
  elo_rank: number                          // 1 = best. Always populated.
  params_b: number | null                   // model size in B params (best-effort)
  license: string | null                    // 'open' | 'closed' | 'unknown'
  created_at: string
}

export interface SocialMention {
  id: string
  company_id: string
  snapshot_date: string
  source: string // 'hn' | 'reddit'
  mentions_24h: number
  mentions_7d: number
  top_post_url: string | null
  top_post_title: string | null
  top_post_score: number | null
  top_post_comments: number | null
  sample_subreddits: string[] | null
  created_at: string
}

export interface GithubActivity {
  id: string
  company_id: string
  snapshot_date: string
  repo_full_name: string                // e.g. "openai/openai-python"
  stars: number
  prs_30d_merged: number
  prs_30d_open: number
  contributors_30d: number
  last_release_tag: string | null
  last_release_date: string | null
  created_at: string
}

export interface PatentSnapshotRow {
  id: string
  company_id: string
  snapshot_date: string
  ttm_count: number
  top_subclasses: Array<{ code: string; count: number }>      // jsonb top 3 CPC subclasses
  recent_titles: Array<{ title: string; filingDate: string }> // jsonb top 3 most recent
  source: string
  created_at: string
}

export interface JobSnapshotRow {
  id: string
  company_id: string
  snapshot_date: string
  total_open: number
  top_categories: Array<{ name: string; count: number }>  // jsonb full set, sorted desc by count
  source_provider: string  // 'greenhouse' | 'lever' | 'ashby'
  source_slug: string
  created_at: string
}

export interface GpuSpotPrice {
  id: string
  snapshot_date: string
  gpu_model: string                  // 'H100 80GB SXM5' | 'A100 80GB' | 'RTX 4090' | ...
  median_usd_per_hour: number
  p25_usd_per_hour: number | null
  p75_usd_per_hour: number | null
  listing_count: number
  listing_count_by_region: Record<string, number> | null  // Vast.ai only: {"US":34,"DE":8}
  source: 'vast.ai' | 'runpod' | 'blended'
  created_at: string
}

export interface GpuHyperscalerPricing {
  id: string
  snapshot_date: string
  gpu_model: string                   // 'H100 80GB SXM5' | 'H200' | 'B200' | 'A100 80GB'
  provider: string                    // 'aws' | 'azure' | 'gcp'
  region: string                      // provider-native region: 'us-east-1', 'eastus'
  spot_usd_per_gpu_hour: number | null
  on_demand_usd_per_gpu_hour: number | null
  created_at: string
}

export interface Fundamental {
  id: string
  company_id: string
  period: string        // YYYY-MM-DD (period-end)
  period_type: string   // 'TTM' | 'Q' | 'FY'
  metric: string        // 'revenue' | 'gross_profit' | 'operating_income' | 'net_income' | 'capex' | 'fcf'
  value: number         // raw dollars
  unit: string
  source: string
  updated_at: string
}

export interface CompanyBacker {
  company_id: string
  investor_id: string
}

export interface Flow {
  id: string
  from_id: string
  from_kind: NodeKind
  to_id: string
  to_kind: NodeKind
  type: FlowType
  magnitude: number
  note: string | null
  created_at: string
}

export interface Bottleneck {
  id: string
  name: string
  between_above: string | null
  between_below: string | null
  layer_id: string | null
  severity: string | null
  status: string | null
  timeline: string | null
  evidence: string | null
  created_at: string
  updated_at: string
}

export interface BottleneckBeneficiary {
  bottleneck_id: string
  company_id: string
}

export interface Signal {
  id: string
  date: string
  source: string | null
  headline: string
  impact: string | null
  url: string | null
  accession_number: string | null // SEC filings only; unique
  form_type: string | null        // '8-K' | '10-Q' | '10-K' | '13F' ...
  created_at: string
}

export interface Verification {
  id: string
  claim: string
  source: string | null
  what_would_need_to_be_true: string | null
  verdict: string | null
  confidence: number | null
  created_at: string
}

// Supabase client generic — minimal shape so createClient<Database> typechecks.
// The Database type below is intentionally light. When you adopt `supabase gen types`,
// it will produce a much richer interface and this can be deleted.
export interface Database {
  public: {
    Tables: {
      layers: { Row: Layer; Insert: Layer; Update: Partial<Layer> }
      investors: { Row: Investor; Insert: Omit<Investor, 'created_at' | 'cik' | 'files_13f'> & { created_at?: string; cik?: string | null; files_13f?: boolean }; Update: Partial<Investor> }
      companies: { Row: Company; Insert: Omit<Company, 'created_at' | 'updated_at' | 'cusip' | 'cik' | 'discovered_via' | 'discovered_at'> & { created_at?: string; updated_at?: string; cusip?: string | null; cik?: string | null; discovered_via?: string | null; discovered_at?: string | null }; Update: Partial<Company> }
      holdings: { Row: Holding; Insert: Omit<Holding, 'id' | 'created_at'> & { id?: string; created_at?: string }; Update: Partial<Holding> }
      fundamentals: { Row: Fundamental; Insert: Omit<Fundamental, 'id' | 'updated_at'> & { id?: string; updated_at?: string }; Update: Partial<Fundamental> }
      insider_transactions: { Row: InsiderTransaction; Insert: Omit<InsiderTransaction, 'id' | 'created_at'> & { id?: string; created_at?: string }; Update: Partial<InsiderTransaction> }
      funding_rounds: { Row: FundingRound; Insert: Omit<FundingRound, 'id' | 'created_at'> & { id?: string; created_at?: string }; Update: Partial<FundingRound> }
      transcript_signals: { Row: TranscriptSignal; Insert: Omit<TranscriptSignal, 'id' | 'created_at'> & { id?: string; created_at?: string }; Update: Partial<TranscriptSignal> }
      hf_activity: { Row: HfActivity; Insert: Omit<HfActivity, 'id' | 'created_at'> & { id?: string; created_at?: string }; Update: Partial<HfActivity> }
      model_leaderboard: { Row: ModelLeaderboardEntry; Insert: Omit<ModelLeaderboardEntry, 'id' | 'created_at'> & { id?: string; created_at?: string }; Update: Partial<ModelLeaderboardEntry> }
      github_activity: { Row: GithubActivity; Insert: Omit<GithubActivity, 'id' | 'created_at'> & { id?: string; created_at?: string }; Update: Partial<GithubActivity> }
      social_mentions: { Row: SocialMention; Insert: Omit<SocialMention, 'id' | 'created_at'> & { id?: string; created_at?: string }; Update: Partial<SocialMention> }
      interest_signals: { Row: InterestSignal; Insert: Omit<InterestSignal, 'id' | 'created_at'> & { id?: string; created_at?: string }; Update: Partial<InterestSignal> }
      patent_snapshots: { Row: PatentSnapshotRow; Insert: Omit<PatentSnapshotRow, 'id' | 'created_at'> & { id?: string; created_at?: string }; Update: Partial<PatentSnapshotRow> }
      job_snapshots: { Row: JobSnapshotRow; Insert: Omit<JobSnapshotRow, 'id' | 'created_at'> & { id?: string; created_at?: string }; Update: Partial<JobSnapshotRow> }
      gpu_spot_prices: { Row: GpuSpotPrice; Insert: Omit<GpuSpotPrice, 'id' | 'created_at'> & { id?: string; created_at?: string }; Update: Partial<GpuSpotPrice> }
      gpu_hyperscaler_pricing: { Row: GpuHyperscalerPricing; Insert: Omit<GpuHyperscalerPricing, 'id' | 'created_at'> & { id?: string; created_at?: string }; Update: Partial<GpuHyperscalerPricing> }
      grid_demand_snapshots: { Row: GridDemandSnapshot; Insert: Omit<GridDemandSnapshot, 'id' | 'created_at'> & { id?: string; created_at?: string }; Update: Partial<GridDemandSnapshot> }
      eia_commodity_snapshots: { Row: EiaCommoditySnapshot; Insert: Omit<EiaCommoditySnapshot, 'id' | 'created_at'> & { id?: string; created_at?: string }; Update: Partial<EiaCommoditySnapshot> }
      eia_fuelmix_snapshots: { Row: EiaFuelMixSnapshot; Insert: Omit<EiaFuelMixSnapshot, 'id' | 'created_at'> & { id?: string; created_at?: string }; Update: Partial<EiaFuelMixSnapshot> }
      eia_international_snapshots: { Row: EiaInternationalSnapshot; Insert: Omit<EiaInternationalSnapshot, 'id' | 'created_at'> & { id?: string; created_at?: string }; Update: Partial<EiaInternationalSnapshot> }
      aeo_projections: { Row: AeoProjection; Insert: Omit<AeoProjection, 'id' | 'extracted_at'> & { id?: string; extracted_at?: string }; Update: Partial<AeoProjection> }
      company_backers: { Row: CompanyBacker; Insert: CompanyBacker; Update: Partial<CompanyBacker> }
      flows: { Row: Flow; Insert: Partial<Pick<Flow, 'id' | 'created_at' | 'note'>> & Omit<Flow, 'id' | 'created_at' | 'note'> & { note?: string | null }; Update: Partial<Flow> }
      bottlenecks: { Row: Bottleneck; Insert: Omit<Bottleneck, 'created_at' | 'updated_at'> & { created_at?: string; updated_at?: string }; Update: Partial<Bottleneck> }
      bottleneck_beneficiaries: { Row: BottleneckBeneficiary; Insert: BottleneckBeneficiary; Update: Partial<BottleneckBeneficiary> }
      signals: { Row: Signal; Insert: Omit<Signal, 'id' | 'created_at'> & { id?: string; created_at?: string }; Update: Partial<Signal> }
      signal_companies: { Row: { signal_id: string; company_id: string }; Insert: { signal_id: string; company_id: string }; Update: Partial<{ signal_id: string; company_id: string }> }
      signal_bottlenecks: { Row: { signal_id: string; bottleneck_id: string }; Insert: { signal_id: string; bottleneck_id: string }; Update: Partial<{ signal_id: string; bottleneck_id: string }> }
      verifications: { Row: Verification; Insert: Omit<Verification, 'id' | 'created_at'> & { id?: string; created_at?: string }; Update: Partial<Verification> }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: {
      flow_type: FlowType
      node_kind: NodeKind
    }
  }
}

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
  eia_region: string | null  // EIA balancing-authority code ('PJM', 'ERCO', 'FLA', 'US48')
  assignee_name: string | null  // USPTO assignee name for patent search (e.g. 'NVIDIA Corporation')
  created_at: string
  updated_at: string
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
      hf_activity: { Row: HfActivity; Insert: Omit<HfActivity, 'id' | 'created_at'> & { id?: string; created_at?: string }; Update: Partial<HfActivity> }
      patent_snapshots: { Row: PatentSnapshotRow; Insert: Omit<PatentSnapshotRow, 'id' | 'created_at'> & { id?: string; created_at?: string }; Update: Partial<PatentSnapshotRow> }
      job_snapshots: { Row: JobSnapshotRow; Insert: Omit<JobSnapshotRow, 'id' | 'created_at'> & { id?: string; created_at?: string }; Update: Partial<JobSnapshotRow> }
      grid_demand_snapshots: { Row: GridDemandSnapshot; Insert: Omit<GridDemandSnapshot, 'id' | 'created_at'> & { id?: string; created_at?: string }; Update: Partial<GridDemandSnapshot> }
      eia_commodity_snapshots: { Row: EiaCommoditySnapshot; Insert: Omit<EiaCommoditySnapshot, 'id' | 'created_at'> & { id?: string; created_at?: string }; Update: Partial<EiaCommoditySnapshot> }
      eia_fuelmix_snapshots: { Row: EiaFuelMixSnapshot; Insert: Omit<EiaFuelMixSnapshot, 'id' | 'created_at'> & { id?: string; created_at?: string }; Update: Partial<EiaFuelMixSnapshot> }
      eia_international_snapshots: { Row: EiaInternationalSnapshot; Insert: Omit<EiaInternationalSnapshot, 'id' | 'created_at'> & { id?: string; created_at?: string }; Update: Partial<EiaInternationalSnapshot> }
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

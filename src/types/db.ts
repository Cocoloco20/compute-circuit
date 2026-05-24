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
  created_at: string
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

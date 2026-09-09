import { supabaseServiceRole } from '@/lib/supabase/service-role'
import type {
  Decision, DecisionResurfacing, PipelineCard, Note, YcCompany, ResurfaceVerdict,
  CompanyBrief,
} from '@/types/db'

/**
 * Data for /company/[id] — everything known about one company, in one read.
 *
 * SERVICE ROLE ONLY: decisions, notes and pipeline_cards are RLS-locked with
 * zero policies. Server components only.
 *
 * Every section is independently non-fatal. A company with no funding rounds
 * and no signals is the common case for the 10k reference-layer names, and it
 * must render as a real (if quiet) page rather than an error.
 */

export interface Backer { id: string; name: string; domain: string | null }

export interface CompanyHeader {
  id: string
  name: string
  ticker: string | null
  domain: string | null
  sector: string | null
  country: string | null
  isPrivate: boolean
  lastPrice: number | null
  priceUpdatedAt: string | null
  thesis: string | null
  thesisRisk: string | null
  /** null = we discovered it ourselves; otherwise the investor id that surfaced it. */
  discoveredVia: string | null
}

export interface SignalItem {
  kind: 'FundingRound' | 'Filing' | 'News'
  date: string
  title: string
  detail: string | null
  url: string | null
}

export interface DecisionWithVerdicts extends Decision {
  resurfacings: Array<Pick<DecisionResurfacing,
    'id' | 'trigger_kind' | 'trigger_summary' | 'trigger_date' | 'trigger_url'
    | 'verdict' | 'verdict_at' | 'created_at'>>
}

export interface CompanyPage {
  header: CompanyHeader
  brief: CompanyBrief | null
  backers: Backer[]
  yc: YcCompany | null
  card: PipelineCard | null
  decisions: DecisionWithVerdicts[]
  signals: SignalItem[]
  notes: Note[]
}

function usd(n: number | null): string {
  if (n == null) return 'undisclosed'
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  return `$${Math.round(n).toLocaleString('en-US')}`
}

async function safe<T>(run: () => Promise<T>, fallback: T): Promise<T> {
  try { return await run() } catch { return fallback }
}

export async function fetchCompany(id: string): Promise<CompanyPage | null> {
  const sb = supabaseServiceRole()

  const { data: coRaw, error } = await sb
    .from('companies').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  if (!coRaw) return null
  const co = coRaw as unknown as {
    id: string; name: string; ticker: string | null; domain: string | null
    layer_id: string | null; country: string | null; private: boolean
    last_price: number | null; price_updated_at: string | null
    thesis: string | null; thesis_ai: string | null; thesis_risk_ai: string | null
    discovered_via: string | null
  }

  const [backers, yc, card, decisions, notes, funding, filings, brief] = await Promise.all([
    // ---- who else is in -------------------------------------------------
    safe<Backer[]>(async () => {
      const { data } = await sb.from('company_backers').select('investor_id').eq('company_id', id)
      const ids = ((data ?? []) as unknown as Array<{ investor_id: string }>).map(b => b.investor_id)
      if (!ids.length) return []
      const { data: inv } = await sb.from('investors').select('id, name, domain').in('id', ids)
      return ((inv ?? []) as unknown as Backer[]).sort((a, b) => a.name.localeCompare(b.name))
    }, []),

    safe<YcCompany | null>(async () => {
      const { data } = await sb.from('yc_companies').select('*').eq('company_id', id).maybeSingle()
      return (data as unknown as YcCompany) ?? null
    }, null),

    safe<PipelineCard | null>(async () => {
      const { data } = await sb.from('pipeline_cards').select('*').eq('company_id', id).maybeSingle()
      return (data as unknown as PipelineCard) ?? null
    }, null),

    // ---- decision history, with how each one turned out ------------------
    safe<DecisionWithVerdicts[]>(async () => {
      const { data } = await sb.from('decisions').select('*')
        .eq('company_id', id).order('decided_at', { ascending: false })
      const ds = (data ?? []) as unknown as Decision[]
      if (!ds.length) return []
      const { data: rs } = await sb.from('decision_resurfacings').select('*')
        .in('decision_id', ds.map(d => d.id)).order('created_at', { ascending: false })
      const byDecision = new Map<string, DecisionResurfacing[]>()
      for (const r of ((rs ?? []) as unknown as DecisionResurfacing[])) {
        byDecision.set(r.decision_id, [...(byDecision.get(r.decision_id) ?? []), r])
      }
      return ds.map(d => ({ ...d, resurfacings: byDecision.get(d.id) ?? [] }))
    }, []),

    safe<Note[]>(async () => {
      const { data } = await sb.from('notes').select('*')
        .eq('company_id', id).order('created_at', { ascending: false }).limit(20)
      return (data ?? []) as unknown as Note[]
    }, []),

    // ---- funding rounds --------------------------------------------------
    safe<SignalItem[]>(async () => {
      const { data } = await sb.from('funding_rounds')
        .select('filed_date, total_amount_sold_usd, investors_named, source_url')
        .eq('company_id', id).order('filed_date', { ascending: false }).limit(20)
      return ((data ?? []) as unknown as Array<{
        filed_date: string; total_amount_sold_usd: number | null
        investors_named: string[] | null; source_url: string | null
      }>).map(f => ({
        kind: 'FundingRound' as const,
        date: f.filed_date,
        title: `Raised ${usd(f.total_amount_sold_usd)}`,
        detail: f.investors_named?.length
          ? `Named: ${f.investors_named.slice(0, 4).join(', ')}`
          : 'SEC Form D',
        url: f.source_url,
      }))
    }, []),

    // ---- filings / news via the signal join ------------------------------
    safe<SignalItem[]>(async () => {
      const { data: links } = await sb.from('signal_companies')
        .select('signal_id').eq('company_id', id).limit(60)
      const ids = ((links ?? []) as unknown as Array<{ signal_id: string }>).map(l => l.signal_id)
      if (!ids.length) return []
      const { data } = await sb.from('signals')
        .select('date, headline, source, url, form_type')
        .in('id', ids).order('date', { ascending: false }).limit(30)
      return ((data ?? []) as unknown as Array<{
        date: string; headline: string; source: string | null
        url: string | null; form_type: string | null
      }>).map(s => ({
        kind: (s.form_type ? 'Filing' : 'News') as 'Filing' | 'News',
        date: s.date,
        title: s.headline,
        detail: s.form_type ?? s.source,
        url: s.url,
      }))
    }, []),

    // What the company says it does, in its own words (migration 0053).
    safe<CompanyBrief | null>(async () => {
      const { data } = await sb.from('company_briefs').select('*').eq('company_id', id).maybeSingle()
      return (data as unknown as CompanyBrief) ?? null
    }, null),
  ])

  const signals = [...funding, ...filings]
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 40)

  return {
    header: {
      id: co.id,
      name: co.name,
      ticker: co.ticker,
      domain: co.domain,
      sector: co.layer_id,
      country: co.country,
      isPrivate: co.private,
      lastPrice: co.last_price,
      priceUpdatedAt: co.price_updated_at,
      // The hand-written thesis wins over the generated one when both exist.
      thesis: co.thesis || co.thesis_ai,
      thesisRisk: co.thesis_risk_ai,
      discoveredVia: co.discovered_via,
    },
    backers, yc, card, decisions, notes, signals, brief,
  }
}

export function verdictLabel(v: ResurfaceVerdict | null): string {
  return v === 'No' ? 'reasoning was wrong'
    : v === 'Partially' ? 'partly right'
    : v === 'Yes' ? 'reasoning held'
    : 'awaiting verdict'
}

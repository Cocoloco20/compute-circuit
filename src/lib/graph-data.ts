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
  const signals = (s.data ?? []) as Signal[]
  const sigIds = signals.map(x => x.id)
  const sc = sigIds.length > 0
    ? await sb.from('signal_companies').select('*').in('signal_id', sigIds)
    : { data: [], error: null }

  const errors = [l, i, c, b, f, bn, bb, s, sc].map(r => r.error).filter(Boolean)
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
  }
}

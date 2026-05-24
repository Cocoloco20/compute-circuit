import { supabaseServer } from './supabase/server'
import type {
  Layer,
  Investor,
  Company,
  CompanyBacker,
  Flow,
  Bottleneck,
  BottleneckBeneficiary,
} from '@/types/db'

export interface GraphData {
  layers: Layer[]
  investors: Investor[]
  companies: Company[]
  backers: CompanyBacker[]
  flows: Flow[]
  bottlenecks: Bottleneck[]
  bottleneckBeneficiaries: BottleneckBeneficiary[]
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
  const [l, i, c, b, f, bn, bb] = await Promise.all([
    sb.from('layers').select('*').order('order_index'),
    sb.from('investors').select('*').order('name'),
    sb.from('companies').select('*').order('name'),
    sb.from('company_backers').select('*'),
    sb.from('flows').select('*'),
    sb.from('bottlenecks').select('*'),
    sb.from('bottleneck_beneficiaries').select('*'),
  ])
  const errors = [l, i, c, b, f, bn, bb].map(r => r.error).filter(Boolean)
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
  }
}

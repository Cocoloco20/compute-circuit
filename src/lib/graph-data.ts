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
  HfActivity,
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
  hfActivity: HfActivity[]        // latest HF snapshot per company
  lastUpdates: {                  // GasCity-style "instrument is live" telemetry
    price: string | null          // ISO of most-recent companies.price_updated_at
    news: string | null           // most-recent signals.date where source='google-news'
    filings: string | null        // most-recent signals.date where source='sec-edgar'
    insider: string | null        // most-recent insider_transactions.filing_date
    hf: string | null             // most-recent hf_activity.snapshot_date
    holdings: string | null       // most-recent holdings.period
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

  // HF activity: most recent snapshot per company. With ~20 hf-tagged cos
  // × 1 snapshot/day this is trivial.
  const hf = await sb
    .from('hf_activity')
    .select('*')
    .order('snapshot_date', { ascending: false })
    .limit(200)

  const errors = [l, i, c, b, f, bn, bb, s, sc, h, fnd, ins, hf].map(r => r.error).filter(Boolean)
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
    hfActivity: (hf.data ?? []) as HfActivity[],
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
      hf: ((hf.data ?? []) as HfActivity[])
        .map(x => x.snapshot_date)
        .sort()
        .at(-1) ?? null,
      holdings: ((h.data ?? []) as Holding[])
        .map(x => x.period)
        .sort()
        .at(-1) ?? null,
    },
  }
}

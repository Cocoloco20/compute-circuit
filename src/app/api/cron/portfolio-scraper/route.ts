import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

import { discoverAcrossInvestors } from '@/lib/scrapers/edgar-form-d'
import {
  SCRAPER_CONFIGS,
  normalizeName,
  slugifyName,
} from '@/lib/scrapers/index'
import type { Database } from '@/types/db'

/**
 * Portfolio scraper — runs once a month (or on manual curl).
 *
 * For each enabled investor:
 *   1) Hit EDGAR Form D full-text search for the investor's name.
 *   2) Get the set of unique issuers (= companies that raised money mentioning
 *      this VC).
 *   3) For each issuer, try to match an existing company by:
 *        a) CIK (companies.cik = issuer cik)
 *        b) Normalized name (strip corp suffixes, uppercase)
 *   4) If no match, INSERT a new company row with layer_id=null (so it stays
 *      out of the 3D graph until manually curated) and discovered_via=<vc id>.
 *   5) Either way, upsert into company_backers to record the relationship.
 *
 * The graph component already filters to companies with layer_id set, so
 * the visual stays clean even as the discovered-company set grows.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60 // Vercel Hobby plan max

interface InvestorRow {
  id: string
  name: string
}
interface CompanyMatch {
  id: string
  name: string
  cik: string | null
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return NextResponse.json({ error: 'supabase env missing' }, { status: 500 })

  const sb = createClient<Database>(url, key, { auth: { persistSession: false } })

  // ----- pull existing companies + investors -----
  const [coResp, invResp] = await Promise.all([
    sb.from('companies').select('id, name, cik'),
    sb.from('investors').select('id, name'),
  ])
  if (coResp.error) return NextResponse.json({ error: coResp.error.message }, { status: 500 })
  if (invResp.error) return NextResponse.json({ error: invResp.error.message }, { status: 500 })

  const companies = (coResp.data ?? []) as CompanyMatch[]
  const investors = (invResp.data ?? []) as InvestorRow[]
  const knownInvestorIds = new Set(investors.map(i => i.id))

  // Build match indices
  const byCik = new Map<string, CompanyMatch>()
  const byName = new Map<string, CompanyMatch>()
  for (const c of companies) {
    if (c.cik) byCik.set(c.cik, c)
    byName.set(normalizeName(c.name), c)
  }

  // ----- discover via Form D -----
  const enabled = SCRAPER_CONFIGS.filter(
    (cfg): cfg is { id: string; term: string } => !!cfg.term && knownInvestorIds.has(cfg.id),
  )
  const startedAt = Date.now()
  const discovered = await discoverAcrossInvestors(enabled)
  const fetchMs = Date.now() - startedAt

  // ----- map each discovery → either existing company or a new one to insert -----
  type Insert = {
    id: string
    name: string
    domain: null
    layer_id: null
    weight: number
    private: boolean
    position_held: boolean
    conviction: null
    thesis: null
    share: null
    notes: null
    cik: string
    cusip: null
    discovered_via: string
    discovered_at: string
  }
  const newCompanies: Insert[] = []
  const newCompanyIdsByCik = new Map<string, string>() // cik → assigned slug id
  const usedSlugs = new Set(companies.map(c => c.id))

  function makeUniqueSlug(name: string, cik: string): string {
    const base = slugifyName(name) || `co-${cik}`
    let s = base
    let i = 2
    while (usedSlugs.has(s)) s = `${base}-${i++}`
    usedSlugs.add(s)
    return s
  }

  // Each "discovery" links discovery.via (investor.id) → some company.id.
  // We resolve company.id either to an existing one OR a newly-staged insert.
  interface BackerLink {
    company_id: string
    investor_id: string
  }
  const newLinks: BackerLink[] = []
  const linkSeen = new Set<string>()
  const nowIso = new Date().toISOString()

  for (const d of discovered) {
    let coId: string | undefined
    const existingByCik = byCik.get(d.cik)
    const existingByName = byName.get(normalizeName(d.name))
    if (existingByCik) {
      coId = existingByCik.id
    } else if (existingByName) {
      coId = existingByName.id
      // If existing didn't have a CIK, this is a free upgrade — but we don't
      // mutate here to avoid clobbering hand-curated rows. (Worth adding later
      // as a separate cusip-style backfill.)
    } else {
      // Brand new company. Either a previous loop iteration already added it
      // (multiple VCs co-investing in the same round both surface the same issuer).
      const stagedId = newCompanyIdsByCik.get(d.cik)
      if (stagedId) {
        coId = stagedId
      } else {
        const slug = makeUniqueSlug(d.name, d.cik)
        newCompanyIdsByCik.set(d.cik, slug)
        newCompanies.push({
          id: slug,
          name: d.name,
          domain: null,
          layer_id: null,
          weight: 1,
          private: true,
          position_held: false,
          conviction: null,
          thesis: null,
          share: null,
          notes: null,
          cik: d.cik,
          cusip: null,
          discovered_via: d.via,
          discovered_at: nowIso,
        })
        coId = slug
      }
    }

    if (!coId) continue
    const linkKey = `${coId}|${d.via}`
    if (linkSeen.has(linkKey)) continue
    linkSeen.add(linkKey)
    newLinks.push({ company_id: coId, investor_id: d.via })
  }

  // ----- write new companies -----
  let companiesInserted = 0
  if (newCompanies.length > 0) {
    const ins = await (sb.from('companies') as unknown as {
      upsert: (rows: Insert[], opts: { onConflict: string; ignoreDuplicates: boolean }) =>
        Promise<{ error: { message: string } | null }>
    }).upsert(newCompanies, { onConflict: 'id', ignoreDuplicates: true })
    if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 })
    companiesInserted = newCompanies.length
  }

  // ----- write backer links (idempotent on (company_id, investor_id) PK) -----
  let linksInserted = 0
  if (newLinks.length > 0) {
    const ins = await (sb.from('company_backers') as unknown as {
      upsert: (rows: BackerLink[], opts: { onConflict: string; ignoreDuplicates: boolean }) =>
        Promise<{ error: { message: string } | null }>
    }).upsert(newLinks, { onConflict: 'company_id,investor_id', ignoreDuplicates: true })
    if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 })
    linksInserted = newLinks.length
  }

  // Per-investor summary
  const byVia = new Map<string, { discovered: number; existed: number; new: number }>()
  for (const d of discovered) {
    const e = byVia.get(d.via) ?? { discovered: 0, existed: 0, new: 0 }
    e.discovered++
    const matched = byCik.get(d.cik) ?? byName.get(normalizeName(d.name))
    if (matched) e.existed++
    else e.new++
    byVia.set(d.via, e)
  }

  return NextResponse.json({
    ok: true,
    scanned: enabled.length,
    fetched: discovered.length,
    companiesInserted,
    linksInserted,
    fetchMs,
    perInvestor: Object.fromEntries(byVia),
  })
}

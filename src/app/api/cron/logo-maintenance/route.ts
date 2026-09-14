import { selfOrigin } from '@/lib/self-origin'
import { startBudget, DEFAULT_FETCH_BUDGET_MS } from '@/lib/cron-budget'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/service-role'
import { resolveDomainForCompany, verifyLogoForDomain } from '@/lib/logo-resolver'

/**
 * Daily logo-maintenance cron.
 *
 * Ensures every company has a usable logo asset within ~24h of being added.
 *
 * Work selection: rows where logo_status IS NULL OR IN ('pending','missing')
 * OR logo_verified_at < now() - 30d. The last clause re-checks rows that
 * went 'fallback' or 'verified' a month+ ago, in case the upstream favicon
 * was finally added (gstatic can take weeks to crawl a new domain).
 *
 * Politeness: capped at 30 cos per run (3 HTTP calls each in the worst case
 * = 90 outbound requests). Wikipedia is the heavy dependency — they're
 * tolerant of this volume per UA.
 *
 * For each row:
 *   1. If companies.domain is null → resolveDomainForCompany(name, ticker)
 *      and persist the result (even if null — that just bumps verified_at
 *      so we don't re-try tomorrow).
 *   2. If a domain exists (pre-existing or newly resolved), call
 *      verifyLogoForDomain to classify the proxy response.
 *   3. Upsert logo_status + logo_verified_at.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface CoRow {
  id: string
  name: string
  ticker: string | null
  domain: string | null
  logo_status: string | null
  logo_verified_at: string | null
}

interface RunResult {
  id: string
  name: string
  domain_before: string | null
  domain_after: string | null
  resolver_source: string | null
  status_after: 'verified' | 'fallback' | 'missing'
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const sb = supabaseServiceRole()
  // Never the inbound Host — see selfOrigin() for the 90-day outage that caused.
  const baseUrl = selfOrigin(req)
  // Upper bound on rows pulled per run; the budget below decides how many
  // are actually processed. 30 was sized for a fixed loop and left 12,676
  // companies queued at 30/night; the budget makes a larger pull safe.
  const BATCH = 120

  // Two pools:
  //   A) rows that have never been resolved (logo_status pending/missing/null) — highest priority
  //   B) rows whose verified_at is older than 30 days (refresh pass)
  // Fill BATCH from A first, top up from B.
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString()

  const sbCos = sb.from('companies')
  const aResp = await sbCos
    .select('id, name, ticker, domain, logo_status, logo_verified_at')
    .or('logo_status.is.null,logo_status.eq.pending,logo_status.eq.missing')
    .limit(BATCH)
  if (aResp.error) {
    return NextResponse.json({ error: 'select A failed: ' + aResp.error.message }, { status: 500 })
  }
  let pool = (aResp.data ?? []) as CoRow[]

  if (pool.length < BATCH) {
    const remaining = BATCH - pool.length
    const bResp = await sbCos
      .select('id, name, ticker, domain, logo_status, logo_verified_at')
      .lt('logo_verified_at', thirtyDaysAgo)
      .order('logo_verified_at', { ascending: true })
      .limit(remaining)
    if (!bResp.error) {
      const seen = new Set(pool.map(c => c.id))
      pool = pool.concat(((bResp.data ?? []) as CoRow[]).filter(c => !seen.has(c.id)))
    }
  }

  if (pool.length === 0) {
    return NextResponse.json({ ok: true, scanned: 0, note: 'no work' })
  }

  const results: RunResult[] = []
  const nowIso = new Date().toISOString()

  // Each company costs up to ~15s (Wikipedia + DuckDuckGo lookups, then a
  // self-call to /api/logo that walks six providers). 30 of those never fit
  // in 60s; the loop now stops when the budget is gone and the untouched
  // rows stay pending/missing for tomorrow's batch.
  const budget = startBudget(DEFAULT_FETCH_BUDGET_MS)
  let skipped = 0

  for (const co of pool) {
    if (budget.expired()) { skipped++; continue }
    let domain = co.domain
    let source: string | null = null

    // Step 1: resolve a domain if we don't have one.
    // Domain discovery is the slow half; skip it (verify-only) when the
    // budget can't absorb it, rather than overrunning the kill line.
    if (!domain && budget.remaining() > 20_000) {
      const resolved = await resolveDomainForCompany(co.name, co.ticker)
      if (resolved) {
        domain = resolved.domain
        source = resolved.source
      }
    }

    // Step 2: verify what we have (or skip if no domain at all).
    let status: 'verified' | 'fallback' | 'missing' = 'missing'
    if (domain) {
      status = await verifyLogoForDomain(domain, baseUrl)
    }

    // Step 3: persist. Update domain only if we resolved a new one (don't
    // clobber a manually-curated domain with null).
    // The supabase-js Update generic is strict — wrap the call in the same
    // unknown-cast pattern used by other cron routes (prices/13f-tracker).
    const patch: Record<string, string | null> = {
      logo_status: status,
      logo_verified_at: nowIso,
    }
    if (!co.domain && domain) patch.domain = domain
    const upd = await (sb.from('companies') as unknown as {
      update: (p: typeof patch) => { eq: (col: string, val: string) => Promise<{ error: { message: string } | null }> }
    }).update(patch).eq('id', co.id)
    if (upd.error) {
      // eslint-disable-next-line no-console
      console.warn('[logo-maintenance] update failed for', co.name, upd.error.message)
    }

    results.push({
      id: co.id,
      name: co.name,
      domain_before: co.domain,
      domain_after: domain,
      resolver_source: source,
      status_after: status,
    })
  }

  const summary = {
    verified: results.filter(r => r.status_after === 'verified').length,
    fallback: results.filter(r => r.status_after === 'fallback').length,
    missing: results.filter(r => r.status_after === 'missing').length,
    newDomains: results.filter(r => !r.domain_before && r.domain_after).length,
    skippedForBudget: skipped,
    budgetExhausted: budget.expired(),
  }

  return NextResponse.json({
    ok: true,
    scanned: results.length,
    summary,
    results,
  })
}

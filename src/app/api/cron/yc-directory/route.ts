import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/service-role'
import { normalizeYc, isPrivate, YC_INVESTOR_ID, type YcRecord } from '@/lib/yc'

/**
 * Keep the YC directory current from its daily change feed.
 *
 * The bulk import is scripts/import-yc.ts — 6,204 records do not belong in a
 * 60s function. This applies only the delta, which is small: on 2026-09-08 it
 * was 2 added, 1 removed, 56 updated. Pulling the full 10.4MB all.json every
 * night to find ~60 changes would be the wrong trade.
 *
 * Source and its limits are documented in src/lib/yc.ts: unofficial, no
 * LICENSE, internal research use only.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CHANGES_URL = 'https://yc-oss.github.io/api/changes/latest.json'

// types/db.ts keeps the Supabase Database generic deliberately light, so
// upsert() widens its argument to never[]. Same cast the other routes use.
type UpsertTable = {
  upsert: (rows: unknown[], opts: { onConflict: string }) =>
    Promise<{ error: { message: string } | null }>
}

/** yc_companies columns we keep, mapped from the feed's field names. */
const TRACKED: Record<string, string> = {
  name: 'name',                 // handled separately — it lives on companies
  slug: 'slug',
  batch: 'batch',
  status: 'status',
  industry: 'industry',
  subindustry: 'subindustry',
  team_size: 'team_size',
  one_liner: 'one_liner',
  website: 'website',
  url: 'yc_url',
}

interface ChangeEntry {
  id?: number
  name?: string
  slug?: string
  changed_fields?: string[]
  changes?: Record<string, { before: unknown; after: unknown }>
}
interface ChangesFeed {
  generated_at?: string
  summary?: Record<string, number>
  added?: YcRecord[]
  removed?: ChangeEntry[]
  updated?: ChangeEntry[]
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const sb = supabaseServiceRole()

  let feed: ChangesFeed
  try {
    const r = await fetch(CHANGES_URL, {
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
      headers: { Accept: 'application/json' },
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    feed = (await r.json()) as ChangesFeed
  } catch (err) {
    return NextResponse.json(
      { error: `changes feed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 })
  }

  const added = feed.added ?? []
  const updated = feed.updated ?? []
  const removed = feed.removed ?? []

  // ---- added: new company + metadata + backer link ------------------------
  let addedCount = 0
  const normalized = added.map(normalizeYc).flatMap(n => n ? [n] : [])
  if (normalized.length) {
    // Dedupe by id — Postgres rejects an ON CONFLICT touching a row twice.
    const byId = new Map(normalized.map(n => [n.companyId, n]))
    const rows = [...byId.values()]

    const co = await (sb.from('companies') as unknown as UpsertTable).upsert(rows.map(n => ({
      id: n.companyId,
      name: n.name,
      ticker: null,
      domain: null,
      layer_id: null,            // stays out of the curated 3D graph
      weight: 0,
      private: isPrivate(n.status),
      position_held: false,
      discovered_via: YC_INVESTOR_ID,
      discovered_at: new Date().toISOString(),
    })), { onConflict: 'id' })
    if (co.error) return NextResponse.json({ error: co.error.message }, { status: 500 })

    const meta = await (sb.from('yc_companies') as unknown as UpsertTable).upsert(rows.map(n => ({
      company_id: n.companyId,
      yc_id: n.ycId, slug: n.slug, batch: n.batch, status: n.status,
      industry: n.industry, subindustry: n.subindustry, team_size: n.teamSize,
      one_liner: n.oneLiner, website: n.website, yc_url: n.ycUrl,
      top_company: n.topCompany, launched_at: n.launchedAt,
      updated_at: new Date().toISOString(),
    })), { onConflict: 'company_id' })
    if (meta.error) return NextResponse.json({ error: meta.error.message }, { status: 500 })

    await (sb.from('company_backers') as unknown as UpsertTable).upsert(
      rows.map(n => ({ company_id: n.companyId, investor_id: YC_INVESTOR_ID })),
      { onConflict: 'company_id,investor_id' })
    addedCount = rows.length
  }

  // ---- updated: patch only the fields we store ---------------------------
  let updatedCount = 0
  const statusChanges: Array<{ slug: string; from: unknown; to: unknown }> = []
  for (const u of updated) {
    if (!u.slug || !u.changes) continue
    const patch: Record<string, unknown> = {}
    for (const [field, col] of Object.entries(TRACKED)) {
      if (field === 'name') continue          // name lives on companies, not here
      const ch = u.changes[field]
      if (ch && 'after' in ch) patch[col] = ch.after
    }
    // A status change is the single most valuable thing in this feed: it is
    // how a company we passed on shows up as Acquired or Inactive later,
    // which is exactly what the decision-resurfacing job watches for.
    if (u.changes.status) {
      statusChanges.push({ slug: u.slug, from: u.changes.status.before, to: u.changes.status.after })
    }
    if (!Object.keys(patch).length) continue

    patch.updated_at = new Date().toISOString()
    const r = await (sb.from('yc_companies') as unknown as {
      update: (p: Record<string, unknown>) => {
        eq: (c: string, v: string) => Promise<{ error: { message: string } | null }>
      }
    }).update(patch).eq('company_id', `yc-${u.slug}`)
    if (!r.error) updatedCount++
  }

  // ---- persist observed status changes -----------------------------------
  // A status transition is the highest-value thing in this feed: it is how a
  // company later shows up as Acquired, Public or Inactive. Recording the
  // OBSERVED transition (not the current value) is what lets a reader
  // distinguish "this changed after we first saw it" from "this was already
  // true". (The decision-resurfacing cron that consumed these is archived at
  // tag vc-terminal-final; the yc_status_changes table stays.)
  let statusChangesRecorded = 0
  if (statusChanges.length) {
    const rows = statusChanges.map(c => ({
      company_id: `yc-${c.slug}`,
      from_status: c.from == null ? null : String(c.from),
      to_status: String(c.to),
      observed_at: new Date().toISOString(),
    })).filter(r => r.to_status)
    const r = await (sb.from('yc_status_changes') as unknown as UpsertTable).upsert(rows, {
      onConflict: 'company_id,from_status,to_status,observed_at',
    })
    // Non-fatal: the metadata update above already landed, and losing a
    // change row costs one resurfacing card, not correctness of the directory.
    if (!r.error) statusChangesRecorded = rows.length
  }

  // ---- removed: recorded, never deleted ----------------------------------
  // A company dropping out of YC's directory must not delete our row. It may
  // sit in a pipeline card or carry a decision, and destroying that to mirror
  // an upstream feed would lose our own work to someone else's data change.
  return NextResponse.json({
    ok: true,
    generatedAt: feed.generated_at ?? null,
    added: addedCount,
    updated: updatedCount,
    removedReported: removed.length,
    removedSlugs: removed.map(r => r.slug).filter(Boolean).slice(0, 20),
    statusChanges,
    statusChangesRecorded,
  })
}

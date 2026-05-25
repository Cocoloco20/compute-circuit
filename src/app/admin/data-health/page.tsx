/**
 * /admin/data-health — internal pipeline health dashboard.
 *
 * Unlisted (no nav link). Auth = `?key=<CRON_SECRET>` query string.
 * Server-rendered only — no React state, no client JS. Just an HTML
 * table with row counts + freshness colors for every Supabase table
 * and every cron route, so we can spot stale/broken pipelines without
 * digging through Vercel logs or the Supabase dashboard.
 *
 * Why per-table date columns:
 *   most tables track ingest via `created_at` (default now() on insert),
 *   but a few use `snapshot_date` (date-typed, no time) or `extracted_at`
 *   (aeo_projections). The mapping below is hand-maintained — if you add
 *   a new table, add it to TABLE_SPECS too.
 *
 * Freshness buckets (hours since last write):
 *   green  <26h   — fresh (daily crons run ~once/24h)
 *   amber  26-72h — stale (one or two missed runs)
 *   red    >72h   — broken (>3 days; cron likely failing)
 *   gray   0 rows — empty (table exists, nothing's ever been written)
 *
 * Tables not present in the DB (e.g. ir_snapshots before its migration
 * lands) show up as "missing" so you immediately see what's not built yet.
 */

import { supabaseServiceRole } from '@/lib/supabase/service-role'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

// ---- Config -----------------------------------------------------------------

/**
 * Per-table spec:
 *   table       — Postgres table name
 *   dateCol     — column to read for "last write" (usually created_at)
 *   notes       — short human description shown in the Notes column
 *
 * Order doesn't matter — rows get re-sorted by status before render.
 */
interface TableSpec {
  table: string
  dateCol: string
  notes: string
}

const TABLE_SPECS: TableSpec[] = [
  // core taxonomy — seeded once, low-churn
  { table: 'companies',                  dateCol: 'updated_at',     notes: 'core: 105+ tracked cos' },
  { table: 'layers',                     dateCol: 'order_index',    notes: 'core: seeded once' },
  { table: 'investors',                  dateCol: 'created_at',     notes: 'core: 13F filers + VCs' },
  { table: 'flows',                      dateCol: 'created_at',     notes: 'core: capital/compute edges' },
  { table: 'bottlenecks',                dateCol: 'updated_at',     notes: 'core: seeded' },
  // signals stream
  { table: 'signals',                    dateCol: 'created_at',     notes: 'news + 8-K + form-d unified feed' },
  { table: 'signal_companies',           dateCol: null as unknown as string, notes: 'junction: signal <-> co' },
  // market + fundamentals
  { table: 'holdings',                   dateCol: 'created_at',     notes: 'cron: 13f (Sundays)' },
  { table: 'fundamentals',               dateCol: 'updated_at',     notes: 'cron: fundamentals (Tuesdays)' },
  { table: 'insider_transactions',       dateCol: 'created_at',     notes: 'cron: insider (daily, Form 4)' },
  // dev velocity
  { table: 'hf_activity',                dateCol: 'created_at',     notes: 'cron: hf-activity (daily)' },
  { table: 'github_activity',            dateCol: 'created_at',     notes: 'cron: github (daily)' },
  // ip + hiring
  { table: 'patent_snapshots',           dateCol: 'created_at',     notes: 'cron: patents (daily, USPTO)' },
  { table: 'job_snapshots',              dateCol: 'created_at',     notes: 'cron: jobs (daily, Greenhouse/Lever)' },
  // energy
  { table: 'grid_demand_snapshots',      dateCol: 'created_at',     notes: 'cron: eia (daily, balancing-authority)' },
  { table: 'eia_commodity_snapshots',    dateCol: 'created_at',     notes: 'cron: eia (daily, Henry Hub etc.)' },
  { table: 'eia_fuelmix_snapshots',      dateCol: 'created_at',     notes: 'cron: eia (daily, fuel mix)' },
  { table: 'eia_international_snapshots',dateCol: 'created_at',     notes: 'cron: eia (daily, TWN/KOR/JPN/...)' },
  { table: 'aeo_projections',            dateCol: 'extracted_at',   notes: 'one-shot: AEO 2026 forecast' },
  // funding + transcripts
  { table: 'funding_rounds',             dateCol: 'created_at',     notes: 'cron: form-d (daily)' },
  { table: 'transcript_signals',         dateCol: 'created_at',     notes: 'cron: transcripts (daily, 8-K exhibits)' },
  // gpu compute + leaderboards
  { table: 'gpu_spot_prices',            dateCol: 'created_at',     notes: 'cron: gpu-spot (daily, vast.ai+runpod)' },
  { table: 'model_leaderboard',          dateCol: 'created_at',     notes: 'cron: leaderboard (daily, LMArena+AA)' },
  // future / not-yet-built tables (parallel team may be shipping these)
  { table: 'prediction_markets',         dateCol: 'created_at',     notes: 'future: polymarket/kalshi' },
  { table: 'regulatory_events',          dateCol: 'created_at',     notes: 'future: FERC/EU AI Act etc.' },
  { table: 'social_mentions',            dateCol: 'created_at',     notes: 'cron: social (daily, HN+Reddit)' },
  { table: 'interest_signals',           dateCol: 'created_at',     notes: 'future: Google Trends / search' },
  { table: 'ir_snapshots',               dateCol: 'created_at',     notes: 'future: IR-page snapshots' },
  { table: 'ir_changes',                 dateCol: 'created_at',     notes: 'future: IR diff log' },
]

/**
 * Daily cron registry — mirrors the call list in
 * src/app/api/cron/daily/route.ts. The "linked" field is the table to
 * peek at when judging whether the cron's writes are landing; the
 * dispatcher itself doesn't write a row anywhere.
 */
interface CronSpec {
  task: string
  path: string
  window: string        // expected freshness window in plain English
  linkedTable: string   // which table to check for freshness
}

const CRON_SPECS: CronSpec[] = [
  { task: 'prices',            path: '/api/cron/prices',            window: 'daily',  linkedTable: 'companies' },
  { task: '8k-tracker',        path: '/api/cron/8k-tracker',        window: 'daily',  linkedTable: 'signals' },
  { task: 'transcripts',       path: '/api/cron/transcripts',       window: 'daily',  linkedTable: 'transcript_signals' },
  { task: 'news',              path: '/api/cron/news',              window: 'daily',  linkedTable: 'signals' },
  { task: 'insider',           path: '/api/cron/insider',           window: 'daily',  linkedTable: 'insider_transactions' },
  { task: 'form-d',            path: '/api/cron/form-d',            window: 'daily',  linkedTable: 'funding_rounds' },
  { task: 'hf-activity',       path: '/api/cron/hf-activity',       window: 'daily',  linkedTable: 'hf_activity' },
  { task: 'github',            path: '/api/cron/github',            window: 'daily',  linkedTable: 'github_activity' },
  { task: 'eia',               path: '/api/cron/eia',               window: 'daily',  linkedTable: 'grid_demand_snapshots' },
  { task: 'patents',           path: '/api/cron/patents',           window: 'daily',  linkedTable: 'patent_snapshots' },
  { task: 'jobs',              path: '/api/cron/jobs',              window: 'daily',  linkedTable: 'job_snapshots' },
  { task: 'btc',               path: '/api/cron/btc',               window: 'daily',  linkedTable: 'signals' },
  { task: 'gpu-spot',          path: '/api/cron/gpu-spot',          window: 'daily',  linkedTable: 'gpu_spot_prices' },
  { task: 'leaderboard',       path: '/api/cron/leaderboard',       window: 'daily',  linkedTable: 'model_leaderboard' },
  { task: 'social',            path: '/api/cron/social',            window: 'daily',  linkedTable: 'social_mentions' },
  { task: 'fundamentals',      path: '/api/cron/fundamentals',      window: 'weekly (Tue)', linkedTable: 'fundamentals' },
  { task: '13f-tracker',       path: '/api/cron/13f-tracker',       window: 'weekly (Sun)', linkedTable: 'holdings' },
  { task: 'portfolio-scraper', path: '/api/cron/portfolio-scraper', window: 'monthly (1st)', linkedTable: 'companies' },
]

// ---- Domain types -----------------------------------------------------------

type Status = 'red' | 'amber' | 'green' | 'gray' | 'missing'

interface TableHealth {
  table: string
  notes: string
  rows: number
  lastWriteIso: string | null
  hoursStale: number | null
  status: Status
  error: string | null
}

// ---- Data fetch -------------------------------------------------------------

async function fetchTableHealth(spec: TableSpec): Promise<TableHealth> {
  const sb = supabaseServiceRole()

  // count(*) — head:true skips returning rows, just gets the count
  const countResp = await sb.from(spec.table).select('*', { count: 'exact', head: true })

  if (countResp.error) {
    // Most likely: relation doesn't exist (table not migrated yet).
    return {
      table: spec.table,
      notes: spec.notes,
      rows: 0,
      lastWriteIso: null,
      hoursStale: null,
      status: 'missing',
      error: countResp.error.message,
    }
  }

  const rows = countResp.count ?? 0
  let lastWriteIso: string | null = null

  // Skip date probe for junction tables (no date col) and empty tables.
  if (rows > 0 && spec.dateCol) {
    const dateResp = await sb
      .from(spec.table)
      .select(spec.dateCol)
      .order(spec.dateCol, { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!dateResp.error && dateResp.data) {
      const raw = (dateResp.data as Record<string, unknown>)[spec.dateCol]
      if (typeof raw === 'string') lastWriteIso = raw
      // some columns (snapshot_date, filed_date) are date-only — those come
      // back as 'YYYY-MM-DD'. Promote to start-of-day UTC so hours math works.
    }
  }

  const hoursStale = computeHoursStale(lastWriteIso)
  const status = computeStatus(rows, hoursStale, spec)

  return {
    table: spec.table,
    notes: spec.notes,
    rows,
    lastWriteIso,
    hoursStale,
    status,
    error: null,
  }
}

function computeHoursStale(iso: string | null): number | null {
  if (!iso) return null
  // Date-only columns ('2026-05-24') Date.parse to UTC midnight, which is
  // close enough — we're bucketing into <26h / <72h, not measuring minutes.
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return (Date.now() - t) / 36e5
}

function computeStatus(rows: number, hoursStale: number | null, spec: TableSpec): Status {
  if (rows === 0) return 'gray'
  // Tables with no date column (junction tables) get green automatically when populated.
  if (!spec.dateCol) return 'green'
  if (hoursStale === null) return 'gray'
  if (hoursStale > 72) return 'red'
  if (hoursStale > 26) return 'amber'
  return 'green'
}

// ---- Presentation helpers ---------------------------------------------------

// Sort order: problems first (red > amber > gray > missing > green).
// Missing goes after gray because "table doesn't exist" is less actionable
// than "table exists but is stale".
const STATUS_RANK: Record<Status, number> = {
  red: 0,
  amber: 1,
  gray: 2,
  missing: 3,
  green: 4,
}

const STATUS_LABEL: Record<Status, string> = {
  red:     'BROKEN',
  amber:   'STALE',
  gray:    'EMPTY',
  missing: 'MISSING',
  green:   'OK',
}

const STATUS_CLASS: Record<Status, string> = {
  red:     'text-signal-alert',
  amber:   'text-signal-warn',
  gray:    'text-fg-muted',
  missing: 'text-fg-dim',
  green:   'text-signal-healthy',
}

function formatHours(h: number | null): string {
  if (h === null) return '—'
  if (h < 1) return `${Math.round(h * 60)}m`
  if (h < 48) return `${h.toFixed(1)}h`
  return `${(h / 24).toFixed(1)}d`
}

function formatLastWrite(iso: string | null): string {
  if (!iso) return '—'
  // Display as compact UTC: 'YYYY-MM-DD HH:MM' — easier to scan than ISO.
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

function formatRows(n: number): string {
  // Right-aligned with thousands separators — easier to compare at a glance.
  return n.toLocaleString('en-US')
}

// ---- Page -------------------------------------------------------------------

interface PageProps {
  searchParams: { key?: string }
}

export default async function DataHealthPage({ searchParams }: PageProps) {
  const secret = process.env.CRON_SECRET
  const provided = searchParams.key

  // Unauthorized: minimal response, no data leakage.
  if (!secret || provided !== secret) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg-canvas p-8">
        <div className="font-mono text-body text-fg-muted">Unauthorized</div>
      </main>
    )
  }

  // Run every table probe in parallel.
  const tableHealths = await Promise.all(TABLE_SPECS.map(fetchTableHealth))

  // Sort by status (problems first), then by table name within each bucket.
  const sortedRows = [...tableHealths].sort((a, b) => {
    const rankDiff = STATUS_RANK[a.status] - STATUS_RANK[b.status]
    if (rankDiff !== 0) return rankDiff
    return a.table.localeCompare(b.table)
  })

  // Aggregate stats for the headline.
  const totalRows = tableHealths.reduce((acc, t) => acc + t.rows, 0)
  const buckets = tableHealths.reduce<Record<Status, number>>(
    (acc, t) => {
      acc[t.status]++
      return acc
    },
    { red: 0, amber: 0, gray: 0, missing: 0, green: 0 },
  )
  const generatedAt = new Date().toISOString()

  // Build a lookup so the cron section can show the linked table's freshness.
  const healthByTable = new Map(tableHealths.map(t => [t.table, t]))

  return (
    <main className="min-h-screen bg-bg-canvas px-6 py-8 font-mono text-body text-fg-primary">
      <div className="mx-auto max-w-6xl space-y-8">
        {/* ---- Headline ---- */}
        <header className="space-y-2 border-b border-border-default pb-4">
          <h1 className="text-headline text-fg-primary">Data Health — Compute Circuit</h1>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-meta text-fg-secondary">
            <span>
              generated <span className="text-fg-primary">{generatedAt}</span>
            </span>
            <span>
              total rows <span className="text-fg-primary">{formatRows(totalRows)}</span>
            </span>
            <span className="text-signal-alert">{buckets.red} broken</span>
            <span className="text-signal-warn">{buckets.amber} stale</span>
            <span className="text-fg-muted">{buckets.gray} empty</span>
            <span className="text-fg-dim">{buckets.missing} missing</span>
            <span className="text-signal-healthy">{buckets.green} ok</span>
          </div>
        </header>

        {/* ---- Table health ---- */}
        <section className="space-y-3">
          <h2 className="text-label uppercase text-fg-secondary">Tables</h2>
          <div className="overflow-x-auto rounded-card border border-border-default bg-bg-surface">
            <table className="w-full text-left text-body">
              <thead>
                <tr className="border-b border-border-default text-label uppercase text-fg-muted">
                  <th className="px-3 py-2 font-semibold">Table</th>
                  <th className="px-3 py-2 text-right font-semibold">Rows</th>
                  <th className="px-3 py-2 font-semibold">Last write (UTC)</th>
                  <th className="px-3 py-2 text-right font-semibold">Hours stale</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Notes</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map(t => (
                  <tr
                    key={t.table}
                    className="border-b border-border-subtle last:border-b-0 hover:bg-bg-hover"
                  >
                    <td className="px-3 py-1.5 text-fg-primary">{t.table}</td>
                    <td className="px-3 py-1.5 text-right text-fg-secondary tabular-nums">
                      {formatRows(t.rows)}
                    </td>
                    <td className="px-3 py-1.5 text-fg-secondary tabular-nums">
                      {formatLastWrite(t.lastWriteIso)}
                    </td>
                    <td className="px-3 py-1.5 text-right text-fg-secondary tabular-nums">
                      {formatHours(t.hoursStale)}
                    </td>
                    <td className={`px-3 py-1.5 ${STATUS_CLASS[t.status]}`}>
                      {STATUS_LABEL[t.status]}
                    </td>
                    <td className="px-3 py-1.5 text-meta text-fg-muted">
                      {t.error ? `${t.notes} — ${t.error}` : t.notes}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ---- Cron health ---- */}
        <section className="space-y-3">
          <h2 className="text-label uppercase text-fg-secondary">Cron routes</h2>
          <p className="text-meta text-fg-muted">
            Trigger links open the route in a new tab. Crons require a Bearer header,
            so the link will return 401 — use it to confirm the route exists, then
            run via curl:{' '}
            <code className="text-fg-secondary">
              curl -H &quot;Authorization: Bearer $CRON_SECRET&quot; &lt;url&gt;
            </code>
          </p>
          <div className="overflow-x-auto rounded-card border border-border-default bg-bg-surface">
            <table className="w-full text-left text-body">
              <thead>
                <tr className="border-b border-border-default text-label uppercase text-fg-muted">
                  <th className="px-3 py-2 font-semibold">Task</th>
                  <th className="px-3 py-2 font-semibold">Path</th>
                  <th className="px-3 py-2 font-semibold">Window</th>
                  <th className="px-3 py-2 font-semibold">Linked table</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Trigger</th>
                </tr>
              </thead>
              <tbody>
                {CRON_SPECS.map(c => {
                  const linked = healthByTable.get(c.linkedTable)
                  const status: Status = linked?.status ?? 'missing'
                  // Cache-bust the curl-able URL so warm Lambdas don't return
                  // a memoized response — same trick used in service-role.ts.
                  const bust = Date.now()
                  const triggerUrl = `${c.path}?key=${encodeURIComponent(
                    provided ?? '',
                  )}&bust=${bust}`
                  return (
                    <tr
                      key={c.task}
                      className="border-b border-border-subtle last:border-b-0 hover:bg-bg-hover"
                    >
                      <td className="px-3 py-1.5 text-fg-primary">{c.task}</td>
                      <td className="px-3 py-1.5 text-fg-secondary">
                        <code className="text-fg-secondary">{c.path}</code>
                      </td>
                      <td className="px-3 py-1.5 text-fg-secondary">{c.window}</td>
                      <td className="px-3 py-1.5 text-fg-secondary">
                        {c.linkedTable}
                        {linked?.lastWriteIso ? (
                          <span className="ml-2 text-meta text-fg-muted tabular-nums">
                            ({formatHours(linked.hoursStale)})
                          </span>
                        ) : null}
                      </td>
                      <td className={`px-3 py-1.5 ${STATUS_CLASS[status]}`}>
                        {STATUS_LABEL[status]}
                      </td>
                      <td className="px-3 py-1.5">
                        <a
                          href={triggerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent-primary hover:underline"
                        >
                          [ Trigger ]
                        </a>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* ---- Legend ---- */}
        <footer className="border-t border-border-default pt-4 text-meta text-fg-muted">
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <span>
              <span className="text-signal-healthy">OK</span> &lt;26h
            </span>
            <span>
              <span className="text-signal-warn">STALE</span> 26-72h
            </span>
            <span>
              <span className="text-signal-alert">BROKEN</span> &gt;72h
            </span>
            <span>
              <span className="text-fg-muted">EMPTY</span> 0 rows
            </span>
            <span>
              <span className="text-fg-dim">MISSING</span> table doesn&apos;t exist
            </span>
          </div>
        </footer>
      </div>
    </main>
  )
}

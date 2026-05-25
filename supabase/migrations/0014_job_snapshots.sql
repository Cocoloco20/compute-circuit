-- Phase 5f: Hiring pulse — daily snapshot of open job reqs per company.
--
-- Source: free, no-auth public job-board APIs (Greenhouse / Lever / Ashby).
-- See src/lib/jobs.ts → JOB_BOARDS for the verified slugs. Companies on
-- Workday / iCIMS / SuccessFactors (most listed-equity names) have no public
-- JSON endpoint and are intentionally skipped.
--
-- One row per (company_id, snapshot_date). top_categories is jsonb so we can
-- evolve top-N depth without a migration. Source provider + slug are stored
-- per row so we can survive a board move (e.g. Greenhouse → Ashby) without
-- losing prior history.

create table if not exists job_snapshots (
  id                uuid primary key default gen_random_uuid(),
  company_id        text not null references companies(id) on delete cascade,
  snapshot_date     date not null,
  total_open        int  not null default 0,
  -- top_categories: [{ "name": "Engineering", "count": 50 }, ...] (full set, sorted desc by count)
  top_categories    jsonb not null default '[]'::jsonb,
  source_provider   text not null,                         -- 'greenhouse' | 'lever' | 'ashby'
  source_slug       text not null,
  created_at        timestamptz not null default now()
);

create unique index if not exists idx_job_snapshots_unique
  on job_snapshots(company_id, snapshot_date);

create index if not exists idx_job_snapshots_company
  on job_snapshots(company_id, snapshot_date desc);

alter table job_snapshots enable row level security;
create policy "anon read job_snapshots" on job_snapshots
  for select to anon, authenticated using (true);

-- Phase 5e: USPTO patent snapshots — "R&D velocity" signal per company.
--
-- Source: USPTO Open Data Portal (api.uspto.gov/api/v1, replaces the
-- deprecated PatentsView). Requires USPTO_API_KEY in env (free, ID.me
-- verification at https://data.uspto.gov/myodp).
--
-- One row per (company, snapshot_date). Aggregations live in jsonb so we can
-- evolve top-N depth without a schema change.

-- ----- companies.assignee_name -----
alter table companies
  add column if not exists assignee_name text;
create index if not exists idx_companies_assignee_name
  on companies(assignee_name) where assignee_name is not null;

-- ----- patent_snapshots: per-day per-company TTM aggregate -----
create table if not exists patent_snapshots (
  id                uuid primary key default gen_random_uuid(),
  company_id        text not null references companies(id) on delete cascade,
  snapshot_date     date not null,
  ttm_count         int  not null default 0,                       -- applications filed in the trailing 12 months
  -- top_subclasses: [{ "code": "G06N", "count": 412 }, ...]  (top 3 CPC subclasses by # of patents touching them)
  top_subclasses    jsonb not null default '[]'::jsonb,
  -- recent_titles: [{ "title": "...", "filingDate": "YYYY-MM-DD" }, ...]  (top 3 most recent)
  recent_titles     jsonb not null default '[]'::jsonb,
  source            text not null default 'uspto-odp',             -- provenance — switch when we add WIPO etc.
  created_at        timestamptz not null default now()
);

create unique index if not exists idx_patent_snapshots_unique
  on patent_snapshots(company_id, snapshot_date);

create index if not exists idx_patent_snapshots_company
  on patent_snapshots(company_id, snapshot_date desc);

alter table patent_snapshots enable row level security;
create policy "anon read patent_snapshots" on patent_snapshots
  for select to anon, authenticated using (true);

-- ----- Backfill assignee_name per the agent's verified mapping -----
-- Names must match the form USPTO indexes them under. Public US filers use
-- the legal entity that owns IP, which is often a domestic subsidiary
-- (e.g. Amazon files via "Amazon Technologies, Inc.", not "Amazon.com, Inc.").
-- For TSM and ASML the assignee is the Taiwan/NL parent — USPTO accepts
-- foreign assignees, just slower indexing.

-- US public AI-compute companies
update companies set assignee_name = 'NVIDIA Corporation'                          where id = 'nvda';
update companies set assignee_name = 'Advanced Micro Devices, Inc.'                where id = 'amd';
update companies set assignee_name = 'Broadcom Inc.'                               where id = 'avgo';
update companies set assignee_name = 'Marvell Asia Pte, Ltd.'                      where id = 'mrvl';   -- Marvell files via its Singapore entity
update companies set assignee_name = 'Arm Limited'                                 where id = 'arm';
update companies set assignee_name = 'QUALCOMM Incorporated'                       where id = 'qcom';
update companies set assignee_name = 'Intel Corporation'                           where id = 'intc';

-- Semicap
update companies set assignee_name = 'Applied Materials, Inc.'                     where id = 'amat';
update companies set assignee_name = 'Lam Research Corporation'                    where id = 'lrcx';
update companies set assignee_name = 'KLA Corporation'                             where id = 'klac';
update companies set assignee_name = 'Taiwan Semiconductor Manufacturing Co., Ltd.' where id = 'tsm';
update companies set assignee_name = 'Micron Technology, Inc.'                     where id = 'mu';

-- Hyperscalers + software
update companies set assignee_name = 'Meta Platforms, Inc.'                        where id = 'meta-ai';
update companies set assignee_name = 'Google LLC'                                  where id = 'googl';
update companies set assignee_name = 'Microsoft Corporation'                       where id = 'msft';
update companies set assignee_name = 'Amazon Technologies, Inc.'                   where id = 'amzn';
update companies set assignee_name = 'International Business Machines Corporation' where id = 'ibm';
update companies set assignee_name = 'Oracle International Corporation'            where id = 'orcl';

-- Private AI accelerators (USPTO has filings for both — search by exact name)
update companies set assignee_name = 'Groq, Inc.'                                  where id = 'groq';
update companies set assignee_name = 'Cerebras Systems Inc.'                       where id = 'cerebras';

-- Foreign (ASML files under NL parent; slow indexing but real records exist)
update companies set assignee_name = 'ASML Netherlands B.V.'                       where id = 'asml';

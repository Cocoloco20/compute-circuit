-- Phase 5c: insider transactions (Form 4) + Hugging Face org activity
--
-- Two new tables, one new column on companies. Both signals come from free
-- sources we already touch (SEC EDGAR) or one new free no-auth endpoint
-- (huggingface.co/api).

-- ----- insider_transactions: parsed Form 4 transactions -----
-- One row per (issuer, accession, transaction_date) — Form 4 can report
-- multiple transactions in a single filing but typically one.

create table if not exists insider_transactions (
  id                      uuid primary key default gen_random_uuid(),
  company_id              text not null references companies(id) on delete cascade,
  accession               text not null,
  filing_date             date not null,
  transaction_date        date,
  reporting_owner         text,                              -- insider name
  reporting_owner_role    text,                              -- e.g. "Chief Executive Officer", "Director"
  is_officer              boolean,
  is_director             boolean,
  is_ten_percent_owner    boolean,
  security_title          text,                              -- "Common Stock", "Class A Common", etc.
  shares                  numeric,
  price_per_share         numeric,
  value_usd               numeric,                           -- shares * price (signed)
  transaction_code        text,                              -- 'S' sale, 'P' purchase, 'M' exempt, 'G' gift, 'F' tax, etc.
  acquired_or_disposed    text,                              -- 'A' or 'D'
  source_url              text,
  created_at              timestamptz not null default now()
);

-- One filing usually = one transaction, but multi-line is allowed. Dedup
-- on the accession+date+shares triple keeps re-runs idempotent.
create unique index if not exists idx_insider_unique
  on insider_transactions(accession, transaction_date, security_title, shares);

create index if not exists idx_insider_company_date
  on insider_transactions(company_id, filing_date desc);
create index if not exists idx_insider_code
  on insider_transactions(transaction_code);

alter table insider_transactions enable row level security;
create policy "anon read insider_transactions" on insider_transactions
  for select to anon, authenticated using (true);

-- ----- hf_activity: Hugging Face org snapshots -----

alter table companies
  add column if not exists hf_org text;
create index if not exists idx_companies_hf_org
  on companies(hf_org) where hf_org is not null;

create table if not exists hf_activity (
  id                   uuid primary key default gen_random_uuid(),
  company_id           text not null references companies(id) on delete cascade,
  snapshot_date        date not null,
  org_slug             text not null,
  model_count          int  not null default 0,
  total_downloads_30d  bigint not null default 0,           -- sum of `downloads` across all models
  top_model_id         text,                                 -- e.g. "meta-llama/Llama-3.3-70B-Instruct"
  top_model_downloads  bigint,
  last_release_date    date,                                 -- max(lastModified) across models
  created_at           timestamptz not null default now()
);

create unique index if not exists idx_hf_activity_unique
  on hf_activity(company_id, snapshot_date);

create index if not exists idx_hf_activity_company
  on hf_activity(company_id, snapshot_date desc);

alter table hf_activity enable row level security;
create policy "anon read hf_activity" on hf_activity
  for select to anon, authenticated using (true);

-- Phase 3: 13F institutional holdings tracker
--
-- 13F-HR is a quarterly form filed by institutional investment managers with
-- >$100M AUM. The actual holdings live in an INFORMATION TABLE attached as
-- a separate XML file inside the filing folder. Each row is one position
-- (CUSIP + share count + dollar value).
--
-- Schema additions:
--   * investors.cik — only set for filers (ARK, BlackRock, Coatue, Tiger, Whale Rock).
--   * investors.files_13f — flag for the cron to know which rows to process.
--     We could derive it from `cik IS NOT NULL` but an explicit flag means
--     we can later add CIK-having investors who DON'T file 13F (e.g. private
--     funds with SEC registration but no public reporting).
--   * companies.cusip — joining key from 13F holdings → our company.id.
--   * holdings — one row per (investor, company-or-cusip, quarter).
--
-- Diff logic lives in app code (compare latest two periods for a filer/company).

alter table investors
  add column if not exists cik text,
  add column if not exists files_13f boolean not null default false;

create index if not exists idx_investors_files_13f on investors(files_13f) where files_13f = true;

alter table companies
  add column if not exists cusip text;

create index if not exists idx_companies_cusip on companies(cusip) where cusip is not null;

-- One holdings row per (investor, period, cusip). Storing cusip directly
-- (not just company_id) lets us track positions in companies we don't have
-- in our companies table yet — we can backfill the company_id later.
create table if not exists holdings (
  id              uuid primary key default gen_random_uuid(),
  investor_id     text not null references investors(id) on delete cascade,
  company_id      text references companies(id) on delete set null,
  cusip           text not null,
  issuer_name     text not null,        -- raw nameOfIssuer from 13F
  title_of_class  text,                 -- e.g. "COM", "ADR"
  period          date not null,        -- quarter-end date the 13F covers
  shares          bigint,
  value_usd       bigint,               -- 13F reports in $1000s; we store actual dollars
  accession       text not null,        -- source filing for traceability
  created_at      timestamptz not null default now()
);

create unique index if not exists idx_holdings_unique
  on holdings(investor_id, period, cusip);

create index if not exists idx_holdings_investor_period
  on holdings(investor_id, period desc);
create index if not exists idx_holdings_company
  on holdings(company_id, period desc) where company_id is not null;
create index if not exists idx_holdings_cusip
  on holdings(cusip, period desc);

-- RLS — match the pattern from 0001
alter table holdings enable row level security;
create policy "anon read holdings" on holdings
  for select to anon, authenticated using (true);

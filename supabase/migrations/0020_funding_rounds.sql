-- Phase 7a: Form D funding-round tracker.
--
-- Companion signal to the Form-D-driven portfolio scraper (which finds NEW
-- private cos via investor portfolios). This tracker watches Form D filings
-- for cos ALREADY in our DB and records the offering amounts over time,
-- giving us a funding-velocity signal per private co.
--
-- Source: SEC EDGAR Form D primary_doc.xml — the rigid X0708 schema.
-- Path: <edgarSubmission>/<offeringData>/<offeringSalesAmounts>/{
--         totalOfferingAmount, totalAmountSold, totalRemaining
--       }
-- Indefinite offerings encode as the literal string "Indefinite" in the
-- amount fields (no separate boolean in the schema) — we capture that
-- with has_amount_indefinite so the UI can render "$XXm + ongoing".
--
-- Related persons (officers, directors, recipients of comp) live in
-- <relatedPersonsList>/<relatedPersonInfo> — we extract names as a
-- text[] so the drawer can show a "Named investors" preview.

create table if not exists funding_rounds (
  id                              uuid primary key default gen_random_uuid(),
  company_id                      text not null references companies(id) on delete cascade,
  filed_date                      date not null,
  accession                       text not null,                        -- SEC accession number, dedup key
  total_amount_sold_usd           numeric,                              -- already raised (null if indefinite)
  total_offering_amount_usd       numeric,                              -- ceiling on this offering
  total_amount_remaining_usd      numeric,                              -- offering - sold
  has_amount_indefinite           boolean not null default false,       -- true if any of the amount fields were "Indefinite"
  investors_named                 text[] not null default '{}',         -- names from relatedPersonsList
  source_url                      text,                                 -- canonical URL to the filing folder
  created_at                      timestamptz not null default now()
);

-- One filing = one (company, accession) pair. Re-runs of the cron are idempotent
-- via this unique constraint + upsert in the API route.
create unique index if not exists idx_funding_rounds_unique
  on funding_rounds(company_id, accession);

create index if not exists idx_funding_rounds_company_date
  on funding_rounds(company_id, filed_date desc);

create index if not exists idx_funding_rounds_filed_date
  on funding_rounds(filed_date desc);

alter table funding_rounds enable row level security;
create policy "anon read funding_rounds" on funding_rounds
  for select to anon, authenticated using (true);

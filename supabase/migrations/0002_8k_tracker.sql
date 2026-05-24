-- Phase 2: 8-K tracker support
--
-- Adds:
--   * companies.cik — SEC Central Index Key (the only stable identifier; tickers
--     change). Populated by the one-time CIK backfill script.
--   * signals.accession_number — SEC filing's accession (e.g. "0001045810-25-..."),
--     unique per filing. Lets the cron dedupe trivially via ON CONFLICT.
--   * signals.form_type — '8-K', '10-K', '10-Q', '13F' etc. so later trackers
--     can write into the same table without a schema change.
--
-- Both new columns are nullable so existing seed rows don't blow up.

alter table companies
  add column if not exists cik text;

create index if not exists idx_companies_cik on companies(cik) where cik is not null;

alter table signals
  add column if not exists accession_number text,
  add column if not exists form_type text;

-- Unique on accession_number when present. Partial unique index = lets older
-- (manually-added) signals with NULL accession coexist.
create unique index if not exists idx_signals_accession
  on signals(accession_number)
  where accession_number is not null;

create index if not exists idx_signals_form_type on signals(form_type) where form_type is not null;

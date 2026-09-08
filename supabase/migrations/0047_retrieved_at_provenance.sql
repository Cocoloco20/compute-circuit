-- Migration 0047 — Add retrieval provenance (retrieved_at) to all ingestion tables.
--
-- Problem: Every ingestion table only has created_at (DB insert time), so
-- "a filing from last month fetched yesterday" is indistinguishable from
-- "yesterday's filing". For a fund this is a data-integrity defect.
--
-- Solution: Add retrieved_at timestamptz to every ingestion table. Backfill
-- existing rows from created_at. Then cron routes set it explicitly on write
-- (snapshot_date-based jobs use snapshot_date 00:00 UTC; event-based jobs
-- use the actual fetch timestamp).

-- ======================================================================
-- signals (news, filings, events)
-- ======================================================================
alter table signals
  add column if not exists retrieved_at timestamptz;
update signals set retrieved_at = created_at where retrieved_at is null;
-- Future inserts: cron sets retrieved_at = now() at fetch time.

-- ======================================================================
-- funding_rounds (Form D)
-- ======================================================================
alter table funding_rounds
  add column if not exists retrieved_at timestamptz;
update funding_rounds set retrieved_at = created_at where retrieved_at is null;

-- ======================================================================
-- holdings (13F)
-- ======================================================================
alter table holdings
  add column if not exists retrieved_at timestamptz;
update holdings set retrieved_at = created_at where retrieved_at is null;

-- ======================================================================
-- transcript_signals (earnings 8-K item 2.02)
-- ======================================================================
alter table transcript_signals
  add column if not exists retrieved_at timestamptz;
update transcript_signals set retrieved_at = created_at where retrieved_at is null;

-- ======================================================================
-- github_activity
-- ======================================================================
alter table github_activity
  add column if not exists retrieved_at timestamptz;
update github_activity set retrieved_at = created_at where retrieved_at is null;

-- ======================================================================
-- hf_activity
-- ======================================================================
alter table hf_activity
  add column if not exists retrieved_at timestamptz;
update hf_activity set retrieved_at = created_at where retrieved_at is null;

-- ======================================================================
-- gpu_spot_prices
-- ======================================================================
alter table gpu_spot_prices
  add column if not exists retrieved_at timestamptz;
update gpu_spot_prices set retrieved_at = created_at where retrieved_at is null;

-- ======================================================================
-- eia_commodity_snapshots
-- ======================================================================
alter table eia_commodity_snapshots
  add column if not exists retrieved_at timestamptz;
update eia_commodity_snapshots set retrieved_at = created_at where retrieved_at is null;

-- ======================================================================
-- eia_fuelmix_snapshots
-- ======================================================================
alter table eia_fuelmix_snapshots
  add column if not exists retrieved_at timestamptz;
update eia_fuelmix_snapshots set retrieved_at = created_at where retrieved_at is null;

-- ======================================================================
-- eia_international_snapshots
-- ======================================================================
alter table eia_international_snapshots
  add column if not exists retrieved_at timestamptz;
update eia_international_snapshots set retrieved_at = created_at where retrieved_at is null;

-- ======================================================================
-- grid_demand_snapshots
-- ======================================================================
alter table grid_demand_snapshots
  add column if not exists retrieved_at timestamptz;
update grid_demand_snapshots set retrieved_at = created_at where retrieved_at is null;

-- ======================================================================
-- patent_snapshots
-- ======================================================================
alter table patent_snapshots
  add column if not exists retrieved_at timestamptz;
update patent_snapshots set retrieved_at = created_at where retrieved_at is null;

-- ======================================================================
-- job_snapshots
-- ======================================================================
alter table job_snapshots
  add column if not exists retrieved_at timestamptz;
update job_snapshots set retrieved_at = created_at where retrieved_at is null;

-- ======================================================================
-- social_mentions
-- ======================================================================
alter table social_mentions
  add column if not exists retrieved_at timestamptz;
update social_mentions set retrieved_at = created_at where retrieved_at is null;

-- ======================================================================
-- insider_transactions
-- ======================================================================
alter table insider_transactions
  add column if not exists retrieved_at timestamptz;
update insider_transactions set retrieved_at = created_at where retrieved_at is null;

-- ======================================================================
-- arxiv_papers
-- ======================================================================
alter table arxiv_papers
  add column if not exists retrieved_at timestamptz;
update arxiv_papers set retrieved_at = created_at where retrieved_at is null;

-- ======================================================================
-- arxiv_snapshots
-- ======================================================================
alter table arxiv_snapshots
  add column if not exists retrieved_at timestamptz;
update arxiv_snapshots set retrieved_at = created_at where retrieved_at is null;

-- ======================================================================
-- compute_contracts
-- ======================================================================
alter table compute_contracts
  add column if not exists retrieved_at timestamptz;
update compute_contracts set retrieved_at = created_at where retrieved_at is null;

-- ======================================================================
-- gpu_hyperscaler_pricing (created by the hyperscaler cron)
-- ======================================================================
-- Note: This table was created implicitly by the cron route upsert.
-- It has the standard schema from the TypeScript types.
-- We add the column if the table exists.
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'gpu_hyperscaler_pricing'
  ) then
    alter table gpu_hyperscaler_pricing
      add column if not exists retrieved_at timestamptz;
    update gpu_hyperscaler_pricing
      set retrieved_at = created_at where retrieved_at is null;
  end if;
end $$;
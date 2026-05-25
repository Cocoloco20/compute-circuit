-- Phase 9: GPU availability tracking — hyperscaler spot pricing + rental market availability.
--
-- Two additions:
--
-- 1. ALTER gpu_spot_prices to add listing_count_by_region jsonb.
--    Stores a breakdown of listings per country/datacenter code for
--    the rental-market sources (Vast.ai). Null for RunPod (no per-listing
--    geography in the public GraphQL catalog). Null for 'blended' rows.
--    Existing rows keep NULL (the column is nullable — no backfill needed).
--
-- 2. New table gpu_hyperscaler_pricing: daily snapshot of H100/H200/B200
--    spot pricing from AWS + Azure (GCP TBD). One row per
--    (snapshot_date, gpu_model, provider, region). Prices are in $/GPU/hr
--    (instance price divided by GPU count in that instance family).
--    on_demand_usd_per_gpu_hour is null until we add on-demand scraping.
--
-- Unique constraint on (snapshot_date, gpu_model, provider, region) makes
-- the upsert in /api/cron/gpu-spot idempotent.

-- ── 1. Extend gpu_spot_prices ────────────────────────────────────────────────

alter table gpu_spot_prices
  add column if not exists listing_count_by_region jsonb;

comment on column gpu_spot_prices.listing_count_by_region is
  'Per-region/country listing counts for Vast.ai rows, e.g. {"US": 34, "DE": 8, "CA": 3}. NULL for RunPod and blended rows.';

-- ── 2. New table: gpu_hyperscaler_pricing ────────────────────────────────────

create table if not exists gpu_hyperscaler_pricing (
  id                          uuid primary key default gen_random_uuid(),
  snapshot_date               date not null,
  gpu_model                   text not null,   -- e.g. 'H100 80GB SXM5', 'H200', 'B200', 'A100 80GB'
  provider                    text not null,   -- 'aws' | 'azure' | 'gcp'
  region                      text not null,   -- provider-native region string, e.g. 'us-east-1', 'eastus'
  spot_usd_per_gpu_hour       numeric,         -- null if provider has no public spot price for this combo
  on_demand_usd_per_gpu_hour  numeric,         -- null until on-demand scraping is added
  created_at                  timestamptz not null default now()
);

create unique index if not exists idx_gpu_hyperscaler_pricing_unique
  on gpu_hyperscaler_pricing(snapshot_date, gpu_model, provider, region);

create index if not exists idx_gpu_hyperscaler_pricing_date
  on gpu_hyperscaler_pricing(snapshot_date desc);

create index if not exists idx_gpu_hyperscaler_pricing_model
  on gpu_hyperscaler_pricing(gpu_model, provider, snapshot_date desc);

alter table gpu_hyperscaler_pricing enable row level security;
create policy "anon read gpu_hyperscaler_pricing" on gpu_hyperscaler_pricing
  for select to anon, authenticated using (true);

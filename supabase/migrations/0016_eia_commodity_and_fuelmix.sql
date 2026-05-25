-- Phase 5h: Track everything-EIA — gas spot, nuclear outage, regional fuel mix.
--
-- Existing grid_demand_snapshots (0012) covers per-company regional demand.
-- This migration adds two orthogonal slices the user wants for the full
-- "AI buildout vs grid" picture:
--
--   1. Single time series the whole graph cares about (Henry Hub gas spot,
--      US nuclear capacity offline) → eia_commodity_snapshots
--   2. Per-region generation mix (% nuclear / gas / renewables) so a hyper-
--      scaler drawer can answer "is this DC actually green?" →
--      eia_fuelmix_snapshots
--
-- All EIA cron updates upsert one row per (key, snapshot_date).

-- ----- 1. Commodity / national-aggregate single-series snapshots -----
-- series_id matches EIA's facet ID so we can add more without schema changes.
--   'NG.HENRY_HUB.D'   → $/MMBtu daily spot
--   'NUC.OUTAGE_US.D'  → MW of US nuclear capacity offline
--   future: 'COAL.STOCKS.M', 'COAL.PRICE.W', etc.
create table if not exists eia_commodity_snapshots (
  id              uuid primary key default gen_random_uuid(),
  series_id       text not null,                  -- our slug, NOT raw EIA series id
  snapshot_date   date not null,
  value           numeric not null,
  unit            text not null,                  -- 'USD/MMBtu' | 'MW' | '%' | etc.
  label           text,                           -- human-friendly e.g. 'Henry Hub spot'
  source_series   text,                           -- raw EIA series id for debugging
  created_at      timestamptz not null default now()
);
create unique index if not exists idx_eia_commodity_unique
  on eia_commodity_snapshots(series_id, snapshot_date);
create index if not exists idx_eia_commodity_series
  on eia_commodity_snapshots(series_id, snapshot_date desc);

alter table eia_commodity_snapshots enable row level security;
create policy "anon read eia_commodity_snapshots" on eia_commodity_snapshots
  for select to anon, authenticated using (true);

-- ----- 2. Per-region generation-fuel mix -----
-- Matches the EIA respondent IDs we already use in grid_demand_snapshots
-- (PJM / ERCO / FLA / US48 / etc.) so a co's eia_region joins straight to
-- both demand and fuel mix.
--
-- fuel_mix shape: { "nuclear": 33.2, "natural_gas": 41.1, "coal": 8.4,
--                   "solar": 5.1, "wind": 8.2, "hydro": 3.8, "other": 0.2 }
-- Percentages of generation in the trailing 24h. Always sums to ~100.
create table if not exists eia_fuelmix_snapshots (
  id                uuid primary key default gen_random_uuid(),
  region            text not null,                  -- 'PJM' | 'ERCO' | 'FLA' | 'US48' | ...
  snapshot_date     date not null,
  fuel_mix          jsonb not null,                 -- {fuel: pct, ...}
  total_mwh         numeric,                        -- 24h generation total (sanity)
  carbon_g_per_kwh  numeric,                        -- derived: weighted CO2 intensity
  created_at        timestamptz not null default now()
);
create unique index if not exists idx_eia_fuelmix_unique
  on eia_fuelmix_snapshots(region, snapshot_date);
create index if not exists idx_eia_fuelmix_region
  on eia_fuelmix_snapshots(region, snapshot_date desc);

alter table eia_fuelmix_snapshots enable row level security;
create policy "anon read eia_fuelmix_snapshots" on eia_fuelmix_snapshots
  for select to anon, authenticated using (true);

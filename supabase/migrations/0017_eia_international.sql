-- Phase 5h cont'd — fab-country electricity stats (Taiwan, Korea, Japan, NL, SG, IE).
--
-- Different shape from eia_commodity_snapshots because the international
-- endpoint is per-country annual rather than per-series national daily.
-- One row per (country_id, snapshot_date).

create table if not exists eia_international_snapshots (
  id                    uuid primary key default gen_random_uuid(),
  country_id            text not null,                  -- 'TWN' | 'KOR' | 'JPN' | 'NLD' | 'SGP' | 'IRL'
  country_label         text not null,
  fab_exposure          text not null,                  -- 'TSMC' | 'Samsung / SK Hynix' | ...
  snapshot_date         date not null,                  -- normalized YYYY-MM-DD (annual data → YYYY-01-01)
  latest_year           int  not null,
  net_generation_twh    numeric not null,
  yoy_pct               numeric,                        -- null when no prior year on file
  created_at            timestamptz not null default now()
);

create unique index if not exists idx_eia_intl_unique
  on eia_international_snapshots(country_id, snapshot_date);

create index if not exists idx_eia_intl_country
  on eia_international_snapshots(country_id, snapshot_date desc);

alter table eia_international_snapshots enable row level security;
create policy "anon read eia_international_snapshots" on eia_international_snapshots
  for select to anon, authenticated using (true);

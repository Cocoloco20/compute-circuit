-- Phase 5d: EIA Open Data grid-demand signal.
--
-- Surfaces regional electricity demand on energy-layer companies (CEG/VST/
-- TLN/NEE) and a national-total proxy for cooling/colocation plays (VRT/
-- EQIX/DLR). Data-center load is the binding constraint for AI buildouts —
-- this is the leading signal.
--
-- Mapping (commit in the UPDATE block at the bottom):
--   ceg   → PJM   (Constellation; TMI Unit 1 in PJM Mid-Atlantic)
--   vst   → ERCO  (Vistra; Comanche Peak + TX gas fleet)
--   talen → PJM   (Talen; Susquehanna nuclear in central PA = PJM)
--   nee   → FLA   (NextEra; FPL Florida service territory)
--   oklo  → null  (no operating plants — skip per spec)
--   vrt   → US48  (Vertiv cooling exposed to national DC growth)
--   eqix  → US48  (Equinix global colo, US48 as US proxy)
--   dlr   → US48  (Digital Realty hyperscale REIT, US48 as US proxy)
--
-- NEE could arguably also map to PJM (NextEra Energy Resources has PJM
-- generation assets) — kept FLA-only to match spec; second-region support
-- can be a follow-up migration with a join table.

-- ----- companies.eia_region -----
alter table companies
  add column if not exists eia_region text;
create index if not exists idx_companies_eia_region
  on companies(eia_region) where eia_region is not null;

-- ----- grid_demand_snapshots: per-day per-company demand snapshot -----
create table if not exists grid_demand_snapshots (
  id                    uuid primary key default gen_random_uuid(),
  company_id            text not null references companies(id) on delete cascade,
  snapshot_date         date not null,
  region                text not null,                          -- denormalized for reads
  current_7d_avg_mwh    numeric,                                -- avg of last 168 hourly values
  yoy_change_pct        numeric,                                -- vs. same 7-day window 365d ago
  last_hourly_mwh       numeric,                                -- most recent hour from EIA
  last_hour             timestamptz,                            -- ISO timestamp of last_hourly_mwh
  created_at            timestamptz not null default now()
);

create unique index if not exists idx_grid_demand_unique
  on grid_demand_snapshots(company_id, snapshot_date);

create index if not exists idx_grid_demand_company
  on grid_demand_snapshots(company_id, snapshot_date desc);

create index if not exists idx_grid_demand_region
  on grid_demand_snapshots(region, snapshot_date desc);

alter table grid_demand_snapshots enable row level security;
create policy "anon read grid_demand_snapshots" on grid_demand_snapshots
  for select to anon, authenticated using (true);

-- ----- Backfill eia_region per the mapping above -----
update companies set eia_region = 'PJM'  where id = 'ceg';
update companies set eia_region = 'ERCO' where id = 'vst';
update companies set eia_region = 'PJM'  where id = 'talen';
update companies set eia_region = 'FLA'  where id = 'nee';
-- oklo: intentionally left null (not yet operating)
update companies set eia_region = 'US48' where id = 'vrt';
update companies set eia_region = 'US48' where id = 'eqix';
update companies set eia_region = 'US48' where id = 'dlr';

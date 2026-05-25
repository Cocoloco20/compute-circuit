-- Phase 5i: AEO 2026 macro projections — the only authoritative US data-center
-- electricity-demand forecast through 2050.
--
-- Source: EIA Annual Energy Outlook 2026 (single 187 MB JSON-Lines file
-- extracted from AEO2026.zip). We pull the 3 most decision-relevant scenarios:
--
--   HIGHELDMD    — "High Electricity Demand" — the AI/EV/electrification bull case
--   CB2026       — "Counterfactual Baseline" — what would happen w/o recent policy
--   AEO2025REF   — last year's reference case (for delta-vs-prior-year context)
--
-- Three metrics each:
--   dc_demand_delivered    — energy at the wall (DEE)
--   dc_demand_purchased    — grid power purchased (PRC) ← matters most for CEG/VST/NEE
--   dc_demand_total_use    — total energy incl. onsite cogen (TEE)
--
-- Annual cadence, projected 2025..2050. ~27 years × 3 scenarios × 3 metrics
-- = 243 max rows. Refreshed once per year when EIA publishes new AEO.

create table if not exists aeo_projections (
  id                uuid primary key default gen_random_uuid(),
  scenario          text not null,                   -- 'HIGHELDMD' | 'CB2026' | 'AEO2025REF'
  metric            text not null,                   -- 'dc_demand_purchased' | 'dc_demand_delivered' | 'dc_demand_total_use'
  projection_year   int  not null,
  value_quads       numeric not null,                -- raw AEO unit (quadrillion Btu)
  value_twh         numeric not null,                -- pre-converted (1 quad = 293.07 TWh)
  source            text not null default 'AEO 2026',
  extracted_at      timestamptz not null default now()
);

create unique index if not exists idx_aeo_projections_unique
  on aeo_projections(scenario, metric, projection_year);
create index if not exists idx_aeo_projections_metric
  on aeo_projections(metric, projection_year);

alter table aeo_projections enable row level security;
create policy "anon read aeo_projections" on aeo_projections
  for select to anon, authenticated using (true);

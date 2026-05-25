-- Phase 8: GPU spot-price tracker.
--
-- Median $/GPU-hr across the public GPU rental marketplace is one of the
-- cleanest leading indicators of AI training demand: when H100 spot prices
-- spike above $3/hr the training market is saturated; when they fall under
-- $2/hr we have visible slack. This complements the per-co signals (jobs,
-- patents, github) with a market-clearing-price signal.
--
-- Two free, no-auth sources blended into a daily snapshot:
--
--   * Vast.ai — public order book at console.vast.ai/api/v0/bundles/.
--     Filter verified=true & rentable=true. dph_total is total $/hr for the
--     bundle, num_gpus is the GPU count, so per-GPU rate = dph_total/num_gpus.
--   * RunPod — public catalog at api.runpod.io/graphql. gpuTypes returns
--     securePrice (data-center grade) and communityPrice (peer-to-peer). We
--     take securePrice as the "production" rate.
--
-- One row per (snapshot_date, gpu_model, source). source='blended' is the
-- cross-provider median (the line we put on the chip). Sources keep their
-- own row so the drawer/tray can show which provider is cheaper today.

create table if not exists gpu_spot_prices (
  id                       uuid primary key default gen_random_uuid(),
  snapshot_date            date not null,
  gpu_model                text not null,                  -- canonical model: 'H100 80GB SXM5', 'A100 80GB', 'RTX 4090', ...
  median_usd_per_hour      numeric not null,
  p25_usd_per_hour         numeric,                        -- 25th percentile (cheap end of the book)
  p75_usd_per_hour         numeric,                        -- 75th percentile (premium end)
  listing_count            int not null default 0,
  source                   text not null,                  -- 'vast.ai' | 'runpod' | 'blended'
  created_at               timestamptz not null default now()
);

-- One row per (date, model, source). Re-runs of the cron are idempotent via
-- this unique constraint + upsert in the API route.
create unique index if not exists idx_gpu_spot_prices_unique
  on gpu_spot_prices(snapshot_date, gpu_model, source);

create index if not exists idx_gpu_spot_prices_date
  on gpu_spot_prices(snapshot_date desc);

create index if not exists idx_gpu_spot_prices_model
  on gpu_spot_prices(gpu_model, snapshot_date desc);

alter table gpu_spot_prices enable row level security;
create policy "anon read gpu_spot_prices" on gpu_spot_prices
  for select to anon, authenticated using (true);

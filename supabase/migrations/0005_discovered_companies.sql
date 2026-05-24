-- Phase 4: VC portfolio scrapers create new company rows on the fly.
--
-- We want to:
--   * Distinguish manually-curated companies (from supabase/seed/data.ts) from
--     ones auto-discovered by a scraper.
--   * Track which scraper discovered each — so re-running a scraper can update
--     description / domain without conflict.
--   * Keep discovered cos OUT of the 3D graph until they're manually placed
--     on a layer (layer_id IS NOT NULL), so the visual stays curated.

alter table companies
  add column if not exists discovered_via text,        -- e.g. 'a16z', 'sequoia', 'manual'
  add column if not exists discovered_at  timestamptz;

create index if not exists idx_companies_discovered_via
  on companies(discovered_via) where discovered_via is not null;

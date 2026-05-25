-- Migration: 0040_logo_pipeline.sql
-- Logo auto-resolution pipeline. New companies (Phase 7A, Form D discovery,
-- manual seed) need a usable logo within 60s. The daily cron
-- /api/cron/logo-maintenance walks pending/missing rows and either resolves
-- a domain (Wikipedia infobox → DuckDuckGo fallback) or marks them as
-- 'missing' so the UI can render a monogram badge instead of a broken image.
--
-- logo_url    — optional override URL. When set, getLogoUrl() returns this
--               instead of the domain-based /api/logo/{domain} proxy. Useful
--               for cos where the domain favicon is poor quality and a manual
--               logo asset is preferred.
-- logo_status — pipeline state:
--                 'pending'  — never resolved (default for new rows)
--                 'verified' — domain resolves and /api/logo/{domain} returns
--                              a real (non-default-placeholder) image
--                 'fallback' — domain resolves but the proxy returned a
--                              generic placeholder (gstatic default favicon)
--                 'missing'  — no domain found OR proxy failed; UI shows monogram
-- logo_verified_at — last time the resolver actually ran for this row. Used
--                    by the cron to re-check stale ones (>30d).

alter table companies add column if not exists logo_url text;
alter table companies add column if not exists logo_status text default 'pending';
alter table companies add column if not exists logo_verified_at timestamptz;

-- Cheap partial index for the cron's "find work" query.
create index if not exists idx_companies_logo_status
  on companies (logo_status)
  where logo_status in ('pending', 'missing');

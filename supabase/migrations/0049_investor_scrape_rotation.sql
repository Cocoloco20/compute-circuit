-- Migration 0049 — rotation stamp for the portfolio scraper.
--
-- The scraper walks EDGAR Form D full-text search once per investor. With 8
-- investors that fit (barely) inside the 60s Vercel cap; the roster is about
-- to grow past 20 and it would not.
--
-- Rather than guess a fixed batch size, the scraper now works stalest-first
-- against a wall-clock deadline and stamps each investor as it finishes. Every
-- investor gets covered on a rotation, and a run that ends early still commits
-- the investors it did reach — which is the property `prices` lacked when it
-- spent 90 days timing out and writing nothing.

alter table investors add column if not exists last_scraped_at timestamptz;

comment on column investors.last_scraped_at is
  'Set by /api/cron/portfolio-scraper when that investor''s Form D walk completes. Null = never scraped, which sorts first.';

create index if not exists investors_scrape_rotation_idx
  on investors (last_scraped_at nulls first);

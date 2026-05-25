-- Phase 5g: Daily-close price history for sparkline charts.
--
-- Yahoo's chart endpoint already returns the full series in one call (we were
-- previously only reading meta). Store the trailing 90d as jsonb on the company
-- row so the drawer can render a sparkline without a second query.
--
-- Shape: [[ "YYYY-MM-DD", close_float ], ...] sorted ascending by date.
-- Length: capped at 90 in the cron upsert. A 90-day series at 8 chars/date +
-- 7 chars/price + JSON noise ≈ 1.5KB per company — trivial to stash inline.
--
-- We considered a separate price_history table with (company_id, date, close)
-- — better for ad-hoc time-series queries, but the drawer renders <1KB per
-- view and we never need history older than 90d for the UI, so jsonb wins on
-- read latency.

alter table companies
  add column if not exists price_history jsonb not null default '[]'::jsonb;

comment on column companies.price_history is
  'Trailing 90 daily closes as [[date, close], ...] (oldest first). Updated by /api/cron/prices.';

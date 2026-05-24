-- Phase 5a: market data + fundamentals for public companies
--
-- Two data sources, both free, both no-signup:
--   * Yahoo Finance chart endpoint — daily quote (price, prevClose, 52w range)
--   * SEC EDGAR companyfacts (XBRL) — quarterly + annual fundamentals
--
-- companies gets a current-snapshot price block so the drawer can render
-- instantly. Historical fundamentals live in their own table for time-series
-- queries / future charting.

alter table companies
  add column if not exists last_price            numeric,
  add column if not exists prev_close            numeric,
  add column if not exists fifty_two_week_high   numeric,
  add column if not exists fifty_two_week_low    numeric,
  add column if not exists price_currency        text,   -- 'USD', 'TWD' (TSM ADR may show USD), 'JPY' for raw foreign listings
  add column if not exists price_updated_at      timestamptz;

-- Time-series fundamentals from XBRL.
-- One row per (company, period, metric) — e.g. NVDA / 2026-04-26 / Revenue / 81,610,000,000
create table if not exists fundamentals (
  id           uuid primary key default gen_random_uuid(),
  company_id   text not null references companies(id) on delete cascade,
  period       date not null,                       -- period-end date (e.g. quarter end)
  period_type  text not null,                       -- 'TTM' | 'Q' | 'FY'
  metric       text not null,                       -- 'revenue' | 'gross_profit' | 'operating_income' | 'net_income' | 'fcf' | 'capex' | ...
  value        numeric not null,                    -- in source currency, whole dollars (or local equivalent)
  unit         text not null default 'USD',         -- 'USD' for SEC XBRL US filers
  source       text not null,                       -- 'sec-companyfacts'
  updated_at   timestamptz not null default now()
);

create unique index if not exists idx_fundamentals_unique
  on fundamentals(company_id, period, period_type, metric);

create index if not exists idx_fundamentals_company_period
  on fundamentals(company_id, period desc);
create index if not exists idx_fundamentals_metric
  on fundamentals(metric, period desc);

alter table fundamentals enable row level security;
create policy "anon read fundamentals" on fundamentals
  for select to anon, authenticated using (true);

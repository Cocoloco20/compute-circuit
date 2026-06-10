-- Migration 0045 — Phase 9: the investor layer.
--
-- Everything before this tracked the WORLD (2,461 cos, prices, filings,
-- insiders, contracts). This table tracks the USER: which names they own or
-- watch, at what cost, and where their buy/sell zones sit. The Pulse Board
-- "My Radar" strip and the daily email digest both read from here.
--
-- Single-user tool: anon role can READ (the page render uses anon), writes
-- go through /api/watchlist which authenticates with CRON_SECRET server-side
-- and uses the service role. No row-level user scoping needed.

create table if not exists watchlist (
  company_id        text primary key references companies(id),
  added_at          timestamptz not null default now(),
  -- Position (null = watching, not holding)
  shares            numeric,
  avg_cost_usd      numeric,
  -- Personal levels — the Radar flags when last_price crosses these
  target_buy_usd    numeric,
  target_sell_usd   numeric,
  -- Why you care, in your own words. Shown on the Radar card.
  thesis_note       text,
  alerts_enabled    boolean not null default true,
  updated_at        timestamptz not null default now()
);

alter table watchlist enable row level security;
do $$ begin
  create policy "anon read watchlist" on watchlist for select using (true);
exception when duplicate_object then null; end $$;

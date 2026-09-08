-- Migration 0046 — Security fix: drop the anon-read policy on watchlist.
-- HOLE 1: The policy "anon read watchlist" (created in 0045 line 29) leaks
-- shares, avg_cost_usd, target_buy_usd, target_sell_usd, and thesis_note
-- into the public SSR payload via fetchGraph(). The watchlist must only be
-- readable through an authenticated/service-role path (the /api/watchlist
-- GET endpoint and the Radar client), not via the anon key in graph-data.ts.

do $$ begin
  drop policy if exists "anon read watchlist" on watchlist;
exception when undefined_object then null; end $$;

-- The watchlist table retains RLS (enabled in 0045). With no SELECT policies,
-- the anon role cannot read any rows. Service-role (used by /api/watchlist
-- and cron jobs) bypasses RLS entirely and continues to work.
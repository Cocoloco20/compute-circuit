-- Phase 7b: Frontier-model leaderboard snapshot.
--
-- Daily ranking of top models from LMArena (Chatbot Arena ELO) and
-- Artificial Analysis. The ELO race is the only objective measure of
-- which lab is winning, so we want this front-and-center on every lab
-- node + on the Pulse Board.
--
-- Storage shape: one row per (snapshot_date, source, model_name). The
-- cron writes 30-50 rows/day across both sources; over a year that's
-- ~15k rows, trivially small.
--
-- Source notes:
--   * lmarena            — https://web.lmarena.ai/leaderboard. The public
--                          page embeds the rank table in __next_f.push
--                          payloads. ELO numbers are not in the public HTML
--                          (they live in pickle files only) — we store rank
--                          and leave elo_score null. UI sorts on rank.
--   * artificialanalysis — https://artificialanalysis.ai/api/v2/data/llms/models.
--                          Free public endpoint, gated behind an API key
--                          (AA_API_KEY env). When missing we just no-op
--                          this source — LMArena alone is enough signal.
--
-- company_id is nullable: many ranked models (DeepSeek, Qwen, Yi, Kimi,
-- Moonshot, etc) come from companies not yet in our DB. We still store
-- the row so the global ranking is complete; the UI just doesn't link
-- to a drawer for unmapped models.

create table if not exists model_leaderboard (
  id              uuid primary key default gen_random_uuid(),
  snapshot_date   date not null,
  source          text not null,                            -- 'lmarena' | 'artificialanalysis'
  model_name      text not null,                            -- e.g. 'claude-opus-4-7-thinking'
  company_id      text references companies(id) on delete set null,  -- null if not in DB
  elo_score       numeric,                                  -- nullable; LMArena public page doesn't expose
  elo_rank        int,                                      -- 1 = best. Always populated.
  params_b        numeric,                                  -- model size in B params (best-effort)
  license         text,                                     -- 'open' | 'closed' | 'unknown'
  created_at      timestamptz not null default now()
);

-- Re-running the cron on the same day is idempotent.
create unique index if not exists idx_model_leaderboard_unique
  on model_leaderboard(snapshot_date, source, model_name);

-- Drawer queries: "last N days of this co's models".
create index if not exists idx_model_leaderboard_company_date
  on model_leaderboard(company_id, snapshot_date desc)
  where company_id is not null;

-- Pulse Board "top globally" query.
create index if not exists idx_model_leaderboard_date_rank
  on model_leaderboard(snapshot_date desc, elo_rank);

alter table model_leaderboard enable row level security;
create policy "anon read model_leaderboard" on model_leaderboard
  for select to anon, authenticated using (true);

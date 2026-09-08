-- Migration 0048 — Milestone 1: the decision-memory layer.
--
-- Everything up to 0047 tracks the WORLD (2,461 companies, prices, filings,
-- insiders, contracts) and, in 0045, the USER'S POSITIONS. This migration
-- adds the third thing a fund actually runs on: WHAT WE DECIDED AND WHY.
--
--   pipeline_cards        deal flow — one row per company in the funnel
--   decisions             the reasoning at the moment of the call
--   decision_factors      weighted factors behind a decision (primary = 1.0)
--   decision_resurfacings the loop that closes: passed co. later raises/dies
--   notes                 free-form notes attached to a company
--   commit_log            audit trail of every mutation, newest first
--
-- SECURITY — read this before adding a policy.
-- Every table here is RLS-enabled with ZERO policies. That means the anon
-- role (the browser client, and supabaseServer()) can read nothing and write
-- nothing. All access goes through the service role: the /terminal server
-- component reads with supabaseServiceRole(), the /api/decisions and
-- /api/pipeline routes write with it behind Bearer CRON_SECRET.
--
-- This is deliberate and it is not negotiable. Migration 0045 shipped
-- `create policy "anon read watchlist" ... using (true)` and leaked position
-- sizes, cost basis and private thesis notes into the public SSR payload for
-- every visitor until 0046 dropped it. Decision reasoning is strictly more
-- sensitive than a cost basis. If you ever need a browser read here, add an
-- authenticated policy scoped to a real user — never `using (true)`.

-- ---------------------------------------------------------------- pipeline

create table if not exists pipeline_cards (
  company_id        text primary key references companies(id) on delete cascade,
  stage             text not null default 'Sourcing'
                      check (stage in ('Sourcing','Screening','DD','Term Sheet','Closed','Passed')),
  amount_usd        numeric,
  lead              text,
  owner             text,
  -- Drives the decision queue: a card is queued when deadline <= today EOD
  -- or stage = 'Term Sheet'. Null = no clock on it.
  deadline          date,
  -- days_in_stage is derived, never stored — stage changes stamp this.
  entered_stage_at  timestamptz not null default now(),
  flag              boolean not null default false,
  action_needed     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists pipeline_cards_stage_idx on pipeline_cards (stage);
create index if not exists pipeline_cards_deadline_idx on pipeline_cards (deadline);

alter table pipeline_cards enable row level security;

-- --------------------------------------------------------------- decisions

create table if not exists decisions (
  id                       uuid primary key default gen_random_uuid(),
  company_id               text not null references companies(id) on delete cascade,
  outcome                  text not null check (outcome in ('Pass','Advance','Invest')),
  primary_factor           text not null check (primary_factor in (
                             'Market Timing','Team','Product','Competition',
                             'Traction','Valuation','Thesis Fit','Other')),
  confidence               smallint not null check (confidence between 1 and 5),
  -- 1-3 sentences. The length bounds are enforced here as well as in the
  -- client so a stray API call can't write an empty or essay-length reason.
  reasoning                text not null check (char_length(reasoning) between 10 and 500),
  what_would_change_mind   text check (char_length(what_would_change_mind) <= 200),
  dissent                  boolean not null default false,
  decided_by               text not null default 'luigui',
  decided_at               timestamptz not null default now(),
  created_at               timestamptz not null default now()
);

create index if not exists decisions_company_idx on decisions (company_id, decided_at desc);
create index if not exists decisions_outcome_idx on decisions (outcome, primary_factor);
create index if not exists decisions_confidence_idx on decisions (confidence, outcome);

alter table decisions enable row level security;

create table if not exists decision_factors (
  id           uuid primary key default gen_random_uuid(),
  decision_id  uuid not null references decisions(id) on delete cascade,
  factor       text not null check (factor in (
                 'Market Timing','Team','Product','Competition',
                 'Traction','Valuation','Thesis Fit','Other')),
  weight       numeric not null default 1.0 check (weight >= 0 and weight <= 1),
  note         text,
  created_at   timestamptz not null default now()
);

create index if not exists decision_factors_decision_idx on decision_factors (decision_id);

alter table decision_factors enable row level security;

-- ------------------------------------------------------------- resurfacing

create table if not exists decision_resurfacings (
  id                uuid primary key default gen_random_uuid(),
  decision_id       uuid not null references decisions(id) on delete cascade,
  -- The trigger is NOT a foreign key on purpose. Triggers come from several
  -- existing tables that do not share a key space — funding_rounds.id,
  -- signals.id, insider_transactions.id — so this stores the source table
  -- plus that table's id, and the pair is what makes the job idempotent.
  trigger_source    text not null check (trigger_source in
                      ('funding_rounds','signals','transcript_signals','manual')),
  trigger_signal_id text not null,
  trigger_kind      text not null check (trigger_kind in
                      ('FundingRound','MA','Shutdown','IPO')),
  trigger_summary   text not null,
  trigger_date      date,
  trigger_url       text,
  verdict           text check (verdict in ('Yes','Partially','No')),
  verdict_by        text,
  verdict_at        timestamptz,
  verdict_note      text,
  created_at        timestamptz not null default now(),
  -- The nightly job re-runs over the whole signal history every night. This
  -- is what stops it from creating a duplicate card each time.
  unique (decision_id, trigger_source, trigger_signal_id)
);

create index if not exists resurfacings_unreviewed_idx
  on decision_resurfacings (created_at desc) where verdict is null;

alter table decision_resurfacings enable row level security;

-- ------------------------------------------------------------------- notes

create table if not exists notes (
  id          uuid primary key default gen_random_uuid(),
  company_id  text not null references companies(id) on delete cascade,
  body        text not null,
  author      text not null default 'luigui',
  created_at  timestamptz not null default now()
);

create index if not exists notes_company_idx on notes (company_id, created_at desc);

alter table notes enable row level security;

-- -------------------------------------------------------------- commit log

create table if not exists commit_log (
  id           uuid primary key default gen_random_uuid(),
  entity_type  text not null,          -- 'company' | 'pipeline_card' | 'decision' | 'note'
  entity_id    text not null,
  action       text not null,          -- 'stage_changed' | 'decision_captured' | 'resurface_verdict' | 'note_added'
  -- Full before/after payload. Kept as jsonb so the log survives schema
  -- changes to the tables it describes.
  diff         jsonb,
  summary      text not null,          -- human line: "Luigui moved Anthropic → Term Sheet"
  author       text not null default 'luigui',
  created_at   timestamptz not null default now()
);

create index if not exists commit_log_recent_idx on commit_log (created_at desc);
create index if not exists commit_log_entity_idx on commit_log (entity_type, entity_id, created_at desc);

alter table commit_log enable row level security;

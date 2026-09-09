-- Migration 0052 — Milestone 2: the fund's own money.
--
-- Until now the system tracked the world and the decisions. It did not track
-- the fund, which is why /terminal renders "Dry powder: —". These three tables
-- are the minimum that makes that a real number.
--
--   fund         one row. What was committed, what has been called.
--   investments  what actually went out the door, per company.
--   marks        what a position is worth now, and who says so.
--
-- Why marks are a separate table rather than a column on investments: a mark
-- has a DATE and a SOURCE, and the history is the point. "Marked at $4M post
-- on the Series A, 2026-03" and "written to zero, 2026-11" are two facts, not
-- one field overwritten. Overwriting destroys the record of how a view
-- changed, which is the same mistake as not recording decision reasoning.
--
-- Money is stored in whole USD as numeric. Never floats for money.
--
-- RLS on, zero policies — service-role only, like the rest of the decision
-- layer. This is the most sensitive data in the system.

create table if not exists fund (
  id                  text primary key default 'fund-i',
  name                text not null,
  vintage_year        integer,
  -- Committed is what the fund can ever deploy. For a solo GP writing his own
  -- cheques this is simply what he has decided to allocate.
  committed_usd       numeric not null default 0,
  called_usd          numeric not null default 0,
  -- Share of committed held back for follow-ons rather than first cheques.
  -- Dry powder for NEW investments is net of this.
  reserve_ratio       numeric not null default 0.5
                        check (reserve_ratio >= 0 and reserve_ratio <= 1),
  target_check_usd    numeric,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table if not exists investments (
  id            uuid primary key default gen_random_uuid(),
  company_id    text not null references companies(id) on delete restrict,
  invested_at   date not null,
  amount_usd    numeric not null check (amount_usd > 0),
  instrument    text not null default 'SAFE'
                  check (instrument in ('SAFE','Convertible Note','Equity','Token','Other')),
  round         text,
  -- Post-money valuation the cheque went in at. Null for uncapped notes.
  post_money_usd numeric,
  ownership_pct  numeric check (ownership_pct >= 0 and ownership_pct <= 100),
  -- Follow-on capital earmarked for this name, drawn from the reserve pool.
  reserved_usd   numeric not null default 0 check (reserved_usd >= 0),
  status        text not null default 'Active'
                  check (status in ('Active','Exited','Written Off')),
  -- The decision that authorised it, when there is one. Nullable because
  -- historical positions predate the log.
  decision_id   uuid references decisions(id) on delete set null,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists investments_company_idx on investments (company_id);
create index if not exists investments_status_idx  on investments (status, invested_at desc);

create table if not exists marks (
  id             uuid primary key default gen_random_uuid(),
  investment_id  uuid not null references investments(id) on delete cascade,
  marked_at      date not null,
  value_usd      numeric not null check (value_usd >= 0),
  -- Where the number comes from. An honest mark names its source; "Estimate"
  -- exists so a guess is labelled a guess rather than dressed as a round.
  source         text not null default 'Last Round'
                   check (source in ('Last Round','Secondary','Write-Down',
                                     'Write-Off','Exit','Estimate')),
  note           text,
  created_at     timestamptz not null default now(),
  -- One mark per investment per date per source, so a re-run cannot duplicate.
  unique (investment_id, marked_at, source)
);

create index if not exists marks_investment_idx on marks (investment_id, marked_at desc);

alter table fund        enable row level security;
alter table investments enable row level security;
alter table marks       enable row level security;

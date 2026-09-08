-- Migration 0051 — observed YC status changes.
--
-- The resurfacing job needs to know that a company we passed on LATER became
-- Acquired, Public or Inactive. Reading yc_companies.status cannot tell it
-- that: the column holds the status now, with no record of when it changed or
-- what it was before. Firing on the current value would resurface every
-- company that was already Acquired at import, which says nothing about a
-- decision made afterwards — and a false resurfacing is expensive, because it
-- trains you to ignore the stripe.
--
-- So the yc-directory cron appends a row here each time the daily change feed
-- reports a status transition. observed_at is when WE saw it, which is the
-- honest claim: the upstream feed does not publish the date the change
-- actually happened.
--
-- RLS on, zero policies — service-role only, like the rest of the decision
-- layer.

create table if not exists yc_status_changes (
  id           uuid primary key default gen_random_uuid(),
  company_id   text not null references companies(id) on delete cascade,
  from_status  text,
  to_status    text not null,
  observed_at  timestamptz not null default now(),
  -- One row per company per transition. The feed is re-read daily and would
  -- otherwise append a duplicate every run until the next change.
  unique (company_id, from_status, to_status, observed_at)
);

create index if not exists yc_status_changes_company_idx
  on yc_status_changes (company_id, observed_at desc);

alter table yc_status_changes enable row level security;

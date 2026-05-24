-- Compute Circuit initial schema
-- Run this in Supabase Dashboard → SQL Editor → New Query → Run
--
-- Design notes:
--   * Text primary keys on layers/companies/investors/bottlenecks so the artifact's
--     existing string IDs ("nvda", "a16z", "fab-capacity") port over without remapping.
--   * UUIDs for flows/signals/verifications (internally-generated, no natural key).
--   * flows.from/to is polymorphic (company OR investor); enforced via from_kind/to_kind
--     enums. FK integrity is checked at the app layer — the trade-off vs. dual FK columns
--     is simpler porting from the artifact.
--   * RLS is enabled on every table. Anon role gets SELECT only; the service_role key
--     (used by seed scripts and cron jobs) bypasses RLS for writes. When you add auth,
--     replace the "public read" policies with auth.uid()-scoped ones.

create extension if not exists pgcrypto;

-- ---------- Core taxonomy ----------

create table layers (
  id           text primary key,
  name         text not null,
  order_index  int  not null,
  y_position   numeric not null default 0
);

create table investors (
  id          text primary key,
  name        text not null,
  domain      text,
  thesis      text,
  created_at  timestamptz not null default now()
);

create table companies (
  id             text primary key,
  ticker         text,
  name           text not null,
  domain         text,
  layer_id       text references layers(id) on delete restrict,
  weight         numeric not null default 1,
  private        boolean not null default false,
  position_held  boolean not null default false,
  conviction     text,                 -- 'high'|'medium'|'low' (free-text for flexibility)
  thesis         text,
  share          numeric,              -- market/segment share, 0..1 or 0..100 (caller's choice)
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table company_backers (
  company_id  text references companies(id) on delete cascade,
  investor_id text references investors(id) on delete cascade,
  primary key (company_id, investor_id)
);

-- ---------- Flows ----------

create type flow_type as enum ('money','compute','energy','equipment','intel','venture');
create type node_kind as enum ('company','investor');

create table flows (
  id          uuid primary key default gen_random_uuid(),
  from_id     text not null,
  from_kind   node_kind not null,
  to_id       text not null,
  to_kind     node_kind not null,
  type        flow_type not null,
  magnitude   numeric not null default 1,
  note        text,
  created_at  timestamptz not null default now()
);

-- ---------- Bottlenecks ----------

create table bottlenecks (
  id             text primary key,
  name           text not null,
  between_above  text references layers(id),
  between_below  text references layers(id),
  layer_id       text references layers(id),
  severity       text,                 -- 'low'|'medium'|'high'|'critical'
  status         text,                 -- 'active'|'resolving'|'resolved'
  timeline       text,
  evidence       text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table bottleneck_beneficiaries (
  bottleneck_id text references bottlenecks(id) on delete cascade,
  company_id    text references companies(id) on delete cascade,
  primary key (bottleneck_id, company_id)
);

-- ---------- Signals (news, filings, events) ----------

create table signals (
  id          uuid primary key default gen_random_uuid(),
  date        date not null,
  source      text,
  headline    text not null,
  impact      text,
  url         text,
  created_at  timestamptz not null default now()
);

create table signal_companies (
  signal_id  uuid references signals(id) on delete cascade,
  company_id text references companies(id) on delete cascade,
  primary key (signal_id, company_id)
);

create table signal_bottlenecks (
  signal_id     uuid references signals(id) on delete cascade,
  bottleneck_id text references bottlenecks(id) on delete cascade,
  primary key (signal_id, bottleneck_id)
);

-- ---------- Verifications (claim audit trail) ----------

create table verifications (
  id                          uuid primary key default gen_random_uuid(),
  claim                       text not null,
  source                      text,
  what_would_need_to_be_true  text,
  verdict                     text,    -- 'true'|'false'|'partial'|'unknown'
  confidence                  numeric, -- 0..1
  created_at                  timestamptz not null default now()
);

-- ---------- Indexes ----------

create index idx_companies_layer       on companies(layer_id);
create index idx_companies_ticker      on companies(ticker) where ticker is not null;
create index idx_company_backers_inv   on company_backers(investor_id);
create index idx_flows_from            on flows(from_id, from_kind);
create index idx_flows_to              on flows(to_id, to_kind);
create index idx_flows_type            on flows(type);
create index idx_bottlenecks_layer     on bottlenecks(layer_id);
create index idx_bn_beneficiaries_co   on bottleneck_beneficiaries(company_id);
create index idx_signals_date          on signals(date desc);
create index idx_signal_companies_co   on signal_companies(company_id);

-- ---------- updated_at trigger ----------

create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_companies_updated_at
  before update on companies
  for each row execute function set_updated_at();

create trigger trg_bottlenecks_updated_at
  before update on bottlenecks
  for each row execute function set_updated_at();

-- ---------- Row Level Security ----------
--
-- Strategy for single-user phase: enable RLS everywhere, allow anon SELECT only.
-- Writes happen exclusively via service_role (seed script, cron jobs), which bypasses RLS.
-- When auth is added: drop the "public read" policies and replace with auth.uid()-scoped
-- ones. The schema itself won't need changes.

alter table layers                    enable row level security;
alter table investors                 enable row level security;
alter table companies                 enable row level security;
alter table company_backers           enable row level security;
alter table flows                     enable row level security;
alter table bottlenecks               enable row level security;
alter table bottleneck_beneficiaries  enable row level security;
alter table signals                   enable row level security;
alter table signal_companies          enable row level security;
alter table signal_bottlenecks        enable row level security;
alter table verifications             enable row level security;

create policy "anon read layers"                   on layers                    for select to anon, authenticated using (true);
create policy "anon read investors"                on investors                 for select to anon, authenticated using (true);
create policy "anon read companies"                on companies                 for select to anon, authenticated using (true);
create policy "anon read company_backers"          on company_backers           for select to anon, authenticated using (true);
create policy "anon read flows"                    on flows                     for select to anon, authenticated using (true);
create policy "anon read bottlenecks"              on bottlenecks               for select to anon, authenticated using (true);
create policy "anon read bottleneck_beneficiaries" on bottleneck_beneficiaries  for select to anon, authenticated using (true);
create policy "anon read signals"                  on signals                   for select to anon, authenticated using (true);
create policy "anon read signal_companies"         on signal_companies          for select to anon, authenticated using (true);
create policy "anon read signal_bottlenecks"       on signal_bottlenecks        for select to anon, authenticated using (true);
create policy "anon read verifications"            on verifications             for select to anon, authenticated using (true);

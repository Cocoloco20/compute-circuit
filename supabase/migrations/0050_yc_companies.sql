-- Migration 0050 — Y Combinator company directory.
--
-- 6,204 launched YC companies with the metadata that makes them filterable:
-- batch, status, industry, team size. Without those the import is 6,204
-- undifferentiated names, and 1,072 of them are already dead — the batch and
-- status columns are what turn a dump into a sourcing list.
--
-- Source: https://yc-oss.github.io/api (open dataset, GitHub Pages, rebuilt
-- daily from YC's Algolia index). UNOFFICIAL and carries no LICENSE file, so
-- this is for internal research only — do not redistribute the dataset.
-- YC's own robots.txt disallows /companies?* so the site directory is
-- deliberately NOT scraped.
--
-- Split from `companies` rather than adding columns to it: this is
-- source-specific metadata for one investor's cohort, and companies already
-- carries 40+ columns serving the compute graph.
--
-- RLS enabled with zero policies — service-role only, matching the decision
-- tables. Nothing client-side reads this; /pipeline and /terminal are server
-- components. Default-deny costs nothing here and is the house rule since the
-- 0045 watchlist leak.

create table if not exists yc_companies (
  company_id    text primary key references companies(id) on delete cascade,
  yc_id         bigint,
  slug          text,
  batch         text,                -- 'Summer 2009', 'Winter 2022'
  status        text,                -- Active | Inactive | Acquired | Public
  industry      text,
  subindustry   text,
  team_size     integer,
  one_liner     text,
  website       text,
  yc_url        text,
  top_company   boolean not null default false,
  launched_at   timestamptz,
  updated_at    timestamptz not null default now()
);

create index if not exists yc_companies_batch_idx  on yc_companies (batch);
create index if not exists yc_companies_status_idx on yc_companies (status);
-- The sourcing query is "active companies from recent batches", so index the pair.
create index if not exists yc_companies_live_idx   on yc_companies (status, batch);

alter table yc_companies enable row level security;

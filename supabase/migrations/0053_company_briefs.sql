-- Migration 0053 — what the company says it does, in its own words.
--
-- The deep-dive could tell you who backed a company and never what it built.
-- Walking Expanse on 2026-09-09 the system knew "NEA and IVP are in, 4 people,
-- Spring 2026" and nothing else — the first thing any human does is open the
-- website, and the tool could not.
--
-- 10,792 of 13,545 companies have a domain. This stores a short read of the
-- homepage: the title, the meta description, the headline, and a trimmed
-- extract. Not a crawl — one page, the one the company wrote to explain itself.
--
-- fetch_status records failures explicitly rather than leaving a null that is
-- indistinguishable from "not tried yet". A dead domain is a signal.

create table if not exists company_briefs (
  company_id    text primary key references companies(id) on delete cascade,
  url           text,
  title         text,
  description   text,          -- meta description / og:description
  headline      text,          -- first h1
  extract       text,          -- trimmed visible copy, capped
  fetch_status  text not null default 'ok'
                  check (fetch_status in ('ok','http_error','timeout','no_domain',
                                          'blocked','parse_empty','dns_error')),
  http_status   integer,
  fetched_at    timestamptz not null default now()
);

create index if not exists company_briefs_status_idx on company_briefs (fetch_status, fetched_at);
-- The refresh loop asks "who is stalest" every run; index the sort it uses.
create index if not exists company_briefs_stale_idx  on company_briefs (fetched_at);

alter table company_briefs enable row level security;

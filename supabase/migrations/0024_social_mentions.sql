-- Phase 7c: Social mention velocity tracking.
--
-- Tracks Hacker News stories and Reddit posts referencing our companies.
--
-- Storage shape: one row per (company_id, snapshot_date, source).
-- Unique constraint enforces idempotency on cron re-runs.

create table if not exists social_mentions (
  id                  uuid primary key default gen_random_uuid(),
  company_id          text not null references companies(id) on delete cascade,
  snapshot_date       date not null,
  source              text not null, -- 'hn' | 'reddit'
  mentions_24h        int not null default 0,
  mentions_7d         int not null default 0,
  top_post_url        text,
  top_post_title      text,
  top_post_score      int,
  top_post_comments   int,
  sample_subreddits   text[],
  created_at          timestamptz not null default now()
);

-- Re-running the cron on the same day is idempotent.
create unique index if not exists idx_social_mentions_unique
  on social_mentions(company_id, snapshot_date, source);

-- Drawer queries: "last N days of this co's mentions".
create index if not exists idx_social_mentions_company_date
  on social_mentions(company_id, snapshot_date desc);

alter table social_mentions enable row level security;
create policy "anon read social_mentions" on social_mentions
  for select to anon, authenticated using (true);

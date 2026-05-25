-- Migration: 0033_github_velocity.sql
-- Add commits and lines changed velocity metrics to the github_activity table.

alter table github_activity add column if not exists commits_7d int;
alter table github_activity add column if not exists commits_30d int;
alter table github_activity add column if not exists distinct_committers_30d int;
alter table github_activity add column if not exists lines_added_30d int;
alter table github_activity add column if not exists lines_removed_30d int;
alter table github_activity add column if not exists commits_weekly_history jsonb default '[]'::jsonb;

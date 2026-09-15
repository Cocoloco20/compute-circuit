-- Rate limiting for the public /api/contracts JSON endpoint.
--
-- One row per (ip, hour). increment_rate_limit() is a single atomic
-- upsert-and-return so concurrent requests from the same IP can't race past
-- the limit. Service-role only -- RLS is enabled with no public policies,
-- so anon/authenticated callers cannot read or write this table directly;
-- only the route's service-role client (via the RPC) can.

create table if not exists api_rate_limits (
  ip text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (ip, window_start)
);

alter table api_rate_limits enable row level security;

create or replace function increment_rate_limit(p_ip text, p_window timestamptz)
returns int
language sql
security definer
set search_path = public
as $$
  insert into api_rate_limits (ip, window_start, count)
  values (p_ip, p_window, 1)
  on conflict (ip, window_start)
  do update set count = api_rate_limits.count + 1
  returning count;
$$;

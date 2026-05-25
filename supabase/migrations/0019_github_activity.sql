-- Phase 7: GitHub activity tracker — mirrors hf_activity (0010).
--
-- For each company with a primary open-source repo, snapshot daily:
--   * star count
--   * last-30-day merged + open PR counts (velocity proxy)
--   * unique contributor count over last 30 days
--   * most-recent release (tag + date)
--
-- Same source-of-truth pattern as hf_activity: one row per
-- (company_id, snapshot_date), upsert idempotent on re-run.
--
-- Source: GitHub REST API at api.github.com. Public unauthenticated
-- limit is 60 req/hour — we hit 3 endpoints per repo × ~22 repos = 66
-- requests/day, which fits comfortably (the cron runs once daily and
-- backs off cleanly on the rare 403).

-- ----- companies.github_repo -----
alter table companies
  add column if not exists github_repo text;
create index if not exists idx_companies_github_repo
  on companies(github_repo) where github_repo is not null;

-- ----- github_activity snapshots -----
create table if not exists github_activity (
  id                   uuid primary key default gen_random_uuid(),
  company_id           text not null references companies(id) on delete cascade,
  snapshot_date        date not null,
  repo_full_name       text not null,                          -- e.g. "openai/openai-python"
  stars                int  not null default 0,
  prs_30d_merged       int  not null default 0,
  prs_30d_open         int  not null default 0,                -- opened in last 30d, still in any state
  contributors_30d     int  not null default 0,                -- unique authors of merged PRs in window
  last_release_tag     text,                                   -- e.g. "v1.5.2"
  last_release_date    date,
  created_at           timestamptz not null default now()
);

create unique index if not exists idx_github_activity_unique
  on github_activity(company_id, snapshot_date);

create index if not exists idx_github_activity_company
  on github_activity(company_id, snapshot_date desc);

alter table github_activity enable row level security;
create policy "anon read github_activity" on github_activity
  for select to anon, authenticated using (true);

-- ----- backfill companies.github_repo for 17 cos with public primary repos -----
-- Case-sensitive. Skipped (no/private repo): reka, pplx, fireworks, runway,
-- sambanova, lightmatter, vrt, figure, apptronik, wayve, ionq, oklo.
update companies set github_repo = 'openai/openai-python'              where id = 'openai';
update companies set github_repo = 'anthropics/anthropic-sdk-python'   where id = 'anthropic';
update companies set github_repo = 'facebookresearch/llama'            where id = 'meta-ai';
update companies set github_repo = 'google/jax'                        where id = 'googl';
update companies set github_repo = 'microsoft/onnxruntime'             where id = 'msft';
update companies set github_repo = 'NVIDIA/TensorRT-LLM'               where id = 'nvda';
update companies set github_repo = 'aws/amazon-sagemaker-examples'     where id = 'amzn';
update companies set github_repo = 'huggingface/transformers'          where id = 'huggingface';
update companies set github_repo = 'mistralai/mistral-inference'       where id = 'mistral';
update companies set github_repo = 'cohere-ai/cohere-python'           where id = 'cohere';
update companies set github_repo = 'xai-org/grok-1'                    where id = 'xai';
-- databricks/dbrx and scaleapi/scale-python-sdk are 404 — use the active
-- SDKs instead (dbrx was deleted; scale-python-sdk was renamed).
update companies set github_repo = 'databricks/databricks-sdk-py'      where id = 'databricks';
update companies set github_repo = 'scaleapi/scaleapi-python-client'   where id = 'scale';
update companies set github_repo = 'togethercomputer/RedPajama-Data'   where id = 'together';
update companies set github_repo = 'basetenlabs/truss'                 where id = 'baseten';
update companies set github_repo = 'modal-labs/modal-client'           where id = 'modal';
update companies set github_repo = 'replicate/cog'                     where id = 'replicate';
update companies set github_repo = 'groq/groq-python'                  where id = 'groq';
update companies set github_repo = 'Cerebras/modelzoo'                 where id = 'cerebras';
update companies set github_repo = 'tenstorrent/tt-metal'              where id = 'tenstorrent';

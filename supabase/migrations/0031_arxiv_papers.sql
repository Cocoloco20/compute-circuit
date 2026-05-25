-- Migration: 0031_arxiv_papers.sql
-- Add arxiv_affiliation column to companies and create arxiv_papers and arxiv_snapshots tables.

alter table companies add column if not exists arxiv_affiliation text;

create table if not exists arxiv_papers (
  id                  uuid primary key default gen_random_uuid(),
  company_id          text not null references companies(id) on delete cascade,
  arxiv_id            text unique not null,
  title               text not null,
  summary             text,
  authors             text[],
  primary_category    text,
  published_date      date not null,
  url                 text,
  created_at          timestamptz not null default now()
);

create table if not exists arxiv_snapshots (
  id                  uuid primary key default gen_random_uuid(),
  company_id          text not null references companies(id) on delete cascade,
  snapshot_date       date not null,
  papers_30d          int not null default 0,
  papers_7d           int not null default 0,
  top_paper_arxiv_id  text,
  top_paper_title     text,
  yoy_pct             numeric,
  created_at          timestamptz not null default now()
);

-- Idempotency constraint for snapshots
create unique index if not exists idx_arxiv_snapshots_unique
  on arxiv_snapshots(company_id, snapshot_date);

-- Fast lookup indexes
create index if not exists idx_arxiv_papers_company_published
  on arxiv_papers(company_id, published_date desc);

create index if not exists idx_arxiv_snapshots_company_date
  on arxiv_snapshots(company_id, snapshot_date desc);

-- RLS setup
alter table arxiv_papers enable row level security;
alter table arxiv_snapshots enable row level security;

create policy "anon read arxiv_papers" on arxiv_papers
  for select to anon, authenticated using (true);

create policy "anon read arxiv_snapshots" on arxiv_snapshots
  for select to anon, authenticated using (true);

-- Backfill arxiv_affiliation for ~25 cos
update companies set arxiv_affiliation = 'OpenAI' where id = 'openai';
update companies set arxiv_affiliation = 'Anthropic' where id = 'anthropic';
update companies set arxiv_affiliation = 'Meta AI Research || FAIR' where id = 'meta-ai';
update companies set arxiv_affiliation = 'Google DeepMind || Google Research' where id = 'googl';
update companies set arxiv_affiliation = 'Google DeepMind' where id = 'deepmind';
update companies set arxiv_affiliation = 'Microsoft Research' where id = 'microsoft';
update companies set arxiv_affiliation = 'Microsoft Research' where id = 'msft';
update companies set arxiv_affiliation = 'AWS AI Labs || Amazon Research' where id = 'amzn';
update companies set arxiv_affiliation = 'NVIDIA Research || NVIDIA' where id = 'nvda';
update companies set arxiv_affiliation = 'Mistral AI' where id = 'mistral';
update companies set arxiv_affiliation = 'Cohere For AI || Cohere' where id = 'cohere';
update companies set arxiv_affiliation = 'Hugging Face' where id = 'huggingface';
update companies set arxiv_affiliation = 'Databricks Mosaic Research || MosaicML' where id = 'databricks';
update companies set arxiv_affiliation = 'IBM Research' where id = 'ibm';
update companies set arxiv_affiliation = 'Groq' where id = 'groq';
update companies set arxiv_affiliation = 'Cerebras Systems' where id = 'cerebras';
update companies set arxiv_affiliation = 'Tenstorrent' where id = 'tenstorrent';
update companies set arxiv_affiliation = 'SambaNova Systems' where id = 'sambanova';
update companies set arxiv_affiliation = 'Perplexity AI' where id = 'pplx';
update companies set arxiv_affiliation = 'Reka AI' where id = 'reka';
update companies set arxiv_affiliation = 'xAI || X.AI' where id = 'xai';
update companies set arxiv_affiliation = 'Scale AI' where id = 'scale';
update companies set arxiv_affiliation = 'IonQ' where id = 'ionq';

-- Migration: 0029_interest_signals.sql
-- Add wikipedia_slug and google_trends_term columns to companies and create the interest_signals table.

alter table companies add column if not exists wikipedia_slug text;
alter table companies add column if not exists google_trends_term text;

create table if not exists interest_signals (
  id                      uuid primary key default gen_random_uuid(),
  company_id              text not null references companies(id) on delete cascade,
  snapshot_date           date not null,
  wikipedia_views_7d      int,
  wikipedia_views_28d     int,
  wikipedia_yoy_pct       numeric,
  google_trends_score     int,       -- 0-100 normalized
  google_trends_7d_delta  int,       -- vs 7d ago
  created_at              timestamptz not null default now()
);

-- Indexing for lookup speed and idempotency.
create unique index if not exists idx_interest_signals_unique
  on interest_signals(company_id, snapshot_date);

create index if not exists idx_interest_signals_company_date
  on interest_signals(company_id, snapshot_date desc);

-- RLS setup.
alter table interest_signals enable row level security;

create policy "anon read interest_signals" on interest_signals
  for select to anon, authenticated using (true);

-- Backfill top ~50 companies.
update companies set wikipedia_slug = 'Constellation_Energy', google_trends_term = 'Constellation Energy' where id = 'ceg';
update companies set wikipedia_slug = 'Vistra_(company)', google_trends_term = 'Vistra' where id = 'vst';
update companies set wikipedia_slug = 'Talen_Energy', google_trends_term = 'Talen Energy' where id = 'talen';
update companies set wikipedia_slug = 'NextEra_Energy', google_trends_term = 'NextEra Energy' where id = 'nee';
update companies set wikipedia_slug = 'Oklo_Inc.', google_trends_term = 'Oklo' where id = 'oklo';
update companies set wikipedia_slug = 'ASML_Holding', google_trends_term = 'ASML' where id = 'asml';
update companies set wikipedia_slug = 'Applied_Materials', google_trends_term = 'Applied Materials' where id = 'amat';
update companies set wikipedia_slug = 'Lam_Research', google_trends_term = 'Lam Research' where id = 'lrcx';
update companies set wikipedia_slug = 'KLA_Corporation', google_trends_term = 'KLA Corporation' where id = 'klac';
update companies set wikipedia_slug = 'Tokyo_Electron', google_trends_term = 'Tokyo Electron' where id = 'tel';
update companies set wikipedia_slug = 'SUMCO', google_trends_term = 'SUMCO' where id = 'sumco';
update companies set wikipedia_slug = 'Shin-Etsu_Chemical', google_trends_term = 'Shin-Etsu' where id = 'shin-etsu';
update companies set wikipedia_slug = 'Entegris', google_trends_term = 'Entegris' where id = 'entegris';
update companies set wikipedia_slug = 'JSR_Corporation', google_trends_term = 'JSR Corporation' where id = 'jsr';
update companies set wikipedia_slug = 'TSMC', google_trends_term = 'TSMC' where id = 'tsm';
update companies set wikipedia_slug = 'Intel', google_trends_term = 'Intel' where id = 'intc';
update companies set wikipedia_slug = 'Samsung_Electronics', google_trends_term = 'Samsung Foundry' where id = 'samsung-fdy';
update companies set wikipedia_slug = 'GlobalFoundries', google_trends_term = 'GlobalFoundries' where id = 'gfs';
update companies set wikipedia_slug = 'Micron_Technology', google_trends_term = 'Micron Technology' where id = 'mu';
update companies set wikipedia_slug = 'SK_Hynix', google_trends_term = 'SK Hynix' where id = 'hynix';
update companies set wikipedia_slug = 'Samsung_Electronics', google_trends_term = 'Samsung Memory' where id = 'samsung-mem';
update companies set wikipedia_slug = 'Nvidia', google_trends_term = 'NVIDIA' where id = 'nvda';
update companies set wikipedia_slug = 'Advanced_Micro_Devices', google_trends_term = 'AMD' where id = 'amd';
update companies set wikipedia_slug = 'Broadcom_Inc.', google_trends_term = 'Broadcom' where id = 'avgo';
update companies set wikipedia_slug = 'Marvell_Technology_Group', google_trends_term = 'Marvell' where id = 'mrvl';
update companies set wikipedia_slug = 'Arm_Holdings', google_trends_term = 'Arm' where id = 'arm';
update companies set wikipedia_slug = 'Qualcomm', google_trends_term = 'Qualcomm' where id = 'qcom';
update companies set wikipedia_slug = 'Groq', google_trends_term = 'Groq' where id = 'groq';
update companies set wikipedia_slug = 'Cerebras_Systems', google_trends_term = 'Cerebras' where id = 'cerebras';
update companies set wikipedia_slug = 'SambaNova_Systems', google_trends_term = 'SambaNova' where id = 'sambanova';
update companies set wikipedia_slug = 'Tenstorrent', google_trends_term = 'Tenstorrent' where id = 'tenstorrent';
update companies set wikipedia_slug = 'CoreWeave', google_trends_term = 'CoreWeave' where id = 'crwv';
update companies set wikipedia_slug = 'Nebius_Group', google_trends_term = 'Nebius' where id = 'nbis';
update companies set wikipedia_slug = 'Vertiv', google_trends_term = 'Vertiv' where id = 'vrt';
update companies set wikipedia_slug = 'Arista_Networks', google_trends_term = 'Arista Networks' where id = 'anet';
update companies set wikipedia_slug = 'Equinix', google_trends_term = 'Equinix' where id = 'eqix';
update companies set wikipedia_slug = 'Digital_Realty', google_trends_term = 'Digital Realty' where id = 'dlr';
update companies set wikipedia_slug = 'Amazon_(company)', google_trends_term = 'Amazon Web Services' where id = 'amzn';
update companies set wikipedia_slug = 'Microsoft', google_trends_term = 'Microsoft Azure' where id = 'msft';
update companies set wikipedia_slug = 'Google', google_trends_term = 'Google Cloud' where id = 'googl';
update companies set wikipedia_slug = 'Oracle_Corporation', google_trends_term = 'Oracle Cloud' where id = 'orcl';
update companies set wikipedia_slug = 'IBM', google_trends_term = 'IBM' where id = 'ibm';
update companies set wikipedia_slug = 'OpenAI', google_trends_term = 'OpenAI' where id = 'openai';
update companies set wikipedia_slug = 'Anthropic', google_trends_term = 'Anthropic' where id = 'anthropic';
update companies set wikipedia_slug = 'XAI_(company)', google_trends_term = 'xAI' where id = 'xai';
update companies set wikipedia_slug = 'Meta_Platforms', google_trends_term = 'Meta AI' where id = 'meta-ai';
update companies set wikipedia_slug = 'Google_DeepMind', google_trends_term = 'Google DeepMind' where id = 'deepmind';
update companies set wikipedia_slug = 'Mistral_AI', google_trends_term = 'Mistral AI' where id = 'mistral';
update companies set wikipedia_slug = 'Cohere', google_trends_term = 'Cohere' where id = 'cohere';

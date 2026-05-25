-- Phase 7b: Earnings-transcript NLP signal.
--
-- For each public co, the daily transcripts cron scans recent 8-K filings
-- with item 2.02 ("Results of Operations") — those carry the quarterly
-- earnings press release, which is the only earnings-related text we can
-- reliably pull from SEC EDGAR. Actual call transcripts (Q&A) live on
-- Seeking Alpha / Roic.ai and are not scrape-friendly.
--
-- Pipeline (see src/lib/transcripts.ts + /api/cron/transcripts):
--   1) Pull last-4-quarters 8-Ks via SEC submissions.json.
--   2) Filter to item==2.02 (earnings results). Skip everything else.
--   3) Fetch the primary press-release exhibit (HTML or txt).
--   4) Strip HTML, run a lexicon-based scorer (extractTranscriptSignal):
--        - AI mentions:          "AI", "artificial intelligence", ...
--        - GPU mentions:         "GPU", "H100/H200/B200", "Blackwell", ...
--        - Capex mentions:       "capex", "capital expenditure", ...
--        - Data-center mentions: "data center", "compute capacity", ...
--        - Token mentions:       "tokens", "tokens per second", ...
--   5) Regex-pull sentences containing capex+$, tokens+number,
--      GPU+deployed/shipped/available — stored as extracted_phrases jsonb.
--
-- Volume: ~30 public CIKs × ~4 quarters = ~120 rows steady-state. Each row
-- is small (jsonb phrases capped at ~8 sentences). Total table footprint
-- stays well under 1 MB even at scale.

create table if not exists transcript_signals (
  id                       uuid primary key default gen_random_uuid(),
  company_id               text not null references companies(id) on delete cascade,
  filed_date               date not null,
  accession                text not null,                          -- SEC accession; dedup key
  ai_mentions              int not null default 0,
  gpu_mentions             int not null default 0,
  capex_mentions           int not null default 0,
  data_center_mentions     int not null default 0,
  token_mentions           int not null default 0,
  extracted_phrases        jsonb not null default '[]'::jsonb,     -- [{phrase, context_snippet}, ...]
  source_url               text,                                   -- canonical URL to the filing folder
  created_at               timestamptz not null default now()
);

-- One 8-K item-2.02 release per (company, accession). Re-running the cron
-- is idempotent via this unique index + upsert in the API route.
create unique index if not exists idx_transcript_signals_unique
  on transcript_signals(company_id, accession);

create index if not exists idx_transcript_signals_company_date
  on transcript_signals(company_id, filed_date desc);

create index if not exists idx_transcript_signals_filed_date
  on transcript_signals(filed_date desc);

alter table transcript_signals enable row level security;
create policy "anon read transcript_signals" on transcript_signals
  for select to anon, authenticated using (true);

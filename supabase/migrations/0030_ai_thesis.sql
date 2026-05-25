-- Phase 7c: AI-generated thesis cards per company.
--
-- The vision: "I want a nobody to get in here and know what they need to know."
-- Most companies have empty `thesis` fields. We use Claude Sonnet 4.5 to generate
-- a tight 2-sentence summary + a 1-sentence risk/opportunity for each company,
-- grounded in whatever context data we have (recent 8-Ks, news, patents, funding,
-- hiring). The AI output lives in separate columns so it can coexist with any
-- manual `thesis` an analyst writes.
--
-- Storage shape:
--   * thesis_ai          — the 2-sentence "what + why" summary
--   * thesis_risk_ai     — the 1-sentence risk or opportunity
--   * thesis_generated_at — timestamp so the drawer can show "AI-generated · {date}"
--
-- The script that fills these columns is idempotent: it skips any company where
-- thesis_ai already exists (LENGTH ≥ 30) to avoid double-billing on re-runs.

alter table companies
  add column if not exists thesis_ai           text,
  add column if not exists thesis_risk_ai      text,
  add column if not exists thesis_generated_at timestamptz;

-- Cron-like queries: "all companies that still need a thesis"
create index if not exists idx_companies_thesis_ai_missing
  on companies(id)
  where thesis_ai is null or length(thesis_ai) < 30;

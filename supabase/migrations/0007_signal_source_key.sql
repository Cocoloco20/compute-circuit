-- Phase 5b: news signals
--
-- Existing dedup on signals.accession_number is SEC-specific. News articles
-- need their own per-source unique key — typically the URL hash or the
-- (company, link) tuple, since the same article can mention multiple cos.
--
-- source_key is treated as opaque by the schema — caller decides the format.
-- For news: "news:{company_id}:{article_url}"
-- For other future sources: "{source}:{whatever}"

alter table signals
  add column if not exists source_key text;

create unique index if not exists idx_signals_source_key
  on signals(source_key) where source_key is not null;

create index if not exists idx_signals_source
  on signals(source) where source is not null;

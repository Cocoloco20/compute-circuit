-- ON CONFLICT in supabase-js can't target a partial unique index — Postgres
-- needs the index to be non-partial (or the upsert needs to repeat the same
-- WHERE clause, which supabase-js doesn't expose).
--
-- Replace the partial index from 0002 with a full unique index. Standard
-- Postgres NULLS-DISTINCT semantics still let manually-entered signals with
-- accession_number = NULL coexist (multiple NULLs are allowed by default).

drop index if exists idx_signals_accession;

create unique index if not exists idx_signals_accession
  on signals(accession_number);

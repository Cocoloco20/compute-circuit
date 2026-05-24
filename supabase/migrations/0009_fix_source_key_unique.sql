-- Same fix as 0003 vs 0002: ON CONFLICT can't target a partial unique index
-- via supabase-js. Replace partial unique on signals.source_key with a full
-- unique index. NULLS DISTINCT default lets existing rows with source_key
-- NULL coexist.

drop index if exists idx_signals_source_key;
create unique index if not exists idx_signals_source_key
  on signals(source_key);

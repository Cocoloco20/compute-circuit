-- Where a brief's words actually came from.
--
-- Until now every row in company_briefs was the company's own homepage, so
-- provenance was implicit. Adding a Wikipedia fallback breaks that assumption:
-- OpenAI and xAI return 403 to any unauthenticated GET, and a third party's
-- encyclopedia entry is a fundamentally different kind of claim from what a
-- company says about itself on its own front page. The UI leads with "What they
-- say they do" — that sentence is a lie if the text is Wikipedia's.
--
-- So the source is recorded per row, not inferred. Existing rows are homepage
-- reads by construction, which is why the backfill is unconditional.
alter table company_briefs add column if not exists source text not null default 'homepage';

-- 'homepage'  — the company's own root page (preferred; primary source)
-- 'wikipedia' — en.wikipedia.org summary, used only when the homepage refused
--               or returned nothing usable
alter table company_briefs drop constraint if exists company_briefs_source_check;
alter table company_briefs add constraint company_briefs_source_check
  check (source in ('homepage', 'wikipedia'));

-- Failures are not settled facts. A 403 today may be a 200 next week, so the
-- cron retries a failed read sooner than it refreshes a good one; this index
-- keeps that lookup cheap as the table grows past the reference layer's size.
create index if not exists company_briefs_status_fetched
  on company_briefs (fetch_status, fetched_at desc);

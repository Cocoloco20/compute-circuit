-- How we know a fund backs a company.
--
-- company_backers was a bare (company_id, investor_id) pair, which quietly
-- asserted certainty the import never had. 6,611 of 8,427 scraped portfolio
-- entries carry no independent identity signal: the fund lists a NAME and links
-- to its own site, so joining that to one of our rows is a guess based on the
-- name matching. Usually right. Sometimes catastrophically wrong.
--
-- Worked example, 2026-09-09: a screen ranked YC's "Astro" (Winter 2025, one
-- person, Texas utility-scale solar) as the strongest signal in the dataset
-- because Accel and Lightspeed both appeared to back it. Accel's "Astro" is
-- astronauts.id, Indonesian grocery delivery. Lightspeed's "Astro" is
-- astro.build, the web framework. Three unrelated companies, one name, one
-- false conclusion presented as the best lead we had.
--
-- So the evidence travels with the edge. A screen that makes a claim about who
-- backs whom filters on match_method = 'domain'; everything else is a lead to
-- confirm, not a fact to report.
alter table company_backers add column if not exists match_method text;
alter table company_backers add column if not exists source_url text;

alter table company_backers drop constraint if exists company_backers_match_method_check;
alter table company_backers add constraint company_backers_match_method_check
  check (match_method is null or match_method in ('domain','slug','name','manual','source'));

-- 'domain' — the fund's listed URL resolves to the company's own domain. Trusted.
-- 'slug'   — matched on a unique slug on the fund's own domain. Fairly trusted.
-- 'source' — the fund IS the source of record for the row (YC on a yc-* company).
-- 'name'   — normalised-name match only. NOT evidence of identity.
-- 'manual' — a human asserted it.

create index if not exists company_backers_method on company_backers (match_method);

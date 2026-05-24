-- Phase 5b backfill: domain enrichment + SPV/fund-vehicle cleanup
--
-- The Form-D discovery cron found 103 entities. A background agent run
-- (web-searched each name) classified them:
--   - 18 are real portfolio companies (mostly Khosla 2008-2014 cleantech bets,
--     plus Pinterest, RingCentral, Oscar Health). Update their domain so the
--     logo proxy can find a favicon.
--   - 85 are fund vehicles / SPVs that filed Form D themselves (Coatue's
--     "CT XXX LLC" series, Claremount = Thrive Capital's flagship funds,
--     Lindenwood Ltd = Greenoaks fund, etc.). Delete these — they're not
--     actually portfolio companies, just the legal vehicle through which
--     each investment was made.
--
-- The Form-D scraper now has a stronger SPV filter (src/lib/scrapers/edgar-form-d.ts
-- isLikelyVcShell()), so future runs won't re-add these.

-- ----- 18 real cos: backfill domain -----
update companies set domain = 'unisfair.com',           notes = coalesce(notes || E'\n', '') || 'Acquired by InterCall (West Corp) 2011, virtual events platform' where id = 'unisfair-inc';
update companies set domain = 'skype.com',              notes = coalesce(notes || E'\n', '') || 'Acquired by Microsoft 2011, sunset May 2025'                  where id = 'skype-global-s-a-r-l';
update companies set domain = 'anki.com',               notes = coalesce(notes || E'\n', '') || 'Shut down April 2019; IP acquired by Digital Dream Labs'    where id = 'anki-inc';
update companies set domain = 'pinterest.com'                                                                                                              where id = 'pinterest-inc-pins';
update companies set domain = 'platfora.com',           notes = coalesce(notes || E'\n', '') || 'Acquired by Workday 2016, Hadoop BI tools'                  where id = 'platfora-inc';
update companies set domain = 'easic.com',              notes = coalesce(notes || E'\n', '') || 'Acquired by Intel 2018, structured ASICs'                    where id = 'easic-corp';
update companies set domain = 'segetis.com',            notes = coalesce(notes || E'\n', '') || 'Assets acquired by GFBiochemicals 2016, bio-based chemicals' where id = 'segetis-inc';
update companies set domain = 'sp-incorp.com',          notes = coalesce(notes || E'\n', '') || 'Acquired by Himax Display ~2012, microdisplays'              where id = 'spatial-photonics-inc';
update companies set domain = 'view.com',               notes = coalesce(notes || E'\n', '') || 'Renamed to View Inc 2012, smart glass; SPAC then ch.11 2023' where id = 'soladigm-inc';
update companies set domain = 'nanoh2o.com',            notes = coalesce(notes || E'\n', '') || 'Acquired by LG Chem 2014, RO desalination membranes'        where id = 'nanoh2o-inc';
update companies set domain = 'greenlightbiosciences.com', notes = coalesce(notes || E'\n', '') || 'Cell-free RNA, was NASDAQ:GRNA, taken private 2023'      where id = 'greenlight-biosciences-inc';
update companies set domain = 'ringcentral.com'                                                                                                              where id = 'ringcentral-inc-rng';
update companies set domain = 'danotekmotion.com',      notes = coalesce(notes || E'\n', '') || 'Wind turbine PM generators, Ann Arbor MI'                   where id = 'danotek-motion-technologies-inc';
update companies set domain = 'nirvanix.com',           notes = coalesce(notes || E'\n', '') || 'Shut down Sept 2013, ch.11 bankruptcy'                       where id = 'nirvanix-inc';
update companies set domain = 'thehunt.com',            notes = coalesce(notes || E'\n', '') || 'dba The Hunt, social shopping app; site now defunct'        where id = 'shoptap-inc';
update companies set domain = 'ls9.com',                notes = coalesce(notes || E'\n', '') || 'Acquired by REG (now REG Life Sciences) 2014'                where id = 'ls9-inc';
update companies set domain = 'seamicro.com',           notes = coalesce(notes || E'\n', '') || 'Acquired by AMD 2012 for $334M; product line discontinued 2015' where id = 'seamicro-inc';
update companies set domain = 'hioscar.com',            notes = coalesce(notes || E'\n', '') || 'Original legal name of Oscar Health (OSCR) before 2021 rename' where id = 'mulberry-health-inc-oscr';

-- ----- 85 SPVs / fund vehicles: delete (cascades to company_backers) -----
delete from companies where id in (
  -- Founders Fund: Spark/Benchmark/Voyager fund vehicles + Lembas
  'spark-capital-founders-fund-iv-l-p',
  'spark-capital-founders-fund-iii-l-p',
  'lembas-iii-lp',
  'spark-capital-growth-founders-fund-l-p',
  'benchmark-founders-fund-viii-l-p',
  'voyager-capital-founders-fund-iv-l-p',
  -- Coatue's fund family + 60+ CT NN LLC per-investment SPVs
  'coatue-select-fund-lp', 'exuma-offshore-fund-ltd',
  'coatue-hybrid-offshore-feeder-fund-i-lp', 'coatue-hybrid-fund-i-lp',
  'coatue-offshore-fund-ltd', 'coatue-long-only-offshore-fund-ltd',
  'coatue-ct-104-llc', 'coatue-smart-transportation-fund-i-lp',
  'coatue-ct-102-llc', 'coatue-ct-127-llc', 'coatue-ct-138-llc',
  'coatue-ct-121-llc', 'coatue-ct-107-llc', 'coatue-ct-93-llc',
  'coatue-ct-94-llc', 'coatue-ventures-ii-lp', 'coatue-quant-onshore-feeder-fund-lp',
  'coatue-long-only-partners-lp', 'coatue-ventures-iii-lp',
  'coatue-offshore-fund-ii-ltd', 'coatue-climate-tech-fund-ii-lp',
  'coatue-ct-90-llc', 'coatue-ct-115-llc', 'coatue-ct-116-llc',
  'coatue-ct-163-llc', 'coatue-ct-101-llc', 'coatue-ct-103-llc',
  'coatue-opportunity-fund-i-lp', 'coatue-opportunity-offshore-fund-i-ltd',
  'coatue-ct-139-llc', 'coatue-ct-137-llc',
  'coatue-tactical-solutions-ct-fund-b-lp',
  'coatue-opportunity-fund-ii-lp', 'coatue-growth-fund-v-b-lp',
  'coatue-qualified-partners-l-p',
  'coatue-ct-152-llc', 'coatue-ct-76-llc', 'coatue-ct-91-llc', 'coatue-ct-143-llc',
  'coatue-private-fund-ii-lp', 'coatue-ct-xxx-llc', 'coatue-ct-158-lp',
  'green-ox-holdings-ii-llc', 'coatue-ct-134-llc',
  'coatue-structured-fund-lp', 'coatue-growth-fund-iv-lp',
  'coatue-early-stage-fund-lp', 'coatue-ct-88-llc',
  'coatue-tactical-solutions-ct-fund-c-1-lp',
  'green-deer-holdings-llc', 'coatue-ct-xxi-llc',
  'coatue-ct-105-llc', 'coatue-ct-153-llc', 'coatue-ct-123-llc',
  'coatue-ct-111-llc', 'coatue-ct-110-llc',
  'coatue-quant-offshore-feeder-fund-ltd',
  'coatue-ct-96-llc', 'coatue-ct-92-llc', 'coatue-growth-fund-v-lp',
  'coatue-ct-56-llc', 'coatue-asia-fund-lp', 'coatue-ct-xxxvi-llc',
  'coatue-qualified-partners-ii-lp', 'coatue-us-44-llc',
  'coatue-ct-119-llc', 'coatue-ct-112-llc', 'coatue-ct-118-llc',
  'coatue-ct-67-llc', 'coatue-ct-100-llc',
  'coatue-ct-140-llc', 'coatue-ct-133-llc',
  -- Thrive Capital: Claremount fund family + North River angel vehicle
  'claremount-vi-associates-l-p', 'claremount-v-associates-l-p',
  'claremount-vii-associates-l-p', 'claremount-iv-associates-l-p',
  'north-river-angel-investments-ix-l-p', 'claremount-tw-l-p',
  -- Greenoaks
  'lindenwood-ltd'
);

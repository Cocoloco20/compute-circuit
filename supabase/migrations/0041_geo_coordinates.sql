-- Migration: 0041_geo_coordinates.sql
-- Add HQ geographic coordinates to companies (Phase 7C-lite — 2D world map view).
--
-- Coordinates are stored as plain numeric (lat in [-90,90], lng in [-180,180])
-- rather than PostGIS geography — the v0 world map is a flat equirectangular
-- projection with no spatial queries, so the simpler types are fine.
--
-- Backfill covers ~80 of the 104 companies — the rest are small private
-- startups whose exact HQ city isn't published (left null; world map skips them).

alter table companies add column if not exists hq_lat numeric;
alter table companies add column if not exists hq_lng numeric;
alter table companies add column if not exists hq_city text;

-- Range checks. Use DO blocks because pg < 16 has no IF NOT EXISTS form for
-- ADD CONSTRAINT, and re-running this migration must be a no-op.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'companies_hq_lat_check') then
    alter table companies add constraint companies_hq_lat_check
      check (hq_lat is null or (hq_lat between -90 and 90)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'companies_hq_lng_check') then
    alter table companies add constraint companies_hq_lng_check
      check (hq_lng is null or (hq_lng between -180 and 180)) not valid;
  end if;
end$$;

-- ----- Backfill -----
-- Each row: id, city label, lat, lng. Coordinates are city-center, accurate
-- enough for a 1200×600 world projection (1° ~= 3.3 SVG px horizontal).

-- ===== USA — Bay Area cluster =====
update companies set hq_city='Santa Clara, CA', hq_lat=37.354, hq_lng=-121.955 where id='nvda';
update companies set hq_city='Santa Clara, CA', hq_lat=37.354, hq_lng=-121.955 where id='amat';
update companies set hq_city='Santa Clara, CA', hq_lat=37.354, hq_lng=-121.955 where id='intc';
update companies set hq_city='Santa Clara, CA', hq_lat=37.354, hq_lng=-121.955 where id='amd';
update companies set hq_city='Mountain View, CA', hq_lat=37.42, hq_lng=-122.08 where id='googl';
update companies set hq_city='Mountain View, CA', hq_lat=37.42, hq_lng=-122.08 where id='deepmind';
update companies set hq_city='Menlo Park, CA', hq_lat=37.485, hq_lng=-122.148 where id='meta-ai';
update companies set hq_city='San Francisco, CA', hq_lat=37.776, hq_lng=-122.417 where id='openai';
update companies set hq_city='San Francisco, CA', hq_lat=37.776, hq_lng=-122.417 where id='anthropic';
update companies set hq_city='San Francisco, CA', hq_lat=37.776, hq_lng=-122.417 where id='xai';
update companies set hq_city='San Francisco, CA', hq_lat=37.776, hq_lng=-122.417 where id='databricks';
update companies set hq_city='San Francisco, CA', hq_lat=37.776, hq_lng=-122.417 where id='scale';
update companies set hq_city='San Francisco, CA', hq_lat=37.776, hq_lng=-122.417 where id='pplx';
update companies set hq_city='San Francisco, CA', hq_lat=37.776, hq_lng=-122.417 where id='groq';
update companies set hq_city='San Francisco, CA', hq_lat=37.776, hq_lng=-122.417 where id='together';
update companies set hq_city='San Francisco, CA', hq_lat=37.776, hq_lng=-122.417 where id='fireworks';
update companies set hq_city='San Francisco, CA', hq_lat=37.776, hq_lng=-122.417 where id='replicate';
update companies set hq_city='San Francisco, CA', hq_lat=37.776, hq_lng=-122.417 where id='modal';
update companies set hq_city='San Francisco, CA', hq_lat=37.776, hq_lng=-122.417 where id='anyscale';
update companies set hq_city='San Francisco, CA', hq_lat=37.776, hq_lng=-122.417 where id='runway';
update companies set hq_city='San Francisco, CA', hq_lat=37.776, hq_lng=-122.417 where id='luma';
update companies set hq_city='San Francisco, CA', hq_lat=37.776, hq_lng=-122.417 where id='pika';
update companies set hq_city='San Francisco, CA', hq_lat=37.776, hq_lng=-122.417 where id='suno';
update companies set hq_city='San Francisco, CA', hq_lat=37.776, hq_lng=-122.417 where id='lambda';
update companies set hq_city='San Francisco, CA', hq_lat=37.776, hq_lng=-122.417 where id='baseten';
update companies set hq_city='Sunnyvale, CA', hq_lat=37.369, hq_lng=-122.036 where id='cerebras';
update companies set hq_city='Palo Alto, CA', hq_lat=37.442, hq_lng=-122.143 where id='sambanova';
update companies set hq_city='Palo Alto, CA', hq_lat=37.442, hq_lng=-122.143 where id='figure';
update companies set hq_city='San Jose, CA', hq_lat=37.339, hq_lng=-121.895 where id='wolf';
update companies set hq_city='San Jose, CA', hq_lat=37.339, hq_lng=-121.895 where id='crdo';
update companies set hq_city='Santa Clara, CA', hq_lat=37.354, hq_lng=-121.955 where id='alab';
update companies set hq_city='Santa Clara, CA', hq_lat=37.354, hq_lng=-121.955 where id='anet';
update companies set hq_city='Milpitas, CA', hq_lat=37.428, hq_lng=-121.906 where id='klac';
update companies set hq_city='Fremont, CA', hq_lat=37.548, hq_lng=-121.989 where id='lrcx';
update companies set hq_city='San Jose, CA', hq_lat=37.339, hq_lng=-121.895 where id='lite';
update companies set hq_city='San Jose, CA', hq_lat=37.339, hq_lng=-121.895 where id='smci';
update companies set hq_city='Santa Clara, CA', hq_lat=37.354, hq_lng=-121.955 where id='mrvl';
update companies set hq_city='San Carlos, CA', hq_lat=37.507, hq_lng=-122.260 where id='vast-ai';

-- Defunct cos (kept in DB for historical portfolio context; small dots on map):
update companies set hq_city='Santa Clara, CA', hq_lat=37.354, hq_lng=-121.955 where id='easic-corp';
update companies set hq_city='Sunnyvale, CA', hq_lat=37.371, hq_lng=-122.038 where id='seamicro-inc';
update companies set hq_city='San Diego, CA', hq_lat=32.716, hq_lng=-117.161 where id='nirvanix-inc';

-- ===== USA — Seattle / WA =====
update companies set hq_city='Redmond, WA', hq_lat=47.642, hq_lng=-122.137 where id='msft';
update companies set hq_city='Seattle, WA', hq_lat=47.62, hq_lng=-122.34 where id='amzn';

-- ===== USA — Other =====
update companies set hq_city='Austin, TX', hq_lat=30.267, hq_lng=-97.743 where id='orcl';
update companies set hq_city='Austin, TX', hq_lat=30.267, hq_lng=-97.743 where id='tenstorrent';
update companies set hq_city='Austin, TX', hq_lat=30.267, hq_lng=-97.743 where id='apptronik';
update companies set hq_city='Round Rock, TX', hq_lat=30.508, hq_lng=-97.679 where id='dell';
update companies set hq_city='Armonk, NY', hq_lat=41.126, hq_lng=-73.714 where id='ibm';
update companies set hq_city='New York, NY', hq_lat=40.713, hq_lng=-74.006 where id='huggingface';
update companies set hq_city='Cambridge, MA', hq_lat=42.373, hq_lng=-71.110 where id='lightmatter';
update companies set hq_city='Santa Clara, CA', hq_lat=37.354, hq_lng=-121.955 where id='d-matrix';
update companies set hq_city='Cupertino, CA', hq_lat=37.323, hq_lng=-122.032 where id='etched';
update companies set hq_city='Mountain View, CA', hq_lat=37.42, hq_lng=-122.08 where id='matx';
update companies set hq_city='Redwood City, CA', hq_lat=37.485, hq_lng=-122.236 where id='mythic';
update companies set hq_city='Boise, ID', hq_lat=43.615, hq_lng=-116.202 where id='mu';
update companies set hq_city='San Diego, CA', hq_lat=32.715, hq_lng=-117.161 where id='qcom';
update companies set hq_city='Wilmington, MA', hq_lat=42.557, hq_lng=-71.174 where id='avgo';
update companies set hq_city='Tempe, AZ', hq_lat=33.428, hq_lng=-111.940 where id='amkr';
update companies set hq_city='Billerica, MA', hq_lat=42.558, hq_lng=-71.269 where id='entegris';
update companies set hq_city='Santa Clara, CA', hq_lat=37.354, hq_lng=-121.955 where id='gfs';
update companies set hq_city='Wilmington, DE', hq_lat=39.745, hq_lng=-75.546 where id='gev';
update companies set hq_city='Juno Beach, FL', hq_lat=26.881, hq_lng=-80.058 where id='nee';
update companies set hq_city='Baltimore, MD', hq_lat=39.290, hq_lng=-76.612 where id='ceg';
update companies set hq_city='Allentown, PA', hq_lat=40.609, hq_lng=-75.490 where id='talen';
update companies set hq_city='Irving, TX', hq_lat=32.815, hq_lng=-96.948 where id='vst';
update companies set hq_city='Santa Clara, CA', hq_lat=37.354, hq_lng=-121.955 where id='oklo';
update companies set hq_city='Westborough, MA', hq_lat=42.269, hq_lng=-71.616 where id='vrt';
update companies set hq_city='Waukesha, WI', hq_lat=43.011, hq_lng=-88.231 where id='gnrc';
update companies set hq_city='Beachwood, OH', hq_lat=41.464, hq_lng=-81.508 where id='etn';
update companies set hq_city='San Jose, CA', hq_lat=37.339, hq_lng=-121.895 where id='cohr';
update companies set hq_city='Westborough, MA', hq_lat=42.269, hq_lng=-71.616 where id='nvts';
update companies set hq_city='Livermore, CA', hq_lat=37.682, hq_lng=-121.768 where id='crusoe';
update companies set hq_city='College Park, MD', hq_lat=38.981, hq_lng=-76.937 where id='ionq';
update companies set hq_city='Burnaby, CA-BC', hq_lat=49.249, hq_lng=-122.980 where id='qbts';  -- D-Wave is Canadian
update companies set hq_city='Redwood City, CA', hq_lat=37.485, hq_lng=-122.236 where id='eqix';
update companies set hq_city='Austin, TX', hq_lat=30.267, hq_lng=-97.743 where id='dlr';
update companies set hq_city='Easton, PA', hq_lat=40.688, hq_lng=-75.221 where id='wulf';
update companies set hq_city='Sydney, AU', hq_lat=-33.868, hq_lng=151.209 where id='iren';

-- ===== Canada =====
update companies set hq_city='Toronto, CA-ON', hq_lat=43.65, hq_lng=-79.38 where id='cohere';
update companies set hq_city='Toronto, CA-ON', hq_lat=43.65, hq_lng=-79.38 where id='waabi';

-- ===== Europe =====
update companies set hq_city='Paris, FR', hq_lat=48.857, hq_lng=2.352 where id='mistral';
update companies set hq_city='Veldhoven, NL', hq_lat=51.41, hq_lng=5.46 where id='asml';
update companies set hq_city='Freiburg, DE', hq_lat=47.999, hq_lng=7.852 where id='bfl';
update companies set hq_city='London, GB', hq_lat=51.507, hq_lng=-0.128 where id='elevenlabs';
update companies set hq_city='London, GB', hq_lat=51.507, hq_lng=-0.128 where id='wayve';
update companies set hq_city='London, GB', hq_lat=51.507, hq_lng=-0.128 where id='arm';
update companies set hq_city='Aalborg, DK', hq_lat=57.046, hq_lng=9.935 where id='asetek';
update companies set hq_city='Oslo, NO', hq_lat=59.913, hq_lng=10.752 where id='1x';
update companies set hq_city='Barcelona, ES', hq_lat=41.385, hq_lng=2.173 where id='submer';
update companies set hq_city='Amsterdam, NL', hq_lat=52.370, hq_lng=4.895 where id='nbis';
update companies set hq_city='Rueil-Malmaison, FR', hq_lat=48.876, hq_lng=2.181 where id='se';

-- ===== East Asia =====
update companies set hq_city='Hsinchu, TW', hq_lat=24.81, hq_lng=120.97 where id='tsm';
update companies set hq_city='Kaohsiung, TW', hq_lat=22.626, hq_lng=120.301 where id='asx';
update companies set hq_city='Suwon, KR', hq_lat=37.27, hq_lng=127.00 where id='samsung-fdy';
update companies set hq_city='Suwon, KR', hq_lat=37.27, hq_lng=127.00 where id='samsung-mem';
update companies set hq_city='Icheon, KR', hq_lat=37.27, hq_lng=127.43 where id='hynix';
update companies set hq_city='Tokyo, JP', hq_lat=35.689, hq_lng=139.692 where id='tel';
update companies set hq_city='Tokyo, JP', hq_lat=35.689, hq_lng=139.692 where id='shin-etsu';
update companies set hq_city='Tokyo, JP', hq_lat=35.689, hq_lng=139.692 where id='sumco';
update companies set hq_city='Tokyo, JP', hq_lat=35.689, hq_lng=139.692 where id='jsr';

-- ===== Other =====
update companies set hq_city='Singapore, SG', hq_lat=1.352, hq_lng=103.820 where id='runpod';
update companies set hq_city='Seattle, WA', hq_lat=47.62, hq_lng=-122.34 where id='reka';
update companies set hq_city='Toronto, CA-ON', hq_lat=43.65, hq_lng=-79.38 where id='untether';
update companies set hq_city='Roseland, NJ', hq_lat=40.821, hq_lng=-74.293 where id='crwv';

-- Verify the check constraints now that data is loaded (will fail if anything is out of range).
alter table companies validate constraint companies_hq_lat_check;
alter table companies validate constraint companies_hq_lng_check;

-- Helpful index for the world map page (one full table scan otherwise; only ~100 rows
-- today but cheap to add and useful as we approach 1k cos).
create index if not exists companies_hq_coords_idx on companies(hq_lat, hq_lng)
  where hq_lat is not null and hq_lng is not null;

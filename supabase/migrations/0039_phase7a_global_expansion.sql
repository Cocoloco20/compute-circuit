-- Migration 0039 — Phase 7A: global energy + geopolitics + Asia compute supply chain.
--
-- Up to this point the dataset has been overwhelmingly US-public-equity-centric and
-- limited to the cleanest slice of the compute stack (chips / foundry / cloud / labs).
-- The Huawei reshuffle of China's AI chip stack, the EU AI Act enforcement timeline,
-- BIS / MOFCOM export-control tit-for-tat, and the lithium / copper / uranium spot
-- markets are all live drivers of compute supply — but none of them surfaced in the
-- graph. This migration plants the schema + seed corpus to track them.
--
-- Scope:
--   1. companies.country         (ISO 3166-1 alpha-2, populated for every existing co)
--   2. seven NEW layers          (oil-gas, metals-mining, nuclear-fuel, storage,
--                                 server-infra, telecom-cloud, government)
--   3. agencies                  (regulators / export-control bodies / standards orgs)
--   4. ~80 new companies         (energy supermajors, uranium, lithium/battery,
--                                 copper/rare earth, China / KR / JP / TW compute,
--                                 EU cloud, server-infra)
--   5. ~25 agencies              (US BIS / OFAC / SEC / DOE, EU AI Office / DG COMP,
--                                 China MIIT / CAC, JP METI, KR MSS, IN MeitY, ...)
--
-- All inserts use ON CONFLICT (id) DO NOTHING — re-runs are safe; we never clobber
-- a company that's already been enriched by the daily crons.
--
-- y_position layout (chose values that intercalate cleanly into the existing
-- bottom→top stack — see seed/data.ts layers[] for the original anchor values):
--
--   y=-12.0  oil-gas         (deepest — feedstock for everything above)
--   y=-11.0  metals-mining
--   y=-10.0  energy           (existing)
--   y= -8.75 nuclear-fuel    (between energy and equipment)
--   y= -7.5  equipment        (existing)
--   y= -5.0  materials        (existing)
--   y= -2.5  foundry          (existing)
--   y=  0.0  memory           (existing)
--   y=  2.5  chips            (existing)
--   y=  3.5  storage         (between chips and infrastructure)
--   y=  4.25 server-infra    (HPE / Dell / Lenovo — server OEMs sit right below DC)
--   y=  5.0  infrastructure   (existing)
--   y=  6.5  telecom-cloud   (between infra and hyperscaler-cloud)
--   y=  7.5  cloud            (existing)
--   y= 10.0  labs             (existing)
--   y= 12.5  government      (regulators float above the stack — they govern, not consume)

-- =====================================================================
-- 1. companies.country
-- =====================================================================

alter table companies
  add column if not exists country text;

create index if not exists idx_companies_country
  on companies(country) where country is not null;

comment on column companies.country is
  'ISO 3166-1 alpha-2 country of headquarters / primary listing. Used for flag rendering and country-based filters.';

-- =====================================================================
-- 2. New layers
-- =====================================================================
-- Existing order_index runs 0..8. We use fractional order_index values so the
-- new rows slot in without renumbering the existing nine. The 3D scene renders
-- by y_position; order_index only governs UI list ordering.

insert into layers (id, name, order_index, y_position) values
  ('oil-gas',       'Oil & Gas',         -2,  -12.0),
  ('metals-mining', 'Metals & Mining',   -1,  -11.0),
  ('nuclear-fuel',  'Nuclear Fuel',      1,   -8.75),
  ('storage',       'Storage',           55,  3.5),
  ('server-infra',  'Server / OEM',      57,  4.25),
  ('telecom-cloud', 'Telecom',           65,  6.5),
  ('government',    'Government / Regulators', 100, 12.5)
on conflict (id) do nothing;

-- =====================================================================
-- 3. agencies table
-- =====================================================================
-- Regulators, export-control bodies, antitrust offices, AI safety institutes.
-- One row per agency; identifiers are short slugs so they read naturally in
-- URLs (e.g. /agency/us_bis). RSS feed + Twitter handle let later phases hook
-- in a regulatory_events tracker similar to the news scraper.

create table if not exists agencies (
  id            text primary key,
  name          text not null,
  jurisdiction  text,                                       -- 'US' | 'EU' | 'CN' | 'JP' | 'KR' | ...
  agency_type   text,                                       -- 'export-control' | 'antitrust' | 'ai-safety' | 'securities' | 'energy' | 'telecom' | 'commerce' | 'standards'
  website       text,
  rss_feed_url  text,
  twitter_handle text,
  layer_id      text references layers(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists idx_agencies_jurisdiction on agencies(jurisdiction);
create index if not exists idx_agencies_layer        on agencies(layer_id);

alter table agencies enable row level security;
-- Idempotent policy creation — re-runs of 0039 won't crash on the prior
-- "policy already exists" error.
drop policy if exists "anon read agencies" on agencies;
create policy "anon read agencies" on agencies
  for select to anon, authenticated using (true);

-- =====================================================================
-- 4. Seed: ~80 new companies (energy, materials, Asia compute, EU, server-infra)
-- =====================================================================
-- IDs use the canonical ticker (lower-case for Latin alphabet, exchange-suffixed
-- for non-US listings like 0981.hk) so they're stable + readable in URLs. Where
-- a company isn't publicly listed, we use a slug (huawei).
--
-- weight=1 by default — these are reference rows; the existing weight scale
-- (1-10) reflects "importance to the AI compute thesis" which we'll tune
-- per-row in a later phase once the data accumulates.
--
-- private flag = true only for the genuinely private (Huawei). Public listings
-- with Chinese / Asian tickers are still private=false even though they may be
-- partially state-owned — that's a separate "state-affiliated" axis we don't
-- model yet.

insert into companies
  (id, name, ticker, domain, layer_id, country, weight, private, position_held, created_at, updated_at)
values
  -- ===== Energy supermajors (oil-gas) =====
  ('xom',        'ExxonMobil',                   'XOM',        'exxonmobil.com',     'oil-gas', 'US', 1, false, false, now(), now()),
  ('cvx',        'Chevron',                      'CVX',        'chevron.com',        'oil-gas', 'US', 1, false, false, now(), now()),
  ('shel',       'Shell plc',                    'SHEL',       'shell.com',          'oil-gas', 'GB', 1, false, false, now(), now()),
  ('bp',         'BP',                           'BP',         'bp.com',             'oil-gas', 'GB', 1, false, false, now(), now()),
  ('totaltl',    'TotalEnergies',                'TTE',        'totalenergies.com',  'oil-gas', 'FR', 1, false, false, now(), now()),
  ('cop',        'ConocoPhillips',               'COP',        'conocophillips.com', 'oil-gas', 'US', 1, false, false, now(), now()),
  ('eog',        'EOG Resources',                'EOG',        'eogresources.com',   'oil-gas', 'US', 1, false, false, now(), now()),
  ('pxd',        'Pioneer Natural Resources',    'PXD',        'pxd.com',            'oil-gas', 'US', 1, false, false, now(), now()),
  ('2222.sr',    'Saudi Aramco',                 '2222.SR',    'aramco.com',         'oil-gas', 'SA', 1, false, false, now(), now()),
  ('601857.ss',  'PetroChina',                   '601857.SS',  'petrochina.com.cn',  'oil-gas', 'CN', 1, false, false, now(), now()),

  -- ===== Uranium / Nuclear fuel =====
  ('ccj',        'Cameco',                       'CCJ',        'cameco.com',         'nuclear-fuel', 'CA', 1, false, false, now(), now()),
  ('kap.il',     'Kazatomprom',                  'KAP.IL',     'kazatomprom.kz',     'nuclear-fuel', 'KZ', 1, false, false, now(), now()),
  ('dnn',        'Denison Mines',                'DNN',        'denisonmines.com',   'nuclear-fuel', 'CA', 1, false, false, now(), now()),
  ('uec',        'Uranium Energy Corp',          'UEC',        'uraniumenergy.com',  'nuclear-fuel', 'US', 1, false, false, now(), now()),
  ('leu',        'Centrus Energy',               'LEU',        'centrusenergy.com',  'nuclear-fuel', 'US', 1, false, false, now(), now()),
  ('bwxt',       'BWX Technologies',             'BWXT',       'bwxt.com',           'nuclear-fuel', 'US', 1, false, false, now(), now()),

  -- ===== Lithium / Battery metals (metals-mining) =====
  ('alb',        'Albemarle',                    'ALB',        'albemarle.com',      'metals-mining', 'US', 1, false, false, now(), now()),
  ('sqm',        'SQM (Sociedad Química y Minera)','SQM',      'sqm.com',            'metals-mining', 'CL', 1, false, false, now(), now()),
  ('lac',        'Lithium Americas',             'LAC',        'lithiumamericas.com','metals-mining', 'CA', 1, false, false, now(), now()),
  ('pll',        'Piedmont Lithium',             'PLL',        'piedmontlithium.com','metals-mining', 'US', 1, false, false, now(), now()),
  ('002460.sz',  'Ganfeng Lithium',              '002460.SZ',  'ganfenglithium.com', 'metals-mining', 'CN', 1, false, false, now(), now()),
  ('0285.hk',    'BYD Electronic',               '0285.HK',    'byd.com',            'metals-mining', 'CN', 1, false, false, now(), now()),

  -- ===== Copper / Rare earths (metals-mining) =====
  ('fcx',        'Freeport-McMoRan',             'FCX',        'fcx.com',            'metals-mining', 'US', 1, false, false, now(), now()),
  ('scco',       'Southern Copper',              'SCCO',       'southernperu.com',   'metals-mining', 'US', 1, false, false, now(), now()),
  ('anto.l',     'Antofagasta',                  'ANTO.L',     'antofagasta.com',    'metals-mining', 'CL', 1, false, false, now(), now()),
  ('mp',         'MP Materials',                 'MP',         'mpmaterials.com',    'metals-mining', 'US', 1, false, false, now(), now()),
  ('lyc.ax',     'Lynas Rare Earths',            'LYC.AX',     'lynasrareearths.com','metals-mining', 'AU', 1, false, false, now(), now()),

  -- ===== Asia compute — China =====
  ('huawei',     'Huawei',                       null,         'huawei.com',         'chips',         'CN', 5, true,  false, now(), now()),
  ('0981.hk',    'SMIC',                         '0981.HK',    'smics.com',          'foundry',       'CN', 3, false, false, now(), now()),
  ('300782.sz',  'Fudan Microelectronics',       '300782.SZ',  'fmsh.com',           'chips',         'CN', 1, false, false, now(), now()),
  ('600460.ss',  'Silan Microelectronics',       '600460.SS',  'silan.com.cn',       'chips',         'CN', 1, false, false, now(), now()),
  ('002230.sz',  'iFLYTEK',                      '002230.SZ',  'iflytek.com',        'labs',          'CN', 1, false, false, now(), now()),
  ('bidu',       'Baidu',                        'BIDU',       'baidu.com',          'labs',          'CN', 1, false, false, now(), now()),
  ('jd',         'JD.com',                       'JD',         'jd.com',             'cloud',         'CN', 1, false, false, now(), now()),
  ('0700.hk',    'Tencent',                      '0700.HK',    'tencent.com',        'cloud',         'CN', 2, false, false, now(), now()),
  ('9988.hk',    'Alibaba',                      '9988.HK',    'alibaba.com',        'cloud',         'CN', 2, false, false, now(), now()),

  -- ===== Asia compute — Korea / Japan / Taiwan =====
  ('005930.ks',  'Samsung Electronics',          '005930.KS',  'samsung.com',        'memory',        'KR', 4, false, false, now(), now()),
  ('000660.ks',  'SK Hynix (KRX)',               '000660.KS',  'skhynix.com',        'memory',        'KR', 3, false, false, now(), now()),
  ('6701.t',     'NEC',                          '6701.T',     'nec.com',            'server-infra',  'JP', 1, false, false, now(), now()),
  ('7974.t',     'Nintendo',                     '7974.T',     'nintendo.com',       'chips',         'JP', 1, false, false, now(), now()),
  ('6857.t',     'Advantest',                    '6857.T',     'advantest.com',      'equipment',     'JP', 2, false, false, now(), now()),
  ('8035.t',     'Tokyo Electron (TYO)',         '8035.T',     'tel.com',            'equipment',     'JP', 3, false, false, now(), now()),
  ('4063.t',     'Shin-Etsu Chemical (TYO)',     '4063.T',     'shinetsu.co.jp',     'materials',     'JP', 2, false, false, now(), now()),
  ('6920.t',     'Lasertec',                     '6920.T',     'lasertec.co.jp',     'equipment',     'JP', 2, false, false, now(), now()),
  ('2412.tw',    'Chunghwa Telecom',             '2412.TW',    'cht.com.tw',         'telecom-cloud', 'TW', 1, false, false, now(), now()),

  -- ===== Server / Infrastructure (global) =====
  ('hpe',        'Hewlett Packard Enterprise',   'HPE',        'hpe.com',            'server-infra',  'US', 2, false, false, now(), now()),
  ('lnvgy',      'Lenovo Group',                 'LNVGY',      'lenovo.com',         'server-infra',  'CN', 2, false, false, now(), now()),
  ('wdc',        'Western Digital',              'WDC',        'westerndigital.com', 'storage',       'US', 2, false, false, now(), now()),
  ('stx',        'Seagate Technology',           'STX',        'seagate.com',        'storage',       'US', 2, false, false, now(), now()),
  ('600487.ss',  'Hengtong Optic-Electric',      '600487.SS',  'hengtonggroup.com',  'server-infra',  'CN', 1, false, false, now(), now()),
  ('002241.sz',  'GoerTek',                      '002241.SZ',  'goertek.com',        'server-infra',  'CN', 1, false, false, now(), now()),

  -- ===== EU / Cloud =====
  ('ovh.pa',     'OVHcloud',                     'OVH.PA',     'ovhcloud.com',       'cloud',         'FR', 1, false, false, now(), now()),
  ('sap',        'SAP',                          'SAP',        'sap.com',            'cloud',         'DE', 1, false, false, now(), now()),
  ('9433.t',     'KDDI',                         '9433.T',     'kddi.com',           'telecom-cloud', 'JP', 1, false, false, now(), now()),
  ('9432.t',     'NTT',                          '9432.T',     'global.ntt',         'telecom-cloud', 'JP', 1, false, false, now(), now()),

  -- ===== Additional Asia / EU coverage to hit ~80 total =====
  -- Telco / connectivity (China) — 5G and edge compute exposure
  ('0941.hk',    'China Mobile',                 '0941.HK',    'chinamobileltd.com', 'telecom-cloud', 'CN', 1, false, false, now(), now()),
  ('0728.hk',    'China Telecom',                '0728.HK',    'chinatelecom-h.com', 'telecom-cloud', 'CN', 1, false, false, now(), now()),
  -- Telco (Korea) — SK Telecom's AI cloud push
  ('017670.ks',  'SK Telecom',                   '017670.KS',  'sktelecom.com',      'telecom-cloud', 'KR', 1, false, false, now(), now()),
  -- China semis / equipment supply chain
  ('688981.ss',  'SMIC (A-share)',               '688981.SS',  'smics.com',          'foundry',       'CN', 2, false, false, now(), now()),
  ('688012.ss',  'AMEC (Advanced Micro-Fabrication Equip)','688012.SS','amec-inc.com','equipment',    'CN', 1, false, false, now(), now()),
  ('002371.sz',  'Naura Technology',             '002371.SZ',  'naura.com',          'equipment',     'CN', 1, false, false, now(), now()),
  -- China cloud / AI lab segments — Baidu/Alibaba/Tencent already covered, add Inspur for servers
  ('000977.sz',  'Inspur Information',           '000977.SZ',  'inspur.com',         'server-infra',  'CN', 1, false, false, now(), now()),
  -- Japan industrials with AI exposure
  ('6594.t',     'Nidec',                        '6594.T',     'nidec.com',          'infrastructure','JP', 1, false, false, now(), now()),
  ('6273.t',     'SMC Corporation',              '6273.T',     'smcworld.com',       'equipment',     'JP', 1, false, false, now(), now()),
  ('6758.t',     'Sony Group',                   '6758.T',     'sony.com',           'chips',         'JP', 1, false, false, now(), now()),
  -- Korean memory / equipment ecosystem
  ('357780.ks',  'Solbrain',                     '357780.KS',  'solbrain.co.kr',     'materials',     'KR', 1, false, false, now(), now()),
  -- Taiwan packaging / equipment
  ('3711.tw',    'ASE Industrial Holding',       '3711.TW',    'aseglobal.com',      'foundry',       'TW', 1, false, false, now(), now()),
  ('6271.tw',    'Powertech Technology',         '6271.TW',    'pti.com.tw',         'foundry',       'TW', 1, false, false, now(), now()),
  -- EU semis + AI sovereign
  ('stmpa',      'STMicroelectronics',           'STM',        'st.com',             'chips',         'FR', 1, false, false, now(), now()),
  ('ifx.de',     'Infineon Technologies',        'IFX.DE',     'infineon.com',       'chips',         'DE', 1, false, false, now(), now()),
  ('nxpi',       'NXP Semiconductors',           'NXPI',       'nxp.com',            'chips',         'NL', 1, false, false, now(), now()),
  -- EU / UK AI / data
  ('aleph-alpha','Aleph Alpha',                  null,         'aleph-alpha.com',    'labs',          'DE', 1, true,  false, now(), now()),
  ('sap-aleph',  'DeepL',                        null,         'deepl.com',          'labs',          'DE', 1, true,  false, now(), now()),
  -- India / Middle East compute
  ('infy',       'Infosys',                      'INFY',       'infosys.com',        'cloud',         'IN', 1, false, false, now(), now()),
  ('tcs.ns',     'Tata Consultancy Services',    'TCS.NS',     'tcs.com',            'cloud',         'IN', 1, false, false, now(), now()),
  ('g42',        'G42',                          null,         'g42.ai',             'labs',          'AE', 1, true,  false, now(), now()),
  -- Energy / utilities (Asia) — DC power dependents
  ('9501.t',     'TEPCO',                        '9501.T',     'tepco.co.jp',        'energy',        'JP', 1, false, false, now(), now()),
  ('9503.t',     'Kansai Electric Power',        '9503.T',     'kepco.co.jp',        'energy',        'JP', 1, false, false, now(), now()),
  -- Rare-earth processing (China dominant)
  ('600111.ss',  'China Northern Rare Earth',    '600111.SS',  'cnrec.com.cn',       'metals-mining', 'CN', 1, false, false, now(), now()),
  -- Pipeline / oilfield services (DC fuel logistics)
  ('slb',        'SLB (Schlumberger)',           'SLB',        'slb.com',            'oil-gas',       'US', 1, false, false, now(), now()),
  ('hal',        'Halliburton',                  'HAL',        'halliburton.com',    'oil-gas',       'US', 1, false, false, now(), now())
on conflict (id) do nothing;

-- =====================================================================
-- 5. Backfill country for the existing 104 companies
-- =====================================================================
-- Derived from headquarters / primary listing. NULL countries shouldn't exist
-- after this — but the upstream Form-D scrapers can keep adding new rows with
-- country=null, and the next country-backfill cron will sweep them.
--
-- The blanket US default is intentional: of the 104 existing rows, ~90 are
-- US-domiciled (NYSE / Nasdaq) so US is the right zero. We explicit-list
-- every non-US co below so the default never silently mis-categorizes.

update companies set country = 'US' where country is null;

-- Non-US overrides — derived from ticker suffix + primary HQ:
update companies set country = 'NL' where id in ('asml', 'nbis');                       -- Netherlands  (Nebius Group post-restructure)
update companies set country = 'TW' where id in ('tsm', 'asx');                         -- Taiwan        (ASE Technology)
update companies set country = 'KR' where id in ('hynix', 'samsung-fdy', 'samsung-mem');-- Korea
update companies set country = 'JP' where id in ('tel', 'sumco', 'shin-etsu', 'jsr');   -- Japan
update companies set country = 'GB' where id in ('arm');                                -- UK
update companies set country = 'AU' where id in ('iren');                               -- Iris Energy (ASX-primary listing, AU domicile)
update companies set country = 'NO' where id in ('asetek', '1x');                       -- Norway (Asetek.OL, 1X Technologies)
update companies set country = 'FR' where id in ('se');                                 -- Schneider Electric (SU.PA)
update companies set country = 'ES' where id in ('submer');                             -- Submer (Barcelona)
update companies set country = 'IE' where id in ('etn');                                -- Eaton Corporation plc (Ireland-domiciled, NYSE-listed)
-- TeraWulf (wulf) is Delaware-incorporated, ops in NY/Maryland — stays US default.
-- Wolfspeed (wolf) is Durham NC — stays US default.

-- =====================================================================
-- 6. Seed: ~25 agencies
-- =====================================================================

insert into agencies
  (id, name, jurisdiction, agency_type, website, layer_id, created_at)
values
  -- ----- United States -----
  ('us_bis',           'Bureau of Industry and Security',          'US', 'export-control', 'https://www.bis.doc.gov',                'government', now()),
  ('us_doc',           'Department of Commerce',                   'US', 'commerce',       'https://www.commerce.gov',              'government', now()),
  ('us_treasury_ofac', 'OFAC (Treasury)',                          'US', 'export-control', 'https://ofac.treasury.gov',             'government', now()),
  ('us_ftc',           'Federal Trade Commission',                 'US', 'antitrust',      'https://www.ftc.gov',                   'government', now()),
  ('us_doj_antitrust', 'DOJ Antitrust Division',                   'US', 'antitrust',      'https://www.justice.gov/atr',           'government', now()),
  ('us_sec',           'Securities and Exchange Commission',       'US', 'securities',     'https://www.sec.gov',                   'government', now()),
  ('us_doe',           'Department of Energy',                     'US', 'energy',         'https://www.energy.gov',                'government', now()),
  ('us_nrc',           'Nuclear Regulatory Commission',            'US', 'energy',         'https://www.nrc.gov',                   'government', now()),

  -- ----- European Union -----
  ('eu_commission_dgcomp', 'European Commission DG COMP',          'EU', 'antitrust',      'https://competition-policy.ec.europa.eu','government', now()),
  ('eu_ai_office',         'European AI Office',                   'EU', 'ai-safety',      'https://digital-strategy.ec.europa.eu/en/policies/ai-office', 'government', now()),
  ('eu_dg_connect',        'DG CONNECT',                           'EU', 'commerce',       'https://digital-strategy.ec.europa.eu', 'government', now()),
  ('eu_enisa',             'ENISA (EU Cybersecurity)',             'EU', 'standards',      'https://www.enisa.europa.eu',           'government', now()),

  -- ----- China -----
  ('cn_miit',          'Ministry of Industry & Information Tech',  'CN', 'commerce',       'https://www.miit.gov.cn',               'government', now()),
  ('cn_ndrc',          'National Development & Reform Commission', 'CN', 'commerce',       'https://en.ndrc.gov.cn',                'government', now()),
  ('cn_cac',           'Cyberspace Administration of China',       'CN', 'ai-safety',      'http://www.cac.gov.cn',                 'government', now()),
  ('cn_mofcom',        'Ministry of Commerce',                     'CN', 'export-control', 'http://english.mofcom.gov.cn',          'government', now()),

  -- ----- Other -----
  ('uk_ofcom',                  'Ofcom',                           'GB', 'telecom',        'https://www.ofcom.org.uk',              'government', now()),
  ('uk_ai_safety_institute',    'UK AI Safety Institute',          'GB', 'ai-safety',      'https://www.aisi.gov.uk',               'government', now()),
  ('jp_meti',                   'METI (Japan)',                    'JP', 'commerce',       'https://www.meti.go.jp/english',        'government', now()),
  ('kr_mss',                    'Ministry of SMEs and Startups',   'KR', 'commerce',       'https://www.mss.go.kr',                 'government', now()),
  ('tw_moea',                   'Ministry of Economic Affairs',    'TW', 'commerce',       'https://www.moea.gov.tw',               'government', now()),
  ('in_meity',                  'MeitY (India)',                   'IN', 'commerce',       'https://www.meity.gov.in',              'government', now())
on conflict (id) do nothing;

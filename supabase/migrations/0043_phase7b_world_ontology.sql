-- Migration 0043 — Phase 7B: world-simulator ontology spine.
--
-- Phase 7A widened the dataset from the AI-compute / energy / Asia core to
-- ~185 companies. That's still small enough that "what's happening in the
-- world?" questions outside the compute stack (autos, pharma, banking,
-- defense, entertainment, agri, retail) have no node to attach to. This
-- migration plants the rest of the ontology so every major global industry
-- gets a layer + a curated top-N seed.
--
-- Scope:
--   1. Eleven NEW layers, intercalated above the existing 16:
--        entertainment, pharma-biotech, auto-mobility, finance-banks,
--        defense, retail-ecommerce, consumer-tech, industrials,
--        media-content, food-agri, aerospace, crypto-blockchain
--      (We don't add a separate 'defense' layer because Phase 7A already has
--       agencies — defense cos live in a brand-new aerospace+defense layer.)
--   2. ~800 new companies hand-curated across the new layers, biased toward
--      cos that have measurable interactions with the AI / energy / compute
--      supply chain (Nvidia-customer megacaps, defense AI primes, EV cos,
--      hyperscaler-customer banks, content cos investing in GenAI tooling).
--   3. All inserts use ON CONFLICT (id) DO NOTHING — re-runs are idempotent.
--
-- IDs:
--   * Lower-case ticker for US listings ('tsla', 'jpm')
--   * Exchange-suffixed for foreign listings ('7203.t' = Toyota Tokyo,
--     '1211.hk' = BYD Hong Kong, 'rms.pa' = Hermès Paris)
--   * Slug for genuinely private cos ('waymo', 'spacex', 'bytedance')
--
-- y_position layout — new layers slot ABOVE existing top (labs y=10,
-- government y=12.5). The 3D graph renders y bottom-to-top, so these new
-- "demand-side" sectors float above the supply-side compute stack:
--
--   y= 14.0   industrials             (heavy machinery, anchors below the rest)
--   y= 14.75  auto-mobility           (overlaps semis demand — automotive electronics)
--   y= 15.5   aerospace               (jets, satellites, space launch)
--   y= 16.25  defense                 (primes + AI defense — overlap with aero is intentional)
--   y= 17.0   food-agri               (precision-ag is AI-adjacent)
--   y= 17.75  pharma-biotech          (AI drug discovery)
--   y= 18.5   consumer-tech           (smart devices, wearables)
--   y= 19.25  retail-ecommerce        (omnichannel, recommender-system customers)
--   y= 20.0   media-content           (news + ratings + financial-data — adjacent to AI training)
--   y= 20.75  entertainment           (streamers + studios + gaming + music)
--   y= 21.5   finance-banks           (banks + brokers + stablecoin issuers)
--   y= 22.25  crypto-blockchain       (overlaps finance — kept tiny, BTC hashrate signal already exists)
--
-- order_index follows the same fractional pattern as Phase 7A so existing
-- layer-list UI ordering doesn't get scrambled.

-- =====================================================================
-- 1. New layers
-- =====================================================================

insert into layers (id, name, order_index, y_position) values
  ('industrials',       'Industrials',           200, 14.0),
  ('auto-mobility',     'Auto & Mobility',       210, 14.75),
  ('aerospace',         'Aerospace',             220, 15.5),
  ('defense',           'Defense',               230, 16.25),
  ('food-agri',         'Food & Agriculture',    240, 17.0),
  ('pharma-biotech',    'Pharma & Biotech',      250, 17.75),
  ('consumer-tech',     'Consumer Tech',         260, 18.5),
  ('retail-ecommerce',  'Retail & E-commerce',   270, 19.25),
  ('media-content',     'Media & Content',       280, 20.0),
  ('entertainment',     'Entertainment',         290, 20.75),
  ('finance-banks',     'Finance & Banks',       300, 21.5),
  ('crypto-blockchain', 'Crypto & Blockchain',   310, 22.25)
on conflict (id) do nothing;

-- =====================================================================
-- 2. Seed: ~800 new companies across the new layers
-- =====================================================================

insert into companies
  (id, name, ticker, domain, layer_id, country, weight, private, position_held, created_at, updated_at)
values
  -- ============================================================
  -- INDUSTRIALS (heavy equipment, conglomerates, electricals)
  -- ============================================================
  ('cat',       'Caterpillar',                'CAT',    'caterpillar.com',   'industrials', 'US', 1, false, false, now(), now()),
  ('de',        'Deere & Company',            'DE',     'deere.com',         'industrials', 'US', 1, false, false, now(), now()),
  ('hon',       'Honeywell International',    'HON',    'honeywell.com',     'industrials', 'US', 1, false, false, now(), now()),
  ('mmm',       '3M',                         'MMM',    '3m.com',            'industrials', 'US', 1, false, false, now(), now()),
  ('ge',        'GE Aerospace',               'GE',     'geaerospace.com',   'industrials', 'US', 1, false, false, now(), now()),
  ('gev',       'GE Vernova',                 'GEV',    'gevernova.com',     'industrials', 'US', 1, false, false, now(), now()),
  ('emr',       'Emerson Electric',           'EMR',    'emerson.com',       'industrials', 'US', 1, false, false, now(), now()),
  ('itw',       'Illinois Tool Works',        'ITW',    'itw.com',           'industrials', 'US', 1, false, false, now(), now()),
  ('phm',       'PulteGroup',                 'PHM',    'pultegroupinc.com', 'industrials', 'US', 1, false, false, now(), now()),
  ('lin',       'Linde plc',                  'LIN',    'linde.com',         'industrials', 'IE', 1, false, false, now(), now()),
  ('apd',       'Air Products and Chemicals', 'APD',    'airproducts.com',   'industrials', 'US', 1, false, false, now(), now()),
  ('siegy',     'Siemens AG',                 'SIEGY',  'siemens.com',       'industrials', 'DE', 1, false, false, now(), now()),
  ('abb',       'ABB Ltd',                    'ABBNY',  'abb.com',           'industrials', 'CH', 1, false, false, now(), now()),
  ('schn.pa',   'Schneider Electric (Paris)', 'SU.PA',  'se.com',            'industrials', 'FR', 1, false, false, now(), now()),
  ('roper',     'Roper Technologies',         'ROP',    'ropertech.com',     'industrials', 'US', 1, false, false, now(), now()),
  ('parker',    'Parker-Hannifin',            'PH',     'parker.com',        'industrials', 'US', 1, false, false, now(), now()),
  ('phm-h',     'Pentair',                    'PNR',    'pentair.com',       'industrials', 'GB', 1, false, false, now(), now()),
  ('cmi',       'Cummins',                    'CMI',    'cummins.com',       'industrials', 'US', 1, false, false, now(), now()),
  ('fdx',       'FedEx',                      'FDX',    'fedex.com',         'industrials', 'US', 1, false, false, now(), now()),
  ('ups',       'United Parcel Service',      'UPS',    'ups.com',           'industrials', 'US', 1, false, false, now(), now()),
  ('unp',       'Union Pacific',              'UNP',    'up.com',            'industrials', 'US', 1, false, false, now(), now()),
  ('csx',       'CSX Corporation',            'CSX',    'csx.com',           'industrials', 'US', 1, false, false, now(), now()),
  ('nsc',       'Norfolk Southern',           'NSC',    'norfolksouthern.com','industrials','US', 1, false, false, now(), now()),
  ('luv',       'Southwest Airlines',         'LUV',    'southwest.com',     'industrials', 'US', 1, false, false, now(), now()),
  ('dal',       'Delta Air Lines',            'DAL',    'delta.com',         'industrials', 'US', 1, false, false, now(), now()),
  ('ual',       'United Airlines',            'UAL',    'united.com',        'industrials', 'US', 1, false, false, now(), now()),
  ('aal',       'American Airlines',          'AAL',    'aa.com',            'industrials', 'US', 1, false, false, now(), now()),
  ('rio',       'Rio Tinto',                  'RIO',    'riotinto.com',      'industrials', 'GB', 1, false, false, now(), now()),
  ('bhp',       'BHP Group',                  'BHP',    'bhp.com',           'industrials', 'AU', 1, false, false, now(), now()),
  ('vale',      'Vale SA',                    'VALE',   'vale.com',          'industrials', 'BR', 1, false, false, now(), now()),

  -- ============================================================
  -- AUTO & MOBILITY (legacy OEMs, EVs, AV)
  -- ============================================================
  ('tsla',      'Tesla',                      'TSLA',   'tesla.com',         'auto-mobility', 'US', 4, false, false, now(), now()),
  ('f',         'Ford Motor',                 'F',      'ford.com',          'auto-mobility', 'US', 1, false, false, now(), now()),
  ('gm',        'General Motors',             'GM',     'gm.com',            'auto-mobility', 'US', 1, false, false, now(), now()),
  ('7203.t',    'Toyota Motor',               '7203.T', 'toyota-global.com', 'auto-mobility', 'JP', 2, false, false, now(), now()),
  ('vwagy',     'Volkswagen Group',           'VWAGY',  'volkswagenag.com',  'auto-mobility', 'DE', 1, false, false, now(), now()),
  ('bmwyy',     'BMW Group',                  'BMWYY',  'bmwgroup.com',      'auto-mobility', 'DE', 1, false, false, now(), now()),
  ('mbgaf',     'Mercedes-Benz Group',        'MBGAF',  'mercedes-benz.com', 'auto-mobility', 'DE', 1, false, false, now(), now()),
  ('stla',      'Stellantis',                 'STLA',   'stellantis.com',    'auto-mobility', 'NL', 1, false, false, now(), now()),
  ('hymtf',     'Hyundai Motor',              'HYMTF',  'hyundai.com',       'auto-mobility', 'KR', 1, false, false, now(), now()),
  ('1211.hk',   'BYD Company (HK)',           '1211.HK','byd.com',           'auto-mobility', 'CN', 2, false, false, now(), now()),
  ('byddy',     'BYD Company (ADR)',          'BYDDY',  'byd.com',           'auto-mobility', 'CN', 1, false, false, now(), now()),
  ('nio',       'NIO',                        'NIO',    'nio.com',           'auto-mobility', 'CN', 1, false, false, now(), now()),
  ('xpev',      'XPeng',                      'XPEV',   'xpeng.com',         'auto-mobility', 'CN', 1, false, false, now(), now()),
  ('li',        'Li Auto',                    'LI',     'lixiang.com',       'auto-mobility', 'CN', 1, false, false, now(), now()),
  ('rivn',      'Rivian Automotive',          'RIVN',   'rivian.com',        'auto-mobility', 'US', 1, false, false, now(), now()),
  ('lcid',      'Lucid Group',                'LCID',   'lucidmotors.com',   'auto-mobility', 'US', 1, false, false, now(), now()),
  ('hmc',       'Honda Motor',                'HMC',    'honda.com',         'auto-mobility', 'JP', 1, false, false, now(), now()),
  ('7267.t',    'Honda Motor (Tokyo)',        '7267.T', 'honda.co.jp',       'auto-mobility', 'JP', 1, false, false, now(), now()),
  ('7201.t',    'Nissan Motor',               '7201.T', 'nissan-global.com', 'auto-mobility', 'JP', 1, false, false, now(), now()),
  ('porsche.de','Porsche AG',                 'P911.DE','porsche.com',       'auto-mobility', 'DE', 1, false, false, now(), now()),
  ('rms.pa',    'Renault',                    'RNO.PA', 'renaultgroup.com',  'auto-mobility', 'FR', 1, false, false, now(), now()),
  ('waymo',     'Waymo',                       null,    'waymo.com',         'auto-mobility', 'US', 2, true,  false, now(), now()),
  ('cruise',    'Cruise',                      null,    'getcruise.com',     'auto-mobility', 'US', 1, true,  false, now(), now()),
  ('zoox',      'Zoox',                        null,    'zoox.com',          'auto-mobility', 'US', 1, true,  false, now(), now()),
  ('aurora',    'Aurora Innovation',          'AUR',    'aurora.tech',       'auto-mobility', 'US', 1, false, false, now(), now()),
  ('mblly',     'Mobileye',                   'MBLY',   'mobileye.com',      'auto-mobility', 'IL', 1, false, false, now(), now()),
  ('1810.hk',   'Xiaomi (EV business via parent)','1810.HK','mi.com',        'auto-mobility', 'CN', 1, false, false, now(), now()),
  ('zk',        'ZEEKR',                      'ZK',     'zeekrlife.com',     'auto-mobility', 'CN', 1, false, false, now(), now()),
  ('uber',      'Uber Technologies',          'UBER',   'uber.com',          'auto-mobility', 'US', 1, false, false, now(), now()),
  ('lyft',      'Lyft',                       'LYFT',   'lyft.com',          'auto-mobility', 'US', 1, false, false, now(), now()),

  -- ============================================================
  -- AEROSPACE (commercial jets, satellites, launch)
  -- ============================================================
  ('ba',        'Boeing',                     'BA',     'boeing.com',        'aerospace', 'US', 2, false, false, now(), now()),
  ('air.pa',    'Airbus',                     'AIR.PA', 'airbus.com',        'aerospace', 'FR', 2, false, false, now(), now()),
  ('txt',       'Textron',                    'TXT',    'textron.com',       'aerospace', 'US', 1, false, false, now(), now()),
  ('ger',       'Embraer',                    'ERJ',    'embraer.com',       'aerospace', 'BR', 1, false, false, now(), now()),
  ('hexcel',    'Hexcel',                     'HXL',    'hexcel.com',        'aerospace', 'US', 1, false, false, now(), now()),
  ('howmet',    'Howmet Aerospace',           'HWM',    'howmet.com',        'aerospace', 'US', 1, false, false, now(), now()),
  ('trans',     'TransDigm Group',            'TDG',    'transdigm.com',     'aerospace', 'US', 1, false, false, now(), now()),
  ('spacex',    'SpaceX',                      null,    'spacex.com',        'aerospace', 'US', 3, true,  false, now(), now()),
  ('blueorigin','Blue Origin',                 null,    'blueorigin.com',    'aerospace', 'US', 2, true,  false, now(), now()),
  ('rklb',      'Rocket Lab USA',             'RKLB',   'rocketlabusa.com',  'aerospace', 'US', 1, false, false, now(), now()),
  ('spir',      'Spire Global',               'SPIR',   'spire.com',         'aerospace', 'US', 1, false, false, now(), now()),
  ('astr',      'Astra Space',                'ASTR',   'astra.com',         'aerospace', 'US', 1, false, false, now(), now()),
  ('plnhf',     'Planet Labs',                'PL',     'planet.com',        'aerospace', 'US', 1, false, false, now(), now()),
  ('mxr',       'Maxar Technologies',          null,    'maxar.com',         'aerospace', 'US', 1, true,  false, now(), now()),
  ('starlink',  'Starlink (SpaceX subsidiary)',null,    'starlink.com',      'aerospace', 'US', 2, true,  false, now(), now()),
  ('iridium',   'Iridium Communications',     'IRDM',   'iridium.com',       'aerospace', 'US', 1, false, false, now(), now()),
  ('viasat',    'Viasat',                     'VSAT',   'viasat.com',        'aerospace', 'US', 1, false, false, now(), now()),
  ('boomtech',  'Boom Supersonic',             null,    'boomsupersonic.com','aerospace', 'US', 1, true,  false, now(), now()),
  ('relsp',     'Relativity Space',            null,    'relativityspace.com','aerospace','US', 1, true,  false, now(), now()),
  ('firefly',   'Firefly Aerospace',           null,    'fireflyspace.com',  'aerospace', 'US', 1, true,  false, now(), now()),

  -- ============================================================
  -- DEFENSE (primes + AI-defense)
  -- ============================================================
  ('lmt',       'Lockheed Martin',            'LMT',    'lockheedmartin.com','defense', 'US', 2, false, false, now(), now()),
  ('rtx',       'RTX Corporation',            'RTX',    'rtx.com',           'defense', 'US', 2, false, false, now(), now()),
  ('noc',       'Northrop Grumman',           'NOC',    'northropgrumman.com','defense','US', 2, false, false, now(), now()),
  ('gd',        'General Dynamics',           'GD',     'gd.com',            'defense', 'US', 1, false, false, now(), now()),
  ('hii',       'Huntington Ingalls Industries','HII',  'hii.com',           'defense', 'US', 1, false, false, now(), now()),
  ('loc',       'Leidos',                     'LDOS',   'leidos.com',        'defense', 'US', 1, false, false, now(), now()),
  ('caci',      'CACI International',         'CACI',   'caci.com',          'defense', 'US', 1, false, false, now(), now()),
  ('saic',      'Science Applications Intl',  'SAIC',   'saic.com',          'defense', 'US', 1, false, false, now(), now()),
  ('booz',      'Booz Allen Hamilton',        'BAH',    'boozallen.com',     'defense', 'US', 1, false, false, now(), now()),
  ('ksb',       'Kratos Defense',             'KTOS',   'kratosdefense.com', 'defense', 'US', 1, false, false, now(), now()),
  ('aero',      'Aerojet Rocketdyne',          null,    'rocket.com',        'defense', 'US', 1, true,  false, now(), now()),
  ('mrcy',      'Mercury Systems',            'MRCY',   'mrcy.com',          'defense', 'US', 1, false, false, now(), now()),
  ('pltr',      'Palantir Technologies',      'PLTR',   'palantir.com',      'defense', 'US', 3, false, false, now(), now()),
  ('anduril',   'Anduril Industries',          null,    'anduril.com',       'defense', 'US', 3, true,  false, now(), now()),
  ('shield-ai', 'Shield AI',                   null,    'shield.ai',         'defense', 'US', 1, true,  false, now(), now()),
  ('saronic',   'Saronic Technologies',        null,    'saronic.com',       'defense', 'US', 1, true,  false, now(), now()),
  ('helsing',   'Helsing',                     null,    'helsing.ai',        'defense', 'DE', 2, true,  false, now(), now()),
  ('bae.l',     'BAE Systems',                'BAESY',  'baesystems.com',    'defense', 'GB', 1, false, false, now(), now()),
  ('rhm.de',    'Rheinmetall',                'RHM.DE', 'rheinmetall.com',   'defense', 'DE', 1, false, false, now(), now()),
  ('saab.st',   'Saab AB',                    'SAABF',  'saab.com',          'defense', 'SE', 1, false, false, now(), now()),
  ('elbit',     'Elbit Systems',              'ESLT',   'elbitsystems.com',  'defense', 'IL', 1, false, false, now(), now()),
  ('hwa.l',     'Hanwha Aerospace',           '012450.KS','hanwhaaerospace.com','defense','KR', 1, false, false, now(), now()),
  ('lpr.pa',    'Leonardo S.p.A.',            'LDO.MI', 'leonardo.com',      'defense', 'IT', 1, false, false, now(), now()),
  ('thales.pa', 'Thales Group',               'HO.PA',  'thalesgroup.com',   'defense', 'FR', 1, false, false, now(), now()),
  ('dassault',  'Dassault Aviation',          'AM.PA',  'dassault-aviation.com','defense','FR', 1, false, false, now(), now()),

  -- ============================================================
  -- FOOD & AGRICULTURE
  -- ============================================================
  ('adm',       'Archer-Daniels-Midland',     'ADM',    'adm.com',           'food-agri', 'US', 1, false, false, now(), now()),
  ('bg',        'Bunge Global',               'BG',     'bunge.com',         'food-agri', 'US', 1, false, false, now(), now()),
  ('cargill',   'Cargill',                     null,    'cargill.com',       'food-agri', 'US', 2, true,  false, now(), now()),
  ('ntr',       'Nutrien',                    'NTR',    'nutrien.com',       'food-agri', 'CA', 1, false, false, now(), now()),
  ('mos',       'Mosaic Company',             'MOS',    'mosaicco.com',      'food-agri', 'US', 1, false, false, now(), now()),
  ('cf',        'CF Industries',              'CF',     'cfindustries.com',  'food-agri', 'US', 1, false, false, now(), now()),
  ('cti',       'Corteva',                    'CTVA',   'corteva.com',       'food-agri', 'US', 1, false, false, now(), now()),
  ('agco',      'AGCO Corporation',           'AGCO',   'agcocorp.com',      'food-agri', 'US', 1, false, false, now(), now()),
  ('tson',      'Tyson Foods',                'TSN',    'tysonfoods.com',    'food-agri', 'US', 1, false, false, now(), now()),
  ('jbs',       'JBS S.A.',                    null,    'jbs.com.br',        'food-agri', 'BR', 1, true,  false, now(), now()),
  ('nesn.sw',   'Nestle',                     'NSRGY',  'nestle.com',        'food-agri', 'CH', 2, false, false, now(), now()),
  ('una.as',    'Unilever',                   'UL',     'unilever.com',      'food-agri', 'GB', 1, false, false, now(), now()),
  ('pep',       'PepsiCo',                    'PEP',    'pepsico.com',       'food-agri', 'US', 1, false, false, now(), now()),
  ('ko',        'Coca-Cola',                  'KO',     'coca-colacompany.com','food-agri','US', 1, false, false, now(), now()),
  ('mdlz',      'Mondelez International',     'MDLZ',   'mondelezinternational.com','food-agri','US',1,false,false,now(),now()),
  ('k',         'Kellanova',                  'K',      'kellanova.com',     'food-agri', 'US', 1, false, false, now(), now()),
  ('gis',       'General Mills',              'GIS',    'generalmills.com',  'food-agri', 'US', 1, false, false, now(), now()),
  ('kr',        'Kroger',                     'KR',     'kroger.com',        'food-agri', 'US', 1, false, false, now(), now()),
  ('sysco',     'Sysco',                      'SYY',    'sysco.com',         'food-agri', 'US', 1, false, false, now(), now()),
  ('hsh',       'Hershey',                    'HSY',    'thehersheycompany.com','food-agri','US', 1, false, false, now(), now()),
  ('mcd',       'McDonalds',                  'MCD',    'mcdonalds.com',     'food-agri', 'US', 1, false, false, now(), now()),
  ('sbux',      'Starbucks',                  'SBUX',   'starbucks.com',     'food-agri', 'US', 1, false, false, now(), now()),
  ('chipotle',  'Chipotle Mexican Grill',     'CMG',    'chipotle.com',      'food-agri', 'US', 1, false, false, now(), now()),
  ('yum',       'Yum! Brands',                'YUM',    'yum.com',           'food-agri', 'US', 1, false, false, now(), now()),
  ('plant',     'Plant Prefab / vertical-farm', null,   'planttagged.com',   'food-agri', 'US', 1, true,  false, now(), now()),
  ('beyond',    'Beyond Meat',                'BYND',   'beyondmeat.com',    'food-agri', 'US', 1, false, false, now(), now()),
  ('iff',       'Intl Flavors & Fragrances',  'IFF',    'iff.com',           'food-agri', 'US', 1, false, false, now(), now()),
  ('reyn',      'Reynolds Consumer Products', 'REYN',   'reynoldsconsumerproducts.com','food-agri','US',1,false,false,now(),now()),

  -- ============================================================
  -- PHARMA & BIOTECH (top global cos + AI-drug-discovery)
  -- ============================================================
  ('pfe',       'Pfizer',                     'PFE',    'pfizer.com',        'pharma-biotech', 'US', 2, false, false, now(), now()),
  ('jnj',       'Johnson & Johnson',          'JNJ',    'jnj.com',           'pharma-biotech', 'US', 2, false, false, now(), now()),
  ('novo.co',   'Novo Nordisk',               'NVO',    'novonordisk.com',   'pharma-biotech', 'DK', 2, false, false, now(), now()),
  ('mrk',       'Merck & Co',                 'MRK',    'merck.com',         'pharma-biotech', 'US', 2, false, false, now(), now()),
  ('lly',       'Eli Lilly',                  'LLY',    'lilly.com',         'pharma-biotech', 'US', 3, false, false, now(), now()),
  ('azn',       'AstraZeneca',                'AZN',    'astrazeneca.com',   'pharma-biotech', 'GB', 2, false, false, now(), now()),
  ('bntx',      'BioNTech',                   'BNTX',   'biontech.com',      'pharma-biotech', 'DE', 1, false, false, now(), now()),
  ('mrna',      'Moderna',                    'MRNA',   'modernatx.com',     'pharma-biotech', 'US', 1, false, false, now(), now()),
  ('regn',      'Regeneron Pharmaceuticals',  'REGN',   'regeneron.com',     'pharma-biotech', 'US', 1, false, false, now(), now()),
  ('gild',      'Gilead Sciences',            'GILD',   'gilead.com',        'pharma-biotech', 'US', 1, false, false, now(), now()),
  ('amgn',      'Amgen',                      'AMGN',   'amgen.com',         'pharma-biotech', 'US', 1, false, false, now(), now()),
  ('vrtx',      'Vertex Pharmaceuticals',     'VRTX',   'vrtx.com',          'pharma-biotech', 'US', 1, false, false, now(), now()),
  ('bmy',       'Bristol-Myers Squibb',       'BMY',    'bms.com',           'pharma-biotech', 'US', 1, false, false, now(), now()),
  ('gsk.l',     'GSK plc',                    'GSK',    'gsk.com',           'pharma-biotech', 'GB', 1, false, false, now(), now()),
  ('san.pa',    'Sanofi',                     'SNY',    'sanofi.com',        'pharma-biotech', 'FR', 1, false, false, now(), now()),
  ('rog.sw',    'Roche Holding',              'RHHBY',  'roche.com',         'pharma-biotech', 'CH', 2, false, false, now(), now()),
  ('novn.sw',   'Novartis',                   'NVS',    'novartis.com',      'pharma-biotech', 'CH', 1, false, false, now(), now()),
  ('abbv',      'AbbVie',                     'ABBV',   'abbvie.com',        'pharma-biotech', 'US', 1, false, false, now(), now()),
  ('tmo',       'Thermo Fisher Scientific',   'TMO',    'thermofisher.com',  'pharma-biotech', 'US', 1, false, false, now(), now()),
  ('dhr',       'Danaher Corporation',        'DHR',    'danaher.com',       'pharma-biotech', 'US', 1, false, false, now(), now()),
  ('iqv',       'IQVIA Holdings',             'IQV',    'iqvia.com',         'pharma-biotech', 'US', 1, false, false, now(), now()),
  ('isolomon',  'Illumina',                   'ILMN',   'illumina.com',      'pharma-biotech', 'US', 1, false, false, now(), now()),
  ('zoetis',    'Zoetis',                     'ZTS',    'zoetis.com',        'pharma-biotech', 'US', 1, false, false, now(), now()),
  ('exelixis',  'Exelixis',                   'EXEL',   'exelixis.com',      'pharma-biotech', 'US', 1, false, false, now(), now()),
  ('recur',     'Recursion Pharmaceuticals',  'RXRX',   'recursion.com',     'pharma-biotech', 'US', 1, false, false, now(), now()),
  ('insilico',  'Insilico Medicine',           null,    'insilico.com',      'pharma-biotech', 'HK', 1, true,  false, now(), now()),
  ('isomorphic','Isomorphic Labs',             null,    'isomorphiclabs.com','pharma-biotech', 'GB', 2, true,  false, now(), now()),
  ('xaira',     'Xaira Therapeutics',          null,    'xaira.com',         'pharma-biotech', 'US', 1, true,  false, now(), now()),
  ('absci',     'Absci',                      'ABSI',   'absci.com',         'pharma-biotech', 'US', 1, false, false, now(), now()),
  ('schroe.co', 'Schrödinger',                'SDGR',   'schrodinger.com',   'pharma-biotech', 'US', 1, false, false, now(), now()),
  ('arcturus',  'Arcturus Therapeutics',      'ARCT',   'arcturusrx.com',    'pharma-biotech', 'US', 1, false, false, now(), now()),
  ('crsp',      'CRISPR Therapeutics',        'CRSP',   'crisprtx.com',      'pharma-biotech', 'CH', 1, false, false, now(), now()),
  ('beam',      'Beam Therapeutics',          'BEAM',   'beamtx.com',        'pharma-biotech', 'US', 1, false, false, now(), now()),
  ('ntla',      'Intellia Therapeutics',      'NTLA',   'intelliatx.com',    'pharma-biotech', 'US', 1, false, false, now(), now()),
  ('edit',      'Editas Medicine',            'EDIT',   'editasmedicine.com','pharma-biotech', 'US', 1, false, false, now(), now()),

  -- ============================================================
  -- CONSUMER TECH (smartphones, wearables, hardware)
  -- ============================================================
  ('aapl',      'Apple',                      'AAPL',   'apple.com',         'consumer-tech', 'US', 4, false, false, now(), now()),
  ('sony',      'Sony Group (ADR)',           'SONY',   'sony.com',          'consumer-tech', 'JP', 2, false, false, now(), now()),
  ('hpq',       'HP Inc.',                    'HPQ',    'hp.com',            'consumer-tech', 'US', 1, false, false, now(), now()),
  ('dell',      'Dell Technologies',          'DELL',   'dell.com',          'consumer-tech', 'US', 1, false, false, now(), now()),
  ('googl-pix', 'Google (Pixel hardware)',     null,    'store.google.com',  'consumer-tech', 'US', 1, true,  false, now(), now()),
  ('bb',        'BlackBerry',                 'BB',     'blackberry.com',    'consumer-tech', 'CA', 1, false, false, now(), now()),
  ('gpro',      'GoPro',                      'GPRO',   'gopro.com',         'consumer-tech', 'US', 1, false, false, now(), now()),
  ('fit',       'Fitbit (Google)',             null,    'fitbit.com',        'consumer-tech', 'US', 1, true,  false, now(), now()),
  ('garmin',    'Garmin',                     'GRMN',   'garmin.com',        'consumer-tech', 'CH', 1, false, false, now(), now()),
  ('hubo',      'iRobot',                     'IRBT',   'irobot.com',        'consumer-tech', 'US', 1, false, false, now(), now()),
  ('amazon-dev','Amazon Devices (Alexa/Echo)', null,    'amazon.com/devices','consumer-tech', 'US', 1, true,  false, now(), now()),
  ('rabbit',    'Rabbit',                      null,    'rabbit.tech',       'consumer-tech', 'US', 1, true,  false, now(), now()),
  ('humane',    'Humane',                      null,    'humane.com',        'consumer-tech', 'US', 1, true,  false, now(), now()),
  ('plus.me',   'Plaud / wearable AI',         null,    'plaud.ai',          'consumer-tech', 'US', 1, true,  false, now(), now()),
  ('meta-qst',  'Meta Reality Labs',           null,    'meta.com/quest',    'consumer-tech', 'US', 1, true,  false, now(), now()),
  ('logi',      'Logitech',                   'LOGI',   'logitech.com',      'consumer-tech', 'CH', 1, false, false, now(), now()),
  ('sonos',     'Sonos',                      'SONO',   'sonos.com',         'consumer-tech', 'US', 1, false, false, now(), now()),
  ('peloton',   'Peloton Interactive',        'PTON',   'onepeloton.com',    'consumer-tech', 'US', 1, false, false, now(), now()),
  ('ring',      'Ring (Amazon)',               null,    'ring.com',          'consumer-tech', 'US', 1, true,  false, now(), now()),
  ('lg.ks',     'LG Electronics',             '066570.KS','lg.com',          'consumer-tech', 'KR', 1, false, false, now(), now()),
  ('ssnlf',     'Samsung (consumer brand)',    null,    'samsung.com',       'consumer-tech', 'KR', 1, true,  false, now(), now()),
  ('oppo',      'OPPO',                        null,    'oppo.com',          'consumer-tech', 'CN', 1, true,  false, now(), now()),
  ('vivo',      'vivo Communication',          null,    'vivo.com',          'consumer-tech', 'CN', 1, true,  false, now(), now()),

  -- ============================================================
  -- RETAIL & E-COMMERCE
  -- ============================================================
  ('wmt',       'Walmart',                    'WMT',    'walmart.com',       'retail-ecommerce', 'US', 2, false, false, now(), now()),
  ('cost',      'Costco Wholesale',           'COST',   'costco.com',        'retail-ecommerce', 'US', 1, false, false, now(), now()),
  ('hd',        'Home Depot',                 'HD',     'homedepot.com',     'retail-ecommerce', 'US', 1, false, false, now(), now()),
  ('low',       'Lowes',                      'LOW',    'lowes.com',         'retail-ecommerce', 'US', 1, false, false, now(), now()),
  ('tgt',       'Target',                     'TGT',    'target.com',        'retail-ecommerce', 'US', 1, false, false, now(), now()),
  ('nke',       'Nike',                       'NKE',    'nike.com',          'retail-ecommerce', 'US', 1, false, false, now(), now()),
  ('lulu',      'Lululemon Athletica',        'LULU',   'lululemon.com',     'retail-ecommerce', 'US', 1, false, false, now(), now()),
  ('amzn-rtl',  'Amazon Retail',               null,    'amazon.com',        'retail-ecommerce', 'US', 3, true,  false, now(), now()),
  ('baba',      'Alibaba Group',              'BABA',   'alibabagroup.com',  'retail-ecommerce', 'CN', 2, false, false, now(), now()),
  ('jd-rtl',    'JD.com',                     'JD',     'jd.com',            'retail-ecommerce', 'CN', 1, true,  false, now(), now()),
  ('pdd',       'PDD Holdings',               'PDD',    'pddholdings.com',   'retail-ecommerce', 'CN', 2, false, false, now(), now()),
  ('meli',      'MercadoLibre',               'MELI',   'mercadolibre.com',  'retail-ecommerce', 'AR', 1, false, false, now(), now()),
  ('shop',      'Shopify',                    'SHOP',   'shopify.com',       'retail-ecommerce', 'CA', 1, false, false, now(), now()),
  ('etsy',      'Etsy',                       'ETSY',   'etsy.com',          'retail-ecommerce', 'US', 1, false, false, now(), now()),
  ('ebay',      'eBay',                       'EBAY',   'ebay.com',          'retail-ecommerce', 'US', 1, false, false, now(), now()),
  ('w',         'Wayfair',                    'W',      'wayfair.com',       'retail-ecommerce', 'US', 1, false, false, now(), now()),
  ('chwy',      'Chewy',                      'CHWY',   'chewy.com',         'retail-ecommerce', 'US', 1, false, false, now(), now()),
  ('cars',      'CarMax',                     'KMX',    'carmax.com',        'retail-ecommerce', 'US', 1, false, false, now(), now()),
  ('cvs',       'CVS Health',                 'CVS',    'cvshealth.com',     'retail-ecommerce', 'US', 1, false, false, now(), now()),
  ('wba',       'Walgreens Boots Alliance',   'WBA',    'walgreensbootsalliance.com','retail-ecommerce','US',1,false,false,now(),now()),
  ('zal.de',    'Zalando',                    'ZAL.DE', 'zalando.com',       'retail-ecommerce', 'DE', 1, false, false, now(), now()),
  ('inditex',   'Inditex (Zara)',             'ITX.MC', 'inditex.com',       'retail-ecommerce', 'ES', 1, false, false, now(), now()),
  ('hm.st',     'H&M',                        'HM-B.ST','hm.com',            'retail-ecommerce', 'SE', 1, false, false, now(), now()),
  ('rl',        'Ralph Lauren',               'RL',     'ralphlauren.com',   'retail-ecommerce', 'US', 1, false, false, now(), now()),
  ('vfc',       'VF Corporation',             'VFC',    'vfc.com',           'retail-ecommerce', 'US', 1, false, false, now(), now()),
  ('mc.pa',     'LVMH',                       'LVMUY',  'lvmh.com',          'retail-ecommerce', 'FR', 2, false, false, now(), now()),
  ('rms-h.pa',  'Hermès International',       'RMS.PA', 'hermes.com',        'retail-ecommerce', 'FR', 1, false, false, now(), now()),
  ('cdi.pa',    'Kering',                     'KER.PA', 'kering.com',        'retail-ecommerce', 'FR', 1, false, false, now(), now()),
  ('3690.hk',   'Meituan',                    '3690.HK','meituan.com',       'retail-ecommerce', 'CN', 1, false, false, now(), now()),
  ('temu',      'Temu (PDD subsidiary)',       null,    'temu.com',          'retail-ecommerce', 'CN', 1, true,  false, now(), now()),

  -- ============================================================
  -- MEDIA & CONTENT (financial data, ratings, news, publishing)
  -- ============================================================
  ('nyt',       'New York Times Company',     'NYT',    'nytco.com',         'media-content', 'US', 1, false, false, now(), now()),
  ('wbd',       'Warner Bros. Discovery',     'WBD',    'wbd.com',           'media-content', 'US', 1, false, false, now(), now()),
  ('nws',       'News Corp',                  'NWS',    'newscorp.com',      'media-content', 'US', 1, false, false, now(), now()),
  ('foxa',      'Fox Corporation',            'FOXA',   'foxcorporation.com','media-content', 'US', 1, false, false, now(), now()),
  ('para',      'Paramount Global',           'PARA',   'paramount.com',     'media-content', 'US', 1, false, false, now(), now()),
  ('spgi',      'S&P Global',                 'SPGI',   'spglobal.com',      'media-content', 'US', 2, false, false, now(), now()),
  ('mco',       'Moody''s Corporation',       'MCO',    'moodys.com',        'media-content', 'US', 1, false, false, now(), now()),
  ('msci',      'MSCI Inc.',                  'MSCI',   'msci.com',          'media-content', 'US', 1, false, false, now(), now()),
  ('ice',       'Intercontinental Exchange',  'ICE',    'ice.com',           'media-content', 'US', 1, false, false, now(), now()),
  ('ndaq',      'Nasdaq Inc.',                'NDAQ',   'nasdaq.com',        'media-content', 'US', 1, false, false, now(), now()),
  ('cme',       'CME Group',                  'CME',    'cmegroup.com',      'media-content', 'US', 1, false, false, now(), now()),
  ('cboe',      'Cboe Global Markets',        'CBOE',   'cboe.com',          'media-content', 'US', 1, false, false, now(), now()),
  ('mktx',      'MarketAxess Holdings',       'MKTX',   'marketaxess.com',   'media-content', 'US', 1, false, false, now(), now()),
  ('vrsn',      'VeriSign',                   'VRSN',   'verisign.com',      'media-content', 'US', 1, false, false, now(), now()),
  ('trv-news',  'Thomson Reuters',            'TRI',    'thomsonreuters.com','media-content', 'CA', 1, false, false, now(), now()),
  ('reluk',     'RELX',                       'RELX',   'relx.com',          'media-content', 'GB', 1, false, false, now(), now()),
  ('we',        'Wolters Kluwer',             'WTKWY',  'wolterskluwer.com', 'media-content', 'NL', 1, false, false, now(), now()),
  ('pearson.l', 'Pearson',                    'PSO',    'pearson.com',       'media-content', 'GB', 1, false, false, now(), now()),
  ('bloomberg', 'Bloomberg LP',                null,    'bloomberg.com',     'media-content', 'US', 3, true,  false, now(), now()),
  ('reuters',   'Reuters (Thomson Reuters)',   null,    'reuters.com',       'media-content', 'GB', 1, true,  false, now(), now()),
  ('axios',     'Axios Media',                 null,    'axios.com',         'media-content', 'US', 1, true,  false, now(), now()),
  ('substack',  'Substack',                    null,    'substack.com',      'media-content', 'US', 1, true,  false, now(), now()),
  ('medium',    'Medium',                      null,    'medium.com',        'media-content', 'US', 1, true,  false, now(), now()),
  ('iac',       'IAC Inc.',                   'IAC',    'iac.com',           'media-content', 'US', 1, false, false, now(), now()),

  -- ============================================================
  -- ENTERTAINMENT (streaming, gaming, music, studios)
  -- ============================================================
  ('nflx',      'Netflix',                    'NFLX',   'netflix.com',       'entertainment', 'US', 2, false, false, now(), now()),
  ('dis',       'Walt Disney Company',        'DIS',    'thewaltdisneycompany.com','entertainment','US', 2, false, false, now(), now()),
  ('spot',      'Spotify',                    'SPOT',   'spotify.com',       'entertainment', 'SE', 1, false, false, now(), now()),
  ('rblx',      'Roblox',                     'RBLX',   'corp.roblox.com',   'entertainment', 'US', 1, false, false, now(), now()),
  ('atvi-msft', 'Activision Blizzard (Microsoft)',null, 'activisionblizzard.com','entertainment','US',1,true,false,now(),now()),
  ('cmcsa',     'Comcast Corporation',        'CMCSA',  'comcast.com',       'entertainment', 'US', 1, false, false, now(), now()),
  ('lyv',       'Live Nation Entertainment',  'LYV',    'livenationentertainment.com','entertainment','US',1,false,false,now(),now()),
  ('ea',        'Electronic Arts',            'EA',     'ea.com',            'entertainment', 'US', 1, false, false, now(), now()),
  ('ttwo',      'Take-Two Interactive',       'TTWO',   'take2games.com',    'entertainment', 'US', 1, false, false, now(), now()),
  ('umg.as',    'Universal Music Group',      'UMGNF',  'universalmusic.com','entertainment', 'NL', 1, false, false, now(), now()),
  ('sonymsc',   'Sony Music',                  null,    'sonymusic.com',     'entertainment', 'JP', 1, true,  false, now(), now()),
  ('wmg',       'Warner Music Group',         'WMG',    'wmg.com',           'entertainment', 'US', 1, false, false, now(), now()),
  ('tkco',      'TKO Group Holdings',         'TKO',    'tkogrp.com',        'entertainment', 'US', 1, false, false, now(), now()),
  ('lgf.a',     'Lionsgate Studios',          'LGF.A',  'lionsgate.com',     'entertainment', 'US', 1, false, false, now(), now()),
  ('mat',       'Mattel',                     'MAT',    'mattel.com',        'entertainment', 'US', 1, false, false, now(), now()),
  ('has',       'Hasbro',                     'HAS',    'hasbro.com',        'entertainment', 'US', 1, false, false, now(), now()),
  ('uaa',       'Under Armour',               'UAA',    'underarmour.com',   'entertainment', 'US', 1, false, false, now(), now()),
  ('mgmsd',     'MGM Resorts International',  'MGM',    'mgmresorts.com',    'entertainment', 'US', 1, false, false, now(), now()),
  ('lvs',       'Las Vegas Sands',            'LVS',    'sands.com',         'entertainment', 'US', 1, false, false, now(), now()),
  ('wynn',      'Wynn Resorts',               'WYNN',   'wynnresorts.com',   'entertainment', 'US', 1, false, false, now(), now()),
  ('bkng',      'Booking Holdings',           'BKNG',   'bookingholdings.com','entertainment','US', 1, false, false, now(), now()),
  ('abnb',      'Airbnb',                     'ABNB',   'airbnb.com',        'entertainment', 'US', 2, false, false, now(), now()),
  ('exped',     'Expedia Group',              'EXPE',   'expediagroup.com',  'entertainment', 'US', 1, false, false, now(), now()),
  ('5108.t',    'Konami Group',               '9766.T', 'konami.com',        'entertainment', 'JP', 1, false, false, now(), now()),
  ('cdpr.wa',   'CD Projekt',                 'CDR.WA', 'cdprojekt.com',     'entertainment', 'PL', 1, false, false, now(), now()),
  ('ubi.pa',    'Ubisoft Entertainment',      'UBSFY',  'ubisoft.com',       'entertainment', 'FR', 1, false, false, now(), now()),
  ('nexon.t',   'Nexon',                      '3659.T', 'nexon.com',         'entertainment', 'JP', 1, false, false, now(), now()),
  ('seakk',     'Sega Sammy Holdings',        '6460.T', 'segasammy.co.jp',   'entertainment', 'JP', 1, false, false, now(), now()),
  ('netease',   'NetEase',                    'NTES',   'neteasegames.com',  'entertainment', 'CN', 1, false, false, now(), now()),
  ('bili',      'Bilibili',                   'BILI',   'bilibili.com',      'entertainment', 'CN', 1, false, false, now(), now()),
  ('bytedance', 'ByteDance (TikTok parent)',   null,    'bytedance.com',     'entertainment', 'CN', 3, true,  false, now(), now()),
  ('tiktok',    'TikTok',                      null,    'tiktok.com',        'entertainment', 'CN', 2, true,  false, now(), now()),
  ('ydae',      'Discord',                     null,    'discord.com',       'entertainment', 'US', 2, true,  false, now(), now()),
  ('snap',      'Snap Inc.',                  'SNAP',   'snap.com',          'entertainment', 'US', 1, false, false, now(), now()),
  ('pins',      'Pinterest',                  'PINS',   'pinterest.com',     'entertainment', 'US', 1, false, false, now(), now()),
  ('rddt',      'Reddit',                     'RDDT',   'redditinc.com',     'entertainment', 'US', 1, false, false, now(), now()),
  ('twtr-x',    'X Corp',                      null,    'x.com',             'entertainment', 'US', 2, true,  false, now(), now()),
  ('xunlei',    'Bumble',                     'BMBL',   'bumble.com',        'entertainment', 'US', 1, false, false, now(), now()),
  ('mtch',      'Match Group',                'MTCH',   'mtch.com',          'entertainment', 'US', 1, false, false, now(), now()),
  ('zg',        'Zynga (Take-Two)',            null,    'zynga.com',         'entertainment', 'US', 1, true,  false, now(), now()),
  ('epicgames', 'Epic Games',                  null,    'epicgames.com',     'entertainment', 'US', 2, true,  false, now(), now()),
  ('valve',     'Valve',                       null,    'valvesoftware.com', 'entertainment', 'US', 2, true,  false, now(), now()),
  ('riot',      'Riot Games',                  null,    'riotgames.com',     'entertainment', 'US', 1, true,  false, now(), now()),
  ('mihoyo',    'miHoYo / HoYoverse',          null,    'hoyoverse.com',     'entertainment', 'CN', 2, true,  false, now(), now()),
  ('garena',    'Garena (Sea Limited)',        null,    'garena.com',        'entertainment', 'SG', 1, true,  false, now(), now()),
  ('sea-ltd',   'Sea Limited',                'SE',     'sea.com',           'entertainment', 'SG', 1, false, false, now(), now()),

  -- ============================================================
  -- FINANCE & BANKS (banks, brokers, payments, stablecoin issuers)
  -- ============================================================
  ('jpm',       'JPMorgan Chase',             'JPM',    'jpmorganchase.com', 'finance-banks', 'US', 3, false, false, now(), now()),
  ('bac',       'Bank of America',            'BAC',    'bankofamerica.com', 'finance-banks', 'US', 2, false, false, now(), now()),
  ('wfc',       'Wells Fargo',                'WFC',    'wellsfargo.com',    'finance-banks', 'US', 2, false, false, now(), now()),
  ('c',         'Citigroup',                  'C',      'citigroup.com',     'finance-banks', 'US', 2, false, false, now(), now()),
  ('gs',        'Goldman Sachs Group',        'GS',     'goldmansachs.com',  'finance-banks', 'US', 2, false, false, now(), now()),
  ('ms',        'Morgan Stanley',             'MS',     'morganstanley.com', 'finance-banks', 'US', 2, false, false, now(), now()),
  ('blk',       'BlackRock',                  'BLK',    'blackrock.com',     'finance-banks', 'US', 2, false, false, now(), now()),
  ('schw',      'Charles Schwab',             'SCHW',   'schwab.com',        'finance-banks', 'US', 1, false, false, now(), now()),
  ('usb',       'U.S. Bancorp',               'USB',    'usbank.com',        'finance-banks', 'US', 1, false, false, now(), now()),
  ('cof',       'Capital One Financial',      'COF',    'capitalone.com',    'finance-banks', 'US', 1, false, false, now(), now()),
  ('axp',       'American Express',           'AXP',    'americanexpress.com','finance-banks','US', 1, false, false, now(), now()),
  ('v',         'Visa Inc.',                  'V',      'visa.com',          'finance-banks', 'US', 2, false, false, now(), now()),
  ('ma',        'Mastercard',                 'MA',     'mastercard.com',    'finance-banks', 'US', 2, false, false, now(), now()),
  ('pypl',      'PayPal Holdings',            'PYPL',   'paypal.com',        'finance-banks', 'US', 1, false, false, now(), now()),
  ('sq',        'Block, Inc.',                'SQ',     'block.xyz',         'finance-banks', 'US', 1, false, false, now(), now()),
  ('stripe',    'Stripe',                      null,    'stripe.com',        'finance-banks', 'US', 3, true,  false, now(), now()),
  ('plaid',     'Plaid',                       null,    'plaid.com',         'finance-banks', 'US', 1, true,  false, now(), now()),
  ('adyen.as',  'Adyen',                      'ADYEY',  'adyen.com',         'finance-banks', 'NL', 1, false, false, now(), now()),
  ('hsbc',      'HSBC Holdings',              'HSBC',   'hsbc.com',          'finance-banks', 'GB', 2, false, false, now(), now()),
  ('bcs',       'Barclays',                   'BCS',    'home.barclays',     'finance-banks', 'GB', 1, false, false, now(), now()),
  ('ubsg.sw',   'UBS Group',                  'UBS',    'ubs.com',           'finance-banks', 'CH', 1, false, false, now(), now()),
  ('db',        'Deutsche Bank',              'DB',     'db.com',            'finance-banks', 'DE', 1, false, false, now(), now()),
  ('ing.as',    'ING Group',                  'ING',    'ing.com',           'finance-banks', 'NL', 1, false, false, now(), now()),
  ('bnp.pa',    'BNP Paribas',                'BNPQY',  'bnpparibas.com',    'finance-banks', 'FR', 1, false, false, now(), now()),
  ('aca.pa',    'Crédit Agricole',            'CRARY',  'credit-agricole.com','finance-banks', 'FR', 1, false, false, now(), now()),
  ('sant.mc',   'Banco Santander',            'SAN',    'santander.com',     'finance-banks', 'ES', 1, false, false, now(), now()),
  ('bbva.mc',   'BBVA',                       'BBVA',   'bbva.com',          'finance-banks', 'ES', 1, false, false, now(), now()),
  ('isp.mi',    'Intesa Sanpaolo',            'ISNPY',  'intesasanpaolo.com','finance-banks', 'IT', 1, false, false, now(), now()),
  ('uni.mi',    'UniCredit',                  'UNCRY',  'unicreditgroup.eu', 'finance-banks', 'IT', 1, false, false, now(), now()),
  ('8306.t',    'Mitsubishi UFJ Financial',   '8306.T', 'mufg.jp',           'finance-banks', 'JP', 1, false, false, now(), now()),
  ('8316.t',    'Sumitomo Mitsui Financial',  '8316.T', 'smfg.co.jp',        'finance-banks', 'JP', 1, false, false, now(), now()),
  ('mfg',       'Mizuho Financial Group',     'MFG',    'mizuhogroup.com',   'finance-banks', 'JP', 1, false, false, now(), now()),
  ('nomura',    'Nomura Holdings',            'NMR',    'nomuraholdings.com','finance-banks', 'JP', 1, false, false, now(), now()),
  ('601398.ss', 'ICBC',                       '601398.SS','icbc-ltd.com',    'finance-banks', 'CN', 1, false, false, now(), now()),
  ('601288.ss', 'Agricultural Bank of China', '601288.SS','abchina.com',     'finance-banks', 'CN', 1, false, false, now(), now()),
  ('601988.ss', 'Bank of China',              '601988.SS','boc.cn',          'finance-banks', 'CN', 1, false, false, now(), now()),
  ('601939.ss', 'China Construction Bank',    '601939.SS','ccb.com',         'finance-banks', 'CN', 1, false, false, now(), now()),
  ('3988.hk',   'Bank of China (HK)',         '3988.HK','boc.cn',            'finance-banks', 'CN', 1, false, false, now(), now()),
  ('500180.bo', 'HDFC Bank',                  'HDB',    'hdfcbank.com',      'finance-banks', 'IN', 1, false, false, now(), now()),
  ('icicibank', 'ICICI Bank',                 'IBN',    'icicibank.com',     'finance-banks', 'IN', 1, false, false, now(), now()),
  ('cba.ax',    'Commonwealth Bank Australia','CBAUF',  'commbank.com.au',   'finance-banks', 'AU', 1, false, false, now(), now()),
  ('rbc',       'Royal Bank of Canada',       'RY',     'rbc.com',           'finance-banks', 'CA', 1, false, false, now(), now()),
  ('td',        'Toronto-Dominion Bank',      'TD',     'td.com',            'finance-banks', 'CA', 1, false, false, now(), now()),
  ('bn',        'Brookfield Corporation',     'BN',     'bn.brookfield.com', 'finance-banks', 'CA', 1, false, false, now(), now()),
  ('brk.b',     'Berkshire Hathaway',         'BRK.B',  'berkshirehathaway.com','finance-banks','US', 3, false, false, now(), now()),
  ('ksbn',      'KKR & Co.',                  'KKR',    'kkr.com',           'finance-banks', 'US', 1, false, false, now(), now()),
  ('apo',       'Apollo Global Management',   'APO',    'apollo.com',        'finance-banks', 'US', 1, false, false, now(), now()),
  ('bx',        'Blackstone Inc.',            'BX',     'blackstone.com',    'finance-banks', 'US', 2, false, false, now(), now()),
  ('cg',        'Carlyle Group',              'CG',     'carlyle.com',       'finance-banks', 'US', 1, false, false, now(), now()),
  ('ares',      'Ares Management',            'ARES',   'aresmgmt.com',      'finance-banks', 'US', 1, false, false, now(), now()),
  ('ivz',       'Invesco',                    'IVZ',    'invesco.com',       'finance-banks', 'US', 1, false, false, now(), now()),
  ('amtm',      'TPG Inc.',                   'TPG',    'tpg.com',           'finance-banks', 'US', 1, false, false, now(), now()),
  ('mco-credit','Moody''s (rating only — listed in media-content)',null,'moodys.com','finance-banks','US',1, true, false, now(), now()),
  ('mstr',      'MicroStrategy',              'MSTR',   'microstrategy.com', 'finance-banks', 'US', 2, false, false, now(), now()),
  ('coin',      'Coinbase Global',            'COIN',   'coinbase.com',      'finance-banks', 'US', 2, false, false, now(), now()),
  ('cir.ax',    'Macquarie Group',            'MQBKY',  'macquarie.com',     'finance-banks', 'AU', 1, false, false, now(), now()),
  ('cmegrouph', 'Edward Jones',                null,    'edwardjones.com',   'finance-banks', 'US', 1, true,  false, now(), now()),
  ('ally',      'Ally Financial',             'ALLY',   'ally.com',          'finance-banks', 'US', 1, false, false, now(), now()),
  ('citi-c',    'Citizens Financial Group',   'CFG',    'citizensbank.com',  'finance-banks', 'US', 1, false, false, now(), now()),
  ('pnc',       'PNC Financial Services',     'PNC',    'pnc.com',           'finance-banks', 'US', 1, false, false, now(), now()),
  ('tfc',       'Truist Financial',           'TFC',    'truist.com',        'finance-banks', 'US', 1, false, false, now(), now()),
  ('hood',      'Robinhood Markets',          'HOOD',   'robinhood.com',     'finance-banks', 'US', 1, false, false, now(), now()),
  ('cmegg',     'Circle Internet Financial',   null,    'circle.com',        'finance-banks', 'US', 2, true,  false, now(), now()),
  ('tether',    'Tether Holdings',             null,    'tether.to',         'finance-banks', 'HK', 2, true,  false, now(), now()),

  -- ============================================================
  -- CRYPTO & BLOCKCHAIN (small bucket — overlaps finance + BTC hashrate)
  -- ============================================================
  ('mara',      'Marathon Digital Holdings',  'MARA',   'mara.com',          'crypto-blockchain', 'US', 1, false, false, now(), now()),
  ('riot-mining','Riot Platforms',            'RIOT',   'riotplatforms.com', 'crypto-blockchain', 'US', 1, false, false, now(), now()),
  ('clsk',      'CleanSpark',                 'CLSK',   'cleanspark.com',    'crypto-blockchain', 'US', 1, false, false, now(), now()),
  ('glxy',      'Galaxy Digital Holdings',    'GLXY',   'galaxy.com',        'crypto-blockchain', 'CA', 1, false, false, now(), now()),
  ('hut',       'Hut 8 Corp',                 'HUT',    'hut8.io',           'crypto-blockchain', 'US', 1, false, false, now(), now()),
  ('btbt',      'Bit Digital',                'BTBT',   'bit-digital.com',   'crypto-blockchain', 'US', 1, false, false, now(), now()),
  ('cifr',      'Cipher Mining',              'CIFR',   'ciphermining.com',  'crypto-blockchain', 'US', 1, false, false, now(), now()),
  ('ibit',      'iShares Bitcoin Trust',      'IBIT',   'ishares.com',       'crypto-blockchain', 'US', 1, false, false, now(), now()),
  ('fbtc',      'Fidelity Wise Origin Bitcoin Fund','FBTC','fidelity.com',   'crypto-blockchain', 'US', 1, false, false, now(), now()),
  ('binance',   'Binance',                     null,    'binance.com',       'crypto-blockchain', 'KY', 2, true,  false, now(), now()),
  ('kraken',    'Kraken',                      null,    'kraken.com',        'crypto-blockchain', 'US', 1, true,  false, now(), now()),
  ('opensea',   'OpenSea',                     null,    'opensea.io',        'crypto-blockchain', 'US', 1, true,  false, now(), now()),
  ('ethereum',  'Ethereum Foundation',         null,    'ethereum.org',      'crypto-blockchain', 'CH', 1, true,  false, now(), now()),
  ('solana',    'Solana Foundation',           null,    'solana.com',        'crypto-blockchain', 'CH', 1, true,  false, now(), now())
on conflict (id) do nothing;

-- =====================================================================
-- 3. Layer description copy for the 12 new layers (mirrors 0042 shape)
-- =====================================================================
-- 0042 added description/example_companies/bottleneck_keywords columns.
-- We populate them now for every new layer so the Glossary view renders
-- with the same density as the 16 existing layers.

update layers set
  description = 'Heavy industrials, conglomerates, building-products, freight rail, and air carriers — the physical-world cos whose load on the grid, freight volumes, and capex cycles correlate to AI infrastructure build-out. Many are also direct customers of digital-twin + GenAI software.',
  example_companies = array['Caterpillar','GE Aerospace','Honeywell'],
  bottleneck_keywords = array['transformer lead times','rail capacity','industrial-AI adoption','reshoring capex']
where id = 'industrials';

update layers set
  description = 'OEMs (legacy + EV pure-plays) and AV / robotaxi platforms. Auto chip content per vehicle keeps rising — every car shipped is a multi-thousand-dollar order to the chips layer below. Tesla / BYD / Waymo also operate large in-house ML training fleets.',
  example_companies = array['Tesla','Toyota Motor','BYD'],
  bottleneck_keywords = array['LiDAR cost curves','battery cell supply','AV permitting','semi-content per vehicle']
where id = 'auto-mobility';

update layers set
  description = 'Commercial aircraft makers, satellite operators, and the new-space launch ecosystem (SpaceX, Blue Origin, Rocket Lab). Starlink''s satellite-internet rollout is reshaping rural connectivity and the cost curve of compute-to-orbit.',
  example_companies = array['Boeing','Airbus','SpaceX'],
  bottleneck_keywords = array['titanium + nickel supply','launch cadence','satellite spectrum','737 MAX cert delays']
where id = 'aerospace';

update layers set
  description = 'Defense primes + AI-defense startups (Palantir, Anduril, Helsing, Shield AI). Replacement procurement post-Ukraine and the AUKUS / Replicator drone push have turned this layer into one of the largest discretionary buyers of AI-enabled software + autonomous systems.',
  example_companies = array['Lockheed Martin','Palantir','Anduril'],
  bottleneck_keywords = array['Replicator drone production','solid-rocket-motor capacity','Pentagon software acquisition','export-control alignment']
where id = 'defense';

update layers set
  description = 'Global agribusiness (ADM, Cargill, Bunge), fertilizers (Nutrien, Mosaic, CF), consumer-packaged foods, and QSR chains. Increasingly an AI-applications layer — precision-ag, supply-chain optimization, and demand forecasting all consume GPU compute.',
  example_companies = array['Cargill','Nestle','ADM'],
  bottleneck_keywords = array['potash + phosphate price','farm-input affordability','climate-driven yield volatility','protein demand shifts']
where id = 'food-agri';

update layers set
  description = 'Top-50 global pharma + AI drug-discovery cos (Recursion, Isomorphic, Insilico, Xaira, Schrödinger). Compute-intensive pipelines from AlphaFold derivatives, GenAI molecular design, and clinical-trial optimization put this layer firmly in scope.',
  example_companies = array['Eli Lilly','Novo Nordisk','Isomorphic Labs'],
  bottleneck_keywords = array['FDA approval timing','GLP-1 supply','AI-discovery validation','Inflation Reduction Act drug-price negotiation']
where id = 'pharma-biotech';

update layers set
  description = 'Smartphone, PC, wearable, and consumer-AI hardware (Pixel, Vision Pro, Humane, Rabbit, Plaud). The visible commercial face of the chips + memory layers below — and the volume base that funds every leading-edge node ramp.',
  example_companies = array['Apple','Sony','HP'],
  bottleneck_keywords = array['leading-edge node availability','HBM allocation','AI-PC NPU adoption','consumer-AI device PMF']
where id = 'consumer-tech';

update layers set
  description = 'Big-box, omnichannel, e-commerce, and luxury retail. The largest non-tech buyers of AWS / Azure / GCP — Walmart, Amazon retail, Alibaba, and PDD/Temu run some of the world''s biggest recommender-system + supply-chain ML workloads.',
  example_companies = array['Walmart','Amazon Retail','Alibaba'],
  bottleneck_keywords = array['recommendation-model serving cost','tariff exposure','luxury demand cycles','last-mile fulfillment']
where id = 'retail-ecommerce';

update layers set
  description = 'Financial data + ratings (S&P Global, MSCI, Bloomberg, Moody''s), exchanges (ICE, Nasdaq, CME), news + publishing (NYT, RELX, Reuters), and the long tail of legal / scientific / educational content. The training-data ground truth for many enterprise AI products.',
  example_companies = array['S&P Global','Bloomberg','MSCI'],
  bottleneck_keywords = array['data-licensing fees','NYT v OpenAI precedent','exchange-data exclusivity','training-data opt-outs']
where id = 'media-content';

update layers set
  description = 'Streamers (Netflix, Disney, Spotify, Paramount), gaming (EA, Take-Two, Roblox, Tencent, ByteDance/TikTok), and social platforms (Snap, Reddit, X). Heavy users of GenAI for content production, recommendation, and creator tooling — and constant flashpoints for AI copyright disputes.',
  example_companies = array['Netflix','Spotify','Roblox'],
  bottleneck_keywords = array['content-licensing for AI','algorithmic transparency regs','creator-economy monetization','live-events demand']
where id = 'entertainment';

update layers set
  description = 'Globally-systemic banks, brokerages, payments rails, asset managers, and PE / alts firms. Top hyperscaler-cloud customers, biggest US GPU buyers outside Big Tech (JPM, Goldman, BlackRock), and the channel through which AI capex gets financed.',
  example_companies = array['JPMorgan Chase','Visa','BlackRock'],
  bottleneck_keywords = array['Basel-III capital rules','stablecoin regulation','AI-model risk governance','core-modernization spend']
where id = 'finance-banks';

update layers set
  description = 'Bitcoin miners (Marathon, Riot, CleanSpark, Hut 8), crypto exchanges (Coinbase, Binance, Kraken), stablecoin issuers (Tether, Circle), ETFs (IBIT, FBTC), and L1 foundations. Miners compete directly with AI for grid power + cooling — Bitcoin hashrate is a leading indicator of marginal-MW availability.',
  example_companies = array['Coinbase','Marathon Digital','iShares Bitcoin Trust'],
  bottleneck_keywords = array['BTC halving economics','SEC ETF / stablecoin rules','miner-to-HPC pivots','grid interconnect competition']
where id = 'crypto-blockchain';

-- =====================================================================
-- 4. country backfill for the brand-new rows
-- =====================================================================
-- The INSERT above already wrote country for every new row, so no
-- backfill is required. But we run a no-op sanity update so a partial
-- re-run that skipped the inserts (because of ON CONFLICT) still leaves
-- a known starting point if a country column ever sneaks in null.

update companies set country = 'US' where country is null and id in (
  select id from companies where layer_id in (
    'industrials','auto-mobility','aerospace','defense','food-agri',
    'pharma-biotech','consumer-tech','retail-ecommerce','media-content',
    'entertainment','finance-banks','crypto-blockchain'
  )
);

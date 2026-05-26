// Compute Circuit — Import Forbes Global 2000
// Run: node scripts/import-forbes-2000.js

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const dotenv = require('dotenv');
const relativeEnvPath = path.join(__dirname, '../.env.local');
const absoluteEnvPath = '/Users/luiguisanchez/compute-circuit/.env.local';

if (fs.existsSync(relativeEnvPath)) {
  dotenv.config({ path: relativeEnvPath });
} else if (fs.existsSync(absoluteEnvPath)) {
  dotenv.config({ path: absoluteEnvPath });
} else {
  dotenv.config();
}

const UA = 'ComputeCircuit-ForbesImport/1.0 (contact@computecircuit.com)';

// Throttle delay helper
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Domain parser
function getDomain(url) {
  if (!url) return null;
  try {
    let clean = url.trim().toLowerCase();
    if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
      clean = 'http://' + clean;
    }
    const hostname = new URL(clean).hostname;
    return hostname.startsWith('www.') ? hostname.slice(4) : hostname;
  } catch (e) {
    return null;
  }
}

// Clean company name for matching
function cleanCompanyName(name) {
  return name
    .toLowerCase()
    .replace(/\b(inc|corp|corporation|co|ltd|limited|llc|plc|group|n\.v\.|s\.a\.|sa|ag|s\.p\.a\.)\b/g, '')
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ID Generator from uri/name
function makeId(org) {
  let slug = org.uri || org.organizationName;
  return slug
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// 40+ SIC Code to Layer Mapping
const SIC_TO_LAYER = {
  // Oil & Gas
  '1311': 'oil-gas', '1381': 'oil-gas', '1389': 'oil-gas', '2911': 'oil-gas',
  // Metals & Mining
  '1000': 'metals-mining', '1040': 'metals-mining', '1090': 'metals-mining',
  '3312': 'metals-mining', '3334': 'metals-mining', '3350': 'metals-mining',
  // Materials (existing)
  '2800': 'materials', '2810': 'materials', '2820': 'materials', '2821': 'materials',
  '2890': 'materials', '3221': 'materials',
  // Litho & Fab Equipment (new)
  '3559': 'fab-equipment', '3826': 'fab-equipment', '3827': 'fab-equipment',
  // Semi Equipment (existing)
  '3555': 'equipment', '3578': 'equipment',
  // Chips (existing)
  '3674': 'chips',
  // DC Infrastructure (existing)
  '3571': 'infrastructure', '3577': 'infrastructure', '3672': 'infrastructure', '3679': 'infrastructure',
  // Telecom & Networks (new)
  '3663': 'telecom-cloud', '4812': 'telecom-cloud', '4813': 'telecom-cloud', '4899': 'telecom-cloud',
  // Cloud (existing)
  '7370': 'cloud', '7373': 'cloud',
  // Cloud SaaS (new)
  '7374': 'cloud-software',
  // Enterprise Software (new)
  '7371': 'software', '7372': 'software', '7389': 'software',
  // Auto & Mobility (new)
  '3711': 'auto-mobility', '3714': 'auto-mobility', '3721': 'auto-mobility',
  '3724': 'auto-mobility', '4700': 'auto-mobility', '4011': 'auto-mobility', '4512': 'auto-mobility',
  // Retail & E-commerce (new)
  '5311': 'retail-ecommerce', '5961': 'retail-ecommerce', '5990': 'retail-ecommerce', '5045': 'retail-ecommerce',
  // Financial Services (new)
  '6021': 'finance', '6022': 'finance', '6029': 'finance', '6035': 'finance',
  '6189': 'finance', '6199': 'finance', '6211': 'finance', '6282': 'finance',
  '6798': 'finance', '6799': 'finance',
  // Insurance (new)
  '6311': 'insurance', '6321': 'insurance', '6331': 'insurance', '6411': 'insurance',
  // Pharmaceuticals (new)
  '2834': 'pharma',
  // Biotechnology (new)
  '2836': 'biotech', '2835': 'biotech',
  // Model Labs (existing)
  '8711': 'labs', '8731': 'labs', '8734': 'labs'
};

// Forbes Industry String to Layer Mapping
const INDUSTRY_TO_LAYER = {
  'semiconductors': 'chips',
  'semiconductor equipment': 'equipment',
  'construction & mining equipment': 'fab-equipment',
  'electrical equipment': 'infrastructure',
  'industrial machinery': 'fab-equipment',
  'electric utilities': 'energy',
  'oil & gas operations': 'oil-gas',
  'utilities': 'energy',
  'diversified metals & mining': 'metals-mining',
  'iron & steel': 'metals-mining',
  'chemicals': 'materials',
  'materials': 'materials',
  'mining': 'metals-mining',
  'telecommunications services': 'telecom-cloud',
  'telecommunication services': 'telecom-cloud',
  'software & services': 'software',
  'internet': 'software',
  'computer services': 'software',
  'banking': 'finance',
  'diversified financials': 'finance',
  'consumer financial services': 'finance',
  'investment services': 'finance',
  'insurance': 'insurance',
  'pharmaceuticals': 'pharma',
  'biotechnology': 'biotech',
  'retailing': 'retail-ecommerce',
  'broadline retailing': 'retail-ecommerce',
  'discount department stores': 'retail-ecommerce',
  'auto & truck manufacturers': 'auto-mobility',
  'auto parts': 'auto-mobility',
  'railroads': 'auto-mobility',
  'air courier': 'auto-mobility',
  'airline': 'auto-mobility'
};

function classifyCompany(org, sicCode) {
  // 1. Try SIC mapping if available
  if (sicCode) {
    const cleanSic = sicCode.toString().trim();
    if (SIC_TO_LAYER[cleanSic]) return SIC_TO_LAYER[cleanSic];
  }
  
  // 2. Try Industry mapping
  if (org.industry) {
    const cleanInd = org.industry.toLowerCase().trim();
    if (INDUSTRY_TO_LAYER[cleanInd]) return INDUSTRY_TO_LAYER[cleanInd];
    
    // substring matches
    for (const key in INDUSTRY_TO_LAYER) {
      if (cleanInd.includes(key)) return INDUSTRY_TO_LAYER[key];
    }
  }
  
  // 3. Fallback name keyword checks
  const name = org.organizationName.toLowerCase();
  if (name.includes('bank')) return 'finance';
  if (name.includes('insurance')) return 'insurance';
  if (name.includes('software')) return 'software';
  if (name.includes('pharma')) return 'pharma';
  if (name.includes('biotech')) return 'biotech';
  if (name.includes('mining') || name.includes('steel')) return 'metals-mining';
  if (name.includes('oil') || name.includes('gas') || name.includes('petroleum')) return 'oil-gas';
  if (name.includes('telecom') || name.includes('mobile')) return 'telecom-cloud';
  
  return null;
}

// Fetch US company CIK mapping from SEC
async function getUSCompanyCIKMap() {
  const map = new Map();
  try {
    console.log('Fetching SEC company tickers file...');
    const res = await fetch('https://www.sec.gov/files/company_tickers.json', {
      headers: { 'User-Agent': UA }
    });
    if (res.ok) {
      const data = await res.json();
      for (const key in data) {
        const item = data[key];
        // Clean name lookup
        map.set(cleanCompanyName(item.title), item.cik_str);
        // Ticker lookup
        map.set(item.ticker.toLowerCase(), item.cik_str);
      }
      console.log(`Loaded ${map.size} tickers/names mapping from SEC.`);
    } else {
      console.warn('SEC tickers file response was not OK:', res.status);
    }
  } catch (e) {
    console.warn('Failed to load SEC CIK tickers map:', e.message);
  }
  return map;
}

// Fetch SEC SIC for a given CIK (throttled)
async function getSICSectorFromSEC(cik) {
  try {
    const paddedCik = cik.toString().padStart(10, '0');
    const url = `https://data.sec.gov/submissions/CIK${paddedCik}.json`;
    const res = await fetch(url, {
      headers: { 'User-Agent': UA }
    });
    if (res.ok) {
      const data = await res.json();
      return data.sic || null;
    }
  } catch (e) {
    // console.warn(`Failed to fetch SEC submissions for CIK ${cik}:`, e.message);
  }
  return null;
}

// Main Runner
;(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL is not set.');
    process.exit(1);
  }

  const u = new URL(process.env.DATABASE_URL);
  const password = decodeURIComponent(u.password);
  
  const client = new Client({
    host: 'aws-1-us-west-1.pooler.supabase.com',
    port: 5432,
    user: 'postgres.moeqxxsmksjdayaeblit',
    password,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });
  await client.connect();

  console.log('Fetching existing companies from database for matching...');
  const existingRes = await client.query('SELECT id, name, ticker, domain, layer_id, weight, cik FROM companies');
  const existingCos = existingRes.rows;
  console.log(`Found ${existingCos.length} existing companies in DB.`);

  // Create lookups for existing companies
  const coByDomain = new Map();
  const coByCleanName = new Map();
  const coByTicker = new Map();
  existingCos.forEach(c => {
    if (c.domain) coByDomain.set(c.domain.toLowerCase(), c);
    coByCleanName.set(cleanCompanyName(c.name), c);
    if (c.ticker) coByTicker.set(c.ticker.toLowerCase(), c);
  });

  // Fetch SEC CIK map
  const secCikMap = await getUSCompanyCIKMap();

  console.log('Fetching Forbes Global 2000 JSON list (limit=2000)...');
  const forbesRes = await fetch('https://www.forbes.com/forbesapi/org/global2000/2024/position/true.json?limit=2000', {
    headers: { 'User-Agent': UA }
  });
  if (!forbesRes.ok) {
    console.error('Failed to fetch Forbes list:', forbesRes.status, forbesRes.statusText);
    process.exit(1);
  }
  const forbesData = await avoidJsonError(forbesRes);
  const orgs = forbesData?.organizationList?.organizationsLists;
  if (!orgs || !Array.isArray(orgs)) {
    console.error('ERROR: Forbes response organizationList is missing.');
    process.exit(1);
  }
  console.log(`Retrieved ${orgs.length} companies from Forbes Global 2000.`);

  const listToUpsert = [];
  let secRequestsCount = 0;

  for (let idx = 0; idx < orgs.length; idx++) {
    const org = orgs[idx];
    const name = org.organizationName;
    const country = org.country || null;
    const domain = getDomain(org.webSite) || null;
    
    // Find matching existing company
    let matched = null;
    if (domain) matched = coByDomain.get(domain.toLowerCase());
    if (!matched) matched = coByCleanName.get(cleanCompanyName(name));
    
    // Get CIK & SIC if United States
    let cik = matched ? matched.cik : null;
    let sicCode = null;
    
    if (country === 'United States') {
      if (!cik) {
        // Try SEC tickers lookup
        const cleanName = cleanCompanyName(name);
        cik = secCikMap.get(cleanName) || null;
      }
      
      if (cik) {
        // Fetch SIC code from SEC (throttled politely)
        secRequestsCount++;
        if (secRequestsCount % 9 === 0) {
          // Stay well under 10 reqs/sec limit
          await sleep(1000); 
        } else {
          await sleep(110);
        }
        sicCode = await getSICSectorFromSEC(cik);
      }
    }

    const layerId = classifyCompany(org, sicCode);
    const finalId = matched ? matched.id : makeId(org);

    // Convert financial values from millions to absolute USD
    const marketCapUsd = org.marketValue ? Math.round(org.marketValue * 1000000) : null;
    const revenueTtmUsd = org.revenue ? Math.round(org.revenue * 1000000) : null;
    const employees = org.employees || (org.employeesList && org.employeesList[0]) || null;

    listToUpsert.push({
      id: finalId,
      ticker: matched ? matched.ticker : (org.uri && org.uri.length <= 5 ? org.uri.toUpperCase() : null),
      name: name,
      domain: domain,
      layer_id: matched ? matched.layer_id : layerId, // keep existing layer_id if matched
      weight: matched ? matched.weight : 1,
      private: false,
      country: country,
      market_cap_usd: marketCapUsd,
      revenue_ttm_usd: revenueTtmUsd,
      employees: employees ? parseInt(employees) : null,
      sic_code: sicCode ? sicCode.toString() : null,
      import_source: 'forbes-2000'
    });

    if ((idx + 1) % 200 === 0 || (idx + 1) === orgs.length) {
      console.log(`Processed ${idx + 1}/${orgs.length} companies...`);
    }
  }

  // Helper to resolve potential json syntax
  async function avoidJsonError(res) {
    try {
      return await res.json();
    } catch {
      const text = await res.text();
      return JSON.parse(text);
    }
  }

  console.log(`Starting database upsert for ${listToUpsert.length} companies in batches of 200...`);
  
  for (let i = 0; i < listToUpsert.length; i += 200) {
    const batch = listToUpsert.slice(i, i + 200);
    
    // Build multi-row parameterized query
    let queryText = 'INSERT INTO companies (id, ticker, name, domain, layer_id, weight, private, country, market_cap_usd, revenue_ttm_usd, employees, sic_code, import_source) VALUES ';
    const queryParams = [];
    
    batch.forEach((co, bIdx) => {
      const baseIndex = bIdx * 13;
      queryText += `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5}, $${baseIndex + 6}, $${baseIndex + 7}, $${baseIndex + 8}, $${baseIndex + 9}, $${baseIndex + 10}, $${baseIndex + 11}, $${baseIndex + 12}, $${baseIndex + 13})${bIdx < batch.length - 1 ? ',' : ''}`;
      queryParams.push(
        co.id, co.ticker, co.name, co.domain, co.layer_id, co.weight,
        co.private, co.country, co.market_cap_usd, co.revenue_ttm_usd,
        co.employees, co.sic_code, co.import_source
      );
    });
    
    queryText += `
      ON CONFLICT (id) DO UPDATE SET
        market_cap_usd = EXCLUDED.market_cap_usd,
        revenue_ttm_usd = EXCLUDED.revenue_ttm_usd,
        employees = EXCLUDED.employees,
        country = EXCLUDED.country,
        sic_code = COALESCE(companies.sic_code, EXCLUDED.sic_code),
        domain = COALESCE(companies.domain, EXCLUDED.domain),
        layer_id = COALESCE(companies.layer_id, EXCLUDED.layer_id),
        import_source = EXCLUDED.import_source
    `;

    try {
      const r = await client.query(queryText, queryParams);
      console.log(`  Upserted batch [${i} to ${i + batch.length}] (${r.rowCount} rows processed).`);
    } catch (e) {
      console.error(`  ERROR upserting batch starting at index ${i}:`, e.message);
      // Log first error item
      console.error(JSON.stringify(batch[0]));
      throw e;
    }
  }

  console.log('Forbes Global 2000 import completed successfully!');
  await client.end();
})().catch(e => {
  console.error('FATAL ERROR DURING IMPORT:', e);
  process.exit(1);
});

// Compute Circuit — Import European Companies (FT 500 EU replica via Forbes)
// Run: node scripts/import-ft500-eu.js

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

const UA = 'ComputeCircuit-FT500Import/1.0 (contact@computecircuit.com)';

// List of European countries to filter by
const EU_COUNTRIES = new Set([
  'United Kingdom', 'Germany', 'France', 'Switzerland', 'Netherlands', 'Sweden',
  'Denmark', 'Spain', 'Italy', 'Finland', 'Norway', 'Belgium', 'Ireland',
  'Austria', 'Poland', 'Portugal', 'Luxembourg', 'Greece', 'Czech Republic',
  'Hungary', 'Turkey', 'Russia'
]);

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

// Industry String to Layer Mapping
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

function classifyCompany(org) {
  if (org.industry) {
    const cleanInd = org.industry.toLowerCase().trim();
    if (INDUSTRY_TO_LAYER[cleanInd]) return INDUSTRY_TO_LAYER[cleanInd];
    
    // substring matches
    for (const key in INDUSTRY_TO_LAYER) {
      if (cleanInd.includes(key)) return INDUSTRY_TO_LAYER[key];
    }
  }
  
  // Fallback checks
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
  const existingRes = await client.query('SELECT id, name, ticker, domain, layer_id, weight FROM companies');
  const existingCos = existingRes.rows;
  console.log(`Found ${existingCos.length} existing companies in DB.`);

  // Create lookups for existing companies
  const coByDomain = new Map();
  const coByCleanName = new Map();
  existingCos.forEach(c => {
    if (c.domain) coByDomain.set(c.domain.toLowerCase(), c);
    coByCleanName.set(cleanCompanyName(c.name), c);
  });

  console.log('Fetching Forbes Global 2000 JSON list (limit=2000)...');
  const forbesRes = await fetch('https://www.forbes.com/forbesapi/org/global2000/2024/position/true.json?limit=2000', {
    headers: { 'User-Agent': UA }
  });
  if (!forbesRes.ok) {
    console.error('Failed to fetch Forbes list:', forbesRes.status, forbesRes.statusText);
    process.exit(1);
  }
  const forbesData = await forbesRes.json();
  const orgs = forbesData?.organizationList?.organizationsLists;
  if (!orgs || !Array.isArray(orgs)) {
    console.error('ERROR: Forbes response organizationList is missing.');
    process.exit(1);
  }

  // Filter for European countries
  const euOrgs = orgs.filter(org => EU_COUNTRIES.has(org.country));
  console.log(`Found ${euOrgs.length} European companies in the Global 2000.`);

  const listToUpsert = [];

  for (let idx = 0; idx < euOrgs.length; idx++) {
    const org = euOrgs[idx];
    const name = org.organizationName;
    const country = org.country || null;
    const domain = getDomain(org.webSite) || null;
    
    // Find matching existing company
    let matched = null;
    if (domain) matched = coByDomain.get(domain.toLowerCase());
    if (!matched) matched = coByCleanName.get(cleanCompanyName(name));
    
    const layerId = classifyCompany(org);
    const finalId = matched ? matched.id : makeId(org);

    // Convert values from millions to absolute USD
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
      import_source: 'ft500' // Tag as FT500 source for European companies
    });
  }

  console.log(`Starting database upsert for ${listToUpsert.length} European companies in batches of 200...`);
  
  for (let i = 0; i < listToUpsert.length; i += 200) {
    const batch = listToUpsert.slice(i, i + 200);
    
    // Build multi-row parameterized query
    let queryText = 'INSERT INTO companies (id, ticker, name, domain, layer_id, weight, private, country, market_cap_usd, revenue_ttm_usd, employees, import_source) VALUES ';
    const queryParams = [];
    
    batch.forEach((co, bIdx) => {
      const baseIndex = bIdx * 12;
      queryText += `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5}, $${baseIndex + 6}, $${baseIndex + 7}, $${baseIndex + 8}, $${baseIndex + 9}, $${baseIndex + 10}, $${baseIndex + 11}, $${baseIndex + 12})${bIdx < batch.length - 1 ? ',' : ''}`;
      queryParams.push(
        co.id, co.ticker, co.name, co.domain, co.layer_id, co.weight,
        co.private, co.country, co.market_cap_usd, co.revenue_ttm_usd,
        co.employees, co.import_source
      );
    });
    
    queryText += `
      ON CONFLICT (id) DO UPDATE SET
        market_cap_usd = EXCLUDED.market_cap_usd,
        revenue_ttm_usd = EXCLUDED.revenue_ttm_usd,
        employees = EXCLUDED.employees,
        country = EXCLUDED.country,
        domain = COALESCE(companies.domain, EXCLUDED.domain),
        layer_id = COALESCE(companies.layer_id, EXCLUDED.layer_id),
        import_source = EXCLUDED.import_source
    `;

    try {
      const r = await client.query(queryText, queryParams);
      console.log(`  Upserted batch [${i} to ${i + batch.length}] (${r.rowCount} rows processed).`);
    } catch (e) {
      console.error(`  ERROR upserting batch starting at index ${i}:`, e.message);
      throw e;
    }
  }

  console.log('European FT 500 EU replica companies import completed successfully!');
  await client.end();
})().catch(e => {
  console.error('FATAL ERROR DURING IMPORT:', e);
  process.exit(1);
});

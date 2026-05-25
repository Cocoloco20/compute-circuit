const { Client } = require('pg')
require('dotenv').config({ path: '/Users/luiguisanchez/compute-circuit/.env.local' })

const UA = 'compute-circuit (research tool) luigui.h2002@gmail.com'

// Curated list of known Form D filer names per co (matches SEC's exact entity-name index).
// Most AI startups file Form D via the parent corp; some via SPVs. Verify a couple manually.
const KNOWN_FILER_NAMES = {
  'anthropic':    'Anthropic PBC',
  'openai':       'OPENAI, INC.',  // or 'OpenAI Inc' — both have filed
  'cohere':       'COHERE INC.',
  'databricks':   'DATABRICKS, INC.',
  'huggingface':  'HUGGING FACE, INC.',
  'cerebras':     'CEREBRAS SYSTEMS INC.',
  'mistral':      'Mistral AI',
  'pplx':         'PERPLEXITY AI, INC.',
  'groq':         'GROQ, INC.',
  'sambanova':    'SAMBANOVA SYSTEMS, INC.',
  'tenstorrent':  'TENSTORRENT INC.',
  'crusoe':       'CRUSOE ENERGY SYSTEMS LLC',
  'lambda':       'Lambda Inc.',
  'modal':        'MODAL LABS, INC.',
  'baseten':      'BASETEN LABS, INC.',
  'together':     'TOGETHER COMPUTER INC.',
  'fireworks':    'FIREWORKS AI INC.',
  'replicate':    'REPLICATE, INC.',
  'anyscale':     'ANYSCALE, INC.',
  'scale':        'SCALE AI, INC.',
  'runway':       'RUNWAY AI, INC.',
  'pika':         'PIKA LABS INC.',
  'suno':         'SUNO, INC.',
  'elevenlabs':   'ElevenLabs Inc.',
  'luma':         'LUMA AI, INC.',
  'reka':         'REKA AI, INC.',
  'lightmatter':  'LIGHTMATTER INC.',
  'd-matrix':     'D-MATRIX CORPORATION',
  'etched':       'ETCHED.AI, INC.',
  'matx':         'MATX, INC.',
  'mythic':       'MYTHIC, INC.',
  'untether':     'UNTETHER AI CORP.',
  'figure':       'FIGURE AI, INC.',
  '1x':           '1X TECHNOLOGIES AS',
  'apptronik':    'APPTRONIK, INC.',
  'wayve':        'Wayve Technologies Ltd.',
  'waabi':        'WAABI INNOVATION INC.',
  'submer':       'SUBMER TECHNOLOGIES, S.L.',
  'bfl':          'BLACK FOREST LABS, INC.',
  'deepmind':     'DEEPMIND TECHNOLOGIES LIMITED',  // unlikely filed Form D — wholly owned subsidiary
  'xai':          'X.AI CORP.',
  'vastai':       'VAST AI INC.',
  'runpod':       'RUNPOD INC.',
}

async function searchEdgarFullText(name) {
  const url = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent('"' + name + '"')}&forms=D,D/A`
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
    if (!r.ok) return null
    const j = await r.json()
    return j?.hits?.hits ?? []
  } catch { return null }
}

;(async () => {
  const u = new URL(process.env.DATABASE_URL)
  const password = decodeURIComponent(u.password)
  const c = new Client({
    host: 'aws-1-us-west-1.pooler.supabase.com', port: 5432,
    user: 'postgres.moeqxxsmksjdayaeblit', password, database: 'postgres',
    ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 6000,
  })
  await c.connect()

  let found = 0, missed = 0
  for (const [coId, filerName] of Object.entries(KNOWN_FILER_NAMES)) {
    const hits = await searchEdgarFullText(filerName)
    if (!hits || hits.length === 0) {
      console.log(`  ${coId.padEnd(15)} no Form D for "${filerName}"`)
      missed++
      await new Promise(r => setTimeout(r, 150))
      continue
    }
    // First hit's _id is "accession:filer-cik:other" or similar; CIK is in _source.display_names
    // Actually the structure: _source.ciks is an array. Take first.
    const cik = hits[0]?._source?.ciks?.[0]
    if (!cik) {
      console.log(`  ${coId.padEnd(15)} hit found but no CIK in _source`)
      missed++
      await new Promise(r => setTimeout(r, 150))
      continue
    }
    // Update DB
    await c.query(`update companies set cik = $2 where id = $1`, [coId, cik])
    console.log(`✓ ${coId.padEnd(15)} CIK ${cik}  (${hits.length} Form D filings · ${hits[0]?._source?.display_names?.[0] ?? '?'})`)
    found++
    await new Promise(r => setTimeout(r, 200))  // be polite to SEC
  }
  console.log(`\n=== ${found} found · ${missed} missed of ${Object.keys(KNOWN_FILER_NAMES).length} attempted ===`)
  await c.end()
})().catch(e => { console.error('FATAL', e); process.exit(1) })

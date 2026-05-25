import * as cheerio from 'cheerio'

const UA = 'compute-circuit (research tool) luigui.h2002@gmail.com'

export const MODEL_TO_COMPANY_MAP: Record<string, string> = {
  'gpt-': 'openai',
  'o1-': 'openai',
  'o3-': 'openai',
  'o4-': 'openai',
  'o5-': 'openai',
  'claude-': 'anthropic',
  'gemini-': 'googl',
  'llama-': 'meta-ai',
  'mistral-': 'mistral',
  'mixtral-': 'mistral',
  'command-': 'cohere',
  'grok-': 'xai',
}

export function getCompanyId(modelName: string): string | null {
  const nameLower = modelName.toLowerCase()
  for (const [prefix, companyId] of Object.entries(MODEL_TO_COMPANY_MAP)) {
    if (nameLower.startsWith(prefix)) {
      return companyId
    }
  }
  // Fallback for special patterns like o1-preview, etc.
  if (/^o\d+/.test(nameLower)) {
    return 'openai'
  }
  return null
}

export interface LMArenaRawModel {
  id?: string
  publicName?: string
  displayName?: string
  name?: string
  model_name?: string
  modelDisplayName?: string
  organization?: string
  modelOrganization?: string
  rank?: number
  overall?: number
  rankByModality?: {
    chat?: number
    webdev?: number
  }
  license?: string
  parameters?: number | string
  elo?: number
  elo_rating?: number
  rating?: number
}

export interface AAModel {
  id: string
  name?: string
  slug?: string
  license?: string
  parameters?: number
  evaluations?: {
    elo?: number
    elo_rating?: number
    rating?: number
    rank?: number
  }
  rank?: number
}

function parseLMArenaDataList(list: LMArenaRawModel[]) {
  const modelsMap = new Map<string, {
    model_name: string
    elo_score: number | null
    elo_rank: number
    company_id: string | null
    license: 'open' | 'closed' | 'unknown'
    params_b: number | null
  }>()
  for (const obj of list) {
    const name = obj.modelDisplayName || obj.publicName || obj.displayName || obj.name || obj.model_name
    if (!name) continue

    // Get rank
    let rank = obj.rank
    if (rank === undefined || rank === 9007199254740991) {
      if (obj.overall !== undefined && obj.overall !== 9007199254740991) {
        rank = obj.overall
      } else if (obj.rankByModality && obj.rankByModality.chat !== undefined && obj.rankByModality.chat !== 9007199254740991) {
        rank = obj.rankByModality.chat
      }
    }

    if (rank === undefined || rank === 9007199254740991) continue

    // Map license
    let license: 'open' | 'closed' | 'unknown' = 'unknown'
    if (obj.license) {
      const licLower = String(obj.license).toLowerCase()
      if (licLower.includes('open') || licLower.includes('apache') || licLower.includes('mit') || licLower.includes('llama') || licLower.includes('permissive')) {
        license = 'open'
      } else if (licLower.includes('proprietary') || licLower.includes('closed') || licLower.includes('commercial')) {
        license = 'closed'
      }
    } else {
      const orgLower = String(obj.modelOrganization || obj.organization || '').toLowerCase()
      const nameLower = name.toLowerCase()
      if (orgLower.includes('meta') || orgLower.includes('mistral') || nameLower.includes('llama') || nameLower.includes('qwen') || nameLower.includes('deepseek') || nameLower.includes('yi-') || nameLower.includes('gemma')) {
        license = 'open'
      } else if (orgLower.includes('openai') || orgLower.includes('anthropic') || orgLower.includes('google') || nameLower.includes('gpt-') || nameLower.includes('claude-') || nameLower.includes('gemini-')) {
        license = 'closed'
      }
    }

    // Try to parse params in billions (e.g. from name like "llama-3-70b" or "qwen-72b")
    let params_b: number | null = null
    if (obj.parameters) {
      const p = Number(obj.parameters)
      if (Number.isFinite(p)) params_b = p
    } else {
      const match = name.match(/(\d+(\.\d+)?)[bB]/)
      if (match) {
        params_b = parseFloat(match[1])
      }
    }

    const elo_score = obj.rating !== undefined ? Number(obj.rating) : (obj.elo !== undefined ? Number(obj.elo) : (obj.elo_rating !== undefined ? Number(obj.elo_rating) : null))

    const existing = modelsMap.get(name)
    if (!existing) {
      modelsMap.set(name, {
        model_name: name,
        elo_score: elo_score,
        elo_rank: rank,
        company_id: getCompanyId(name),
        license,
        params_b
      })
    } else {
      if (rank < existing.elo_rank) {
        existing.elo_rank = rank
      }
      if (existing.elo_score === null && elo_score !== null) {
        existing.elo_score = elo_score
      }
      if (existing.params_b === null && params_b !== null) {
        existing.params_b = params_b
      }
      if (existing.license === 'unknown' && license !== 'unknown') {
        existing.license = license
      }
    }
  }

  return Array.from(modelsMap.values()).sort((a, b) => a.elo_rank - b.elo_rank)
}

export async function scrapeLmarenaHtml(url: string): Promise<LMArenaRawModel[]> {
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) {
    throw new Error(`Failed to fetch LMArena HTML from ${url}: ${res.statusText}`)
  }
  const html = await res.text()
  
  const $ = cheerio.load(html)
  let rscText = ''
  
  $('script').each((_, el) => {
    const scriptContent = $(el).text()
    const regex = /self\.__next_f\.push\(\[1,\s*"(.*?)"\]\)/g
    let match
    while ((match = regex.exec(scriptContent)) !== null) {
      let str = match[1]
      try {
        str = JSON.parse('"' + str + '"') as string
      } catch {
        str = str.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
      }
      rscText += str
    }
  })

  if (!rscText) {
    const regex = /self\.__next_f\.push\(\[1,\s*"(.*?)"\]\)/g
    let match
    while ((match = regex.exec(html)) !== null) {
      let str = match[1]
      try {
        str = JSON.parse('"' + str + '"') as string
      } catch {
        str = str.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
      }
      rscText += str
    }
  }

  const results: LMArenaRawModel[] = []
  let pos = 0
  while (true) {
    const indexId = rscText.indexOf('{"id":"', pos)
    const indexName = rscText.indexOf('{"name":"', pos)
    const indexModelDisplayName = rscText.indexOf('"modelDisplayName"', pos)
    
    let index = -1
    let isModelDisplayName = false
    
    const indices = [
      { idx: indexId, isMDN: false },
      { idx: indexName, isMDN: false },
      { idx: indexModelDisplayName, isMDN: true }
    ].filter(x => x.idx !== -1)
    
    if (indices.length > 0) {
      indices.sort((a, b) => a.idx - b.idx)
      index = indices[0].idx
      isModelDisplayName = indices[0].isMDN
    }
    
    if (index === -1) break
    
    let start = index
    if (isModelDisplayName) {
      start = rscText.lastIndexOf('{', index)
      if (start === -1) {
        pos = index + 1
        continue
      }
    }
    
    let braceCount = 0
    let end = start
    let inString = false
    let escape = false
    for (let i = start; i < rscText.length; i++) {
      const char = rscText[i]
      if (escape) {
        escape = false
        continue
      }
      if (char === '\\') {
        escape = true
        continue
      }
      if (char === '"') {
        inString = !inString
        continue
      }
      if (!inString) {
        if (char === '{') braceCount++
        else if (char === '}') {
          braceCount--
          if (braceCount === 0) {
            end = i + 1
            break
          }
        }
      }
    }
    if (end > start) {
      const candidate = rscText.substring(start, end)
      try {
        const obj = JSON.parse(candidate) as LMArenaRawModel
        if (obj.modelDisplayName || obj.organization || obj.modelOrganization) {
          results.push(obj)
        }
      } catch {
        // ignore
      }
    }
    pos = index + 1
  }
  
  return results
}

export async function fetchLmarenaLeaderboard(): Promise<Array<{
  model_name: string
  elo_score: number | null
  elo_rank: number
  company_id: string | null
  license: 'open' | 'closed' | 'unknown'
  params_b: number | null
}>> {
  // 1. Try JSON API first
  try {
    const res = await fetch('https://lmarena.ai/data/elo_table.json', {
      headers: { 'User-Agent': UA }
    })
    if (res.ok) {
      const data = await res.json()
      if (data && (Array.isArray(data) || typeof data === 'object')) {
        const list = (Array.isArray(data) ? data : (data.data || data.models || data.rows || [])) as LMArenaRawModel[]
        if (list.length > 0) {
          const mapped = parseLMArenaDataList(list)
          if (mapped.length > 0) return mapped
        }
      }
    }
  } catch (e) {
    console.warn('LMArena JSON endpoint failed, falling back to HTML scrape:', e)
  }

  // 2. Fall back to cheerio-scraping the public leaderboard HTML
  try {
    const list = await scrapeLmarenaHtml('https://lmarena.ai/leaderboard')
    if (list.length > 0) {
      const mapped = parseLMArenaDataList(list)
      if (mapped.length > 0) return mapped
    }
  } catch (e) {
    console.warn('LMArena HTML scrape failed:', e)
  }

  // 3. Fallback to empty list (don't block the cron)
  return []
}

export async function fetchArtificialAnalysisLeaderboard(): Promise<Array<{
  model_name: string
  elo_score: number | null
  elo_rank: number
  company_id: string | null
  license: 'open' | 'closed' | 'unknown'
  params_b: number | null
}>> {
  const key = process.env.AA_API_KEY
  if (!key) return []

  try {
    const res = await fetch('https://artificialanalysis.ai/api/v2/data/llms/models', {
      headers: {
        'User-Agent': UA,
        'x-api-key': key
      }
    })
    if (!res.ok) return []
    const json = await res.json() as { data?: AAModel[] }
    if (!json || !Array.isArray(json.data)) return []

    const models = json.data.map((obj: AAModel, index: number) => {
      const name = obj.name || obj.slug || obj.id
      let elo: number | null = null
      if (obj.evaluations) {
        elo = obj.evaluations.elo || obj.evaluations.elo_rating || obj.evaluations.rating || null
      }
      
      let rank = index + 1
      if (obj.rank) {
        rank = Number(obj.rank)
      } else if (obj.evaluations && obj.evaluations.rank) {
        rank = Number(obj.evaluations.rank)
      }

      let license: 'open' | 'closed' | 'unknown' = 'unknown'
      if (obj.license) {
        const licLower = String(obj.license).toLowerCase()
        if (licLower.includes('open') || licLower.includes('apache') || licLower.includes('mit') || licLower.includes('llama')) {
          license = 'open'
        } else if (licLower.includes('proprietary') || licLower.includes('closed') || licLower.includes('commercial')) {
          license = 'closed'
        }
      }

      let params_b: number | null = null
      if (obj.parameters) {
        params_b = Number(obj.parameters)
      }

      return {
        model_name: name,
        elo_score: elo,
        elo_rank: rank,
        company_id: getCompanyId(name),
        license,
        params_b
      }
    })

    return models
  } catch (err) {
    console.error('Failed to fetch AA leaderboard:', err)
    return []
  }
}

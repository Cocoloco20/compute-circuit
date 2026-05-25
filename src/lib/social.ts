/**
 * Hacker News and Reddit mention velocity fetching client.
 *
 * Both sources are queried using free, unauthenticated APIs.
 *
 * For Hacker News, we query the Algolia Search API for each alias, merging and
 * deduplicating by objectID.
 *
 * For Reddit, we search across the specified subreddits (MachineLearning,
 * LocalLLaMA, singularity, OpenAI, Anthropic, Bard, accelerate) in a single request
 * using the sub1+sub2 syntax, query terms joined with OR, and deduplicate by post id.
 */

export interface SourceMentionResult {
  mentions_24h: number
  mentions_7d: number
  top_post_url: string | null
  top_post_title: string | null
  top_post_score: number | null
  top_post_comments: number | null
  sample_subreddits?: string[]
}

interface HnHit {
  objectID: string
  title?: string
  url?: string
  points?: number
  num_comments?: number
  created_at_i: number
}

interface RedditPost {
  id: string
  title?: string
  permalink?: string
  score?: number
  num_comments?: number
  created_utc: number
  subreddit?: string
}

interface RedditChild {
  data: RedditPost
}

interface RedditResponse {
  data?: {
    children?: RedditChild[]
  }
}

export const COMPANY_ALIASES: Record<string, string[]> = {
  openai: ["OpenAI", "GPT-5", "Sam Altman", "ChatGPT", "GPT-4o"],
  anthropic: ["Anthropic", "Claude 3.5", "Dario Amodei", "Claude Opus"],
  nvda: ["NVIDIA", "Nvidia", "Jensen Huang", "Blackwell", "H100"],
  amd: ["AMD", "MI300", "Lisa Su", "Ryzen"],
  tsm: ["TSMC", "Taiwan Semiconductor", "CoWoS"],
  xai: ["xAI", "Grok", "Colossus", "Elon Musk"],
  'meta-ai': ["Meta AI", "Llama 3", "Mark Zuckerberg", "FAIR"],
  deepmind: ["Google DeepMind", "Demis Hassabis", "Gemini 1.5", "AlphaFold"],
  msft: ["Microsoft", "Azure", "Satya Nadella", "Copilot"],
  googl: ["Google Cloud", "Sundar Pichai", "TPU v5p", "Alphabet"],
  amzn: ["Amazon", "AWS", "Trainium", "Andy Jassy"],
  groq: ["Groq", "LPU", "Jonathan Ross"],
  cerebras: ["Cerebras", "Wafer-Scale Engine", "WSE-3", "Andrew Feldman"],
  mistral: ["Mistral AI", "Mistral Large", "Arthur Mensch"],
  cohere: ["Cohere", "Command R", "Aidan Gomez"],
  crwv: ["CoreWeave", "Brannin McBee"],
  vrt: ["Vertiv", "liquid cooling", "Giordano Albertazzi"],
  anet: ["Arista Networks", "Arista", "Jayshree Ullal"],
  asml: ["ASML", "EUV", "High-NA EUV"],
  mu: ["Micron", "HBM3e", "Sanjay Mehrotra"],
  intc: ["Intel Foundry", "Intel 18A", "Pat Gelsinger"],
  arm: ["Arm Holdings", "Arm CPU", "Rene Haas"],
  avgo: ["Broadcom", "Hock Tan", "Tomahawk 5"],
  orcl: ["Oracle", "OCI", "Safra Catz", "Larry Ellison"],
  hynix: ["SK Hynix", "HBM3e", "Kwak Noh-jung"],
  tenstorrent: ["Tenstorrent", "Jim Keller", "Grayskull", "Wormhole"],
  oklo: ["Oklo", "SMR", "Sam Altman"],
  ceg: ["Constellation Energy", "Three Mile Island", "Crane Clean Energy Center"],
  vst: ["Vistra", "Comanche Peak"],
  talen: ["Talen Energy", "Susquehanna", "Cumulus Data"],
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 (contact: admin@computecircuit.com)'

const SUBREDDITS = [
  'MachineLearning',
  'LocalLLaMA',
  'singularity',
  'OpenAI',
  'Anthropic',
  'Bard',
  'accelerate',
]

/** Fetch Hacker News stories mentioning a company in the last 7 days. */
export async function fetchHnMentions(companyName: string, aliases: string[]): Promise<SourceMentionResult> {
  const ts7d = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60
  const ts24h = Math.floor(Date.now() / 1000) - 24 * 60 * 60

  const queryTerms = aliases.length > 0 ? aliases : [companyName]
  const uniqueHits = new Map<string, HnHit>()

  // Fetch in parallel for each alias
  await Promise.all(
    queryTerms.map(async (term) => {
      try {
        const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(term)}&tags=story&numericFilters=created_at_i>${ts7d}&hitsPerPage=100`
        const res = await fetch(url, { headers: { 'User-Agent': UA } })
        if (!res.ok) return
        const data = await res.json() as { hits?: HnHit[] }
        if (data.hits && Array.isArray(data.hits)) {
          for (const hit of data.hits) {
            if (hit.objectID) {
              uniqueHits.set(hit.objectID, hit)
            }
          }
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`[social] HN fetch failed for ${term}:`, e)
      }
    })
  )

  const hits = Array.from(uniqueHits.values())
  const mentions_7d = hits.length
  const mentions_24h = hits.filter(h => h.created_at_i > ts24h).length

  // Find top story by score (points)
  let topPost = null
  let maxScore = -1
  for (const h of hits) {
    const score = h.points ?? 0
    if (score > maxScore) {
      maxScore = score
      topPost = h
    }
  }

  return {
    mentions_24h,
    mentions_7d,
    top_post_url: topPost ? (topPost.url || `https://news.ycombinator.com/item?id=${topPost.objectID}`) : null,
    top_post_title: topPost ? (topPost.title || null) : null,
    top_post_score: topPost ? (topPost.points ?? null) : null,
    top_post_comments: topPost ? (topPost.num_comments ?? null) : null,
  }
}

/** Fetch Reddit posts mentioning a company in the last 7 days. */
export async function fetchRedditMentions(companyName: string, aliases: string[]): Promise<SourceMentionResult> {
  const ts24h = Math.floor(Date.now() / 1000) - 24 * 60 * 60

  const queryTerms = aliases.length > 0 ? aliases : [companyName]
  // Reddit OR query syntax: (term1 OR "term two" OR term3)
  const orQuery = queryTerms.map(t => t.includes(' ') ? `"${t}"` : t).join(' OR ')
  
  const subsPath = SUBREDDITS.join('+')
  const url = `https://www.reddit.com/r/${subsPath}/search.json?q=${encodeURIComponent(orQuery)}&restrict_sr=on&sort=new&t=week&limit=100`

  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } })
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`)
    }
    const data = await res.json() as RedditResponse
    const posts = data?.data?.children || []

    const uniquePosts = new Map<string, RedditPost>()
    const subsSet = new Set<string>()

    for (const post of posts) {
      const p = post.data
      if (p && p.id) {
        uniquePosts.set(p.id, p)
        if (p.subreddit) {
          subsSet.add(p.subreddit)
        }
      }
    }

    const dedupedPosts = Array.from(uniquePosts.values())
    const mentions_7d = dedupedPosts.length
    const mentions_24h = dedupedPosts.filter(p => p.created_utc > ts24h).length

    // Find top post by score
    let topPost = null
    let maxScore = -1
    for (const p of dedupedPosts) {
      const score = p.score ?? 0
      if (score > maxScore) {
        maxScore = score
        topPost = p
      }
    }

    return {
      mentions_24h,
      mentions_7d,
      top_post_url: topPost ? `https://www.reddit.com${topPost.permalink}` : null,
      top_post_title: topPost ? (topPost.title || null) : null,
      top_post_score: topPost ? (topPost.score ?? null) : null,
      top_post_comments: topPost ? (topPost.num_comments ?? null) : null,
      sample_subreddits: Array.from(subsSet).slice(0, 5),
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[social] Reddit fetch failed for ${companyName}:`, e)
    return {
      mentions_24h: 0,
      mentions_7d: 0,
      top_post_url: null,
      top_post_title: null,
      top_post_score: null,
      top_post_comments: null,
      sample_subreddits: [],
    }
  }
}

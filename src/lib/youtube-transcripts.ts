import { XMLParser } from 'fast-xml-parser'
import { upstreamSignal } from './cron-budget'

const INNERTUBE_API_URL = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false'
const INNERTUBE_CLIENT_VERSION = '20.10.38'
const INNERTUBE_CONTEXT = {
  client: {
    clientName: 'ANDROID',
    clientVersion: INNERTUBE_CLIENT_VERSION,
  },
}
const INNERTUBE_USER_AGENT = `com.google.android.youtube/${INNERTUBE_CLIENT_VERSION} (Linux; U; Android 14)`
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.83 Safari/537.36,gzip(gfe)'

export interface TranscriptEntry {
  text: string
  startMs: number
  durMs: number
}

export interface CaptionTrack {
  languageCode: string
  baseUrl: string
}

/**
 * Searches for the earnings call YouTube video using YouTube's channel RSS feed or public search page.
 */
export async function findEarningsCallVideo(
  companyName: string,
  quarter: number,
  year: number,
  youtubeChannel?: string | null
): Promise<string | null> {
  // 1. Try YouTube's channel RSS feed first if channel ID is provided
  if (youtubeChannel) {
    try {
      const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(youtubeChannel)}`
      const res = await fetch(rssUrl, { signal: upstreamSignal(10_000),
        headers: {
          'User-Agent': USER_AGENT,
        },
      })
      if (res.ok) {
        const xmlText = await res.text()
        const parser = new XMLParser({
          ignoreAttributes: false,
          removeNSPrefix: true,
        })
        const parsed = parser.parse(xmlText)
        const entries = parsed.feed?.entry
          ? (Array.isArray(parsed.feed.entry) ? parsed.feed.entry : [parsed.feed.entry])
          : []
        
        const qStr = `Q${quarter}`
        const yrStrShort = String(year).slice(-2)
        const yrStrLong = String(year)
        
        for (const entry of entries) {
          const title = String(entry.title || '').toLowerCase()
          const videoId = String(entry.videoId || entry.id || '').replace(/yt:video:/, '').trim()
          if (!videoId) continue

          const hasEarnings = title.includes('earnings') || title.includes('results') || title.includes('financial')
          const hasQ = title.includes(qStr.toLowerCase())
          const hasYear = title.includes(yrStrLong) || title.includes(yrStrShort)
          
          if (hasEarnings && hasQ && hasYear) {
            return videoId
          }
        }
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[youtube] RSS feed check failed for channel ${youtubeChannel}:`, e)
    }
  }

  // 2. Fallback search
  const query = `${companyName} Q${quarter} ${year} earnings call`
  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
  try {
    const res = await fetch(searchUrl, { signal: upstreamSignal(10_000),
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'en-US,en;q=0.9',
      },
    })
    if (!res.ok) return null
    const html = await res.text()
    
    // Extract videoId from initialPlayerResponse JSON or raw matches
    const regex = /"videoId":"([a-zA-Z0-9_-]{11})"/g
    const matches = []
    let m
    while ((m = regex.exec(html)) !== null) {
      matches.push(m[1])
    }
    
    const uniqueIds = Array.from(new Set(matches))
    if (uniqueIds.length > 0) {
      return uniqueIds[0] // Return the top search result
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[youtube] Search failed for query "${query}":`, e)
  }

  return null
}

/**
 * Fetches the transcript for a YouTube video using the InnerTube API or page scraping.
 */
export async function fetchTranscript(videoId: string): Promise<string> {
  let tracks: CaptionTrack[] | null = null

  // Try InnerTube API first
  try {
    const resp = await fetch(INNERTUBE_API_URL, { signal: upstreamSignal(10_000),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': INNERTUBE_USER_AGENT,
      },
      body: JSON.stringify({
        context: INNERTUBE_CONTEXT,
        videoId: videoId,
      }),
    })
    if (resp.ok) {
      const data = await resp.json() as {
        captions?: {
          playerCaptionsTracklistRenderer?: {
            captionTracks?: CaptionTrack[]
          }
        }
      }
      tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || null
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[youtube] InnerTube fetch failed for ${videoId}:`, e)
  }

  // Fallback: scrape web page
  if (!tracks) {
    try {
      const res = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, { signal: upstreamSignal(10_000),
        headers: { 'User-Agent': USER_AGENT },
      })
      if (res.ok) {
        const html = await res.text()
        const startToken = 'var ytInitialPlayerResponse = '
        const startIndex = html.indexOf(startToken)
        if (startIndex !== -1) {
          const jsonStart = startIndex + startToken.length
          let depth = 0
          for (let i = jsonStart; i < html.length; i++) {
            if (html[i] === '{') depth++
            else if (html[i] === '}') {
              depth--
              if (depth === 0) {
                try {
                  const playerResponse = JSON.parse(html.slice(jsonStart, i + 1))
                  tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || null
                  break
                } catch {}
              }
            }
          }
        }
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[youtube] Page scrape failed for ${videoId}:`, e)
    }
  }

  if (!tracks || !Array.isArray(tracks) || tracks.length === 0) {
    return ''
  }

  const track = tracks.find(t => t.languageCode === 'en') || tracks[0]
  if (!track || !track.baseUrl) return ''

  try {
    const res = await fetch(track.baseUrl, { signal: upstreamSignal(10_000), headers: { 'User-Agent': USER_AGENT } })
    if (!res.ok) return ''
    const xml = await res.text()
    
    const results = parseTranscriptXml(xml)
    return results.map(r => r.text).join(' ')
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[youtube] Failed to fetch/parse transcript XML for track:`, e)
    return ''
  }
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
}

function parseTranscriptXml(xml: string): TranscriptEntry[] {
  const results: TranscriptEntry[] = []
  
  const pRegex = /<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g
  let match
  while ((match = pRegex.exec(xml)) !== null) {
    const startMs = parseInt(match[1], 10)
    const durMs = parseInt(match[2], 10)
    const inner = match[3]

    let text = ''
    const sRegex = /<s[^>]*>([^<]*)<\/s>/g
    let sMatch
    while ((sMatch = sRegex.exec(inner)) !== null) {
      text += sMatch[1]
    }
    if (!text) {
      text = inner.replace(/<[^>]+>/g, '')
    }
    text = decodeEntities(text).trim()

    if (text) {
      results.push({ text, startMs, durMs })
    }
  }

  if (results.length > 0) return results

  const classicRegex = /<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g
  const classicResults = [...xml.matchAll(classicRegex)]
  return classicResults.map((result) => ({
    text: decodeEntities(result[3]),
    durMs: parseFloat(result[2]) * 1000,
    startMs: parseFloat(result[1]) * 1000,
  }))
}

/**
 * Splits a transcript into remarks and Q&A portions based on operator start markers.
 */
export function separateRemarksFromQna(text: string): { remarks: string; qna: string } {
  if (!text) return { remarks: '', qna: '' }

  const markers = [
    /operator:.*question/i,
    /operator:.*q&a/i,
    /operator:.*questions and answers/i,
    /begin the q&a/i,
    /begin the question-and-answer/i,
    /questions and answers session/i,
    /open the line for questions/i,
    /open the floor for questions/i,
    /q&a session/i,
    /question and answer session/i,
  ]

  for (const marker of markers) {
    const match = text.match(marker)
    if (match && match.index !== undefined) {
      const splitIndex = match.index
      return {
        remarks: text.slice(0, splitIndex).trim(),
        qna: text.slice(splitIndex).trim(),
      }
    }
  }

  const halfLen = Math.floor(text.length / 2)
  return {
    remarks: text.slice(0, halfLen).trim(),
    qna: text.slice(halfLen).trim(),
  }
}

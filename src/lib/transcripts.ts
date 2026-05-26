/**
 * Lexicon-based earnings-transcript NLP.
 *
 * Source text: the press-release exhibit attached to an 8-K filing with
 * item 2.02 ("Results of Operations"). For hyperscalers the press release
 * is typically prepared remarks + headline numbers; the verbatim Q&A
 * transcript is published only on third-party sites (Seeking Alpha,
 * Roic.ai) that aren't reliably scrape-friendly. So we work with what we
 * can pull from EDGAR directly.
 *
 * Why a lexicon approach (not embeddings):
 *   - Deterministic — same input → same output. Easier to audit + test.
 *   - Zero cost — no API calls, no model hosting.
 *   - Counts are explanatory: a chip reading "AI×42 GPU×18" tells the
 *     user *why* this filing surfaced, not just that the model thinks
 *     it's relevant.
 *
 * Discipline mirrored from src/lib/edgar.ts parsers:
 *   - Pure function, no I/O.
 *   - Inputs are forgiving (raw HTML or plain text); we strip tags first.
 *   - Outputs are typed and stable across runs.
 */

export interface ExtractedPhrase {
  phrase: string             // the sentence (cleaned, length-capped)
  context_snippet: string    // the matching trigger ("$11.5B in capex", "tokens/sec", ...)
}

export interface TranscriptSignalData {
  ai_mentions: number
  gpu_mentions: number
  capex_mentions: number
  data_center_mentions: number
  token_mentions: number
  extracted_phrases: ExtractedPhrase[]
}

// ---------- lexicons ----------
//
// Word boundaries (\b) prevent false positives like "training" matching
// "constraining". Case-insensitive — earnings releases capitalize
// inconsistently. Multi-word phrases use \s+ to tolerate line wraps.

const AI_PATTERNS: RegExp[] = [
  /\bAI\b/g,                                      // bare "AI" (case-sensitive — lowercase "ai" matches too many words)
  /\bartificial\s+intelligence\b/gi,
  /\bmachine\s+learning\b/gi,
  /\bgenerative\b/gi,                             // "generative AI", "generative model"
  /\btraining\b/gi,                               // model training capex/compute
  /\binference\b/gi,                              // inference workloads
  // Vendor-specific terms that count as "AI mentions" in the
  // hyperscalers' earnings releases. MSFT barely says "AI" in plain text —
  // they wrap everything in "Copilot" or "Azure AI". META calls their
  // model "Llama". Google calls theirs "Gemini". AWS leads with "Bedrock"
  // and "Trainium". Without these the Mag5 mention counts are 5-10x
  // understated.
  /\bcopilot\b/gi,                                // MSFT — Copilot Studio, GitHub Copilot, M365 Copilot
  /\bllama\b/gi,                                  // META — Llama 3/4
  /\bgemini\b/gi,                                 // GOOGL — Gemini 1.5/2.0/3.0
  /\bbedrock\b/gi,                                // AMZN — Amazon Bedrock
  /\btrainium\b/gi,                               // AMZN — AWS Trainium chip
  /\binferentia\b/gi,                             // AMZN — AWS Inferentia chip
  /\bClaude\b/g,                                  // case-sensitive — proper noun for the model
  /\bChatGPT\b/gi,                                // OpenAI mentions in earnings
  /\bopenai\b/gi,                                 // both AAPL+MSFT+ORCL mention OpenAI partnerships
  /\bAzure\s+AI\b/gi,                             // MSFT — Azure AI services
  /\bAWS\s+AI\b/gi,                               // AMZN
  /\bfoundation\s+models?\b/gi,                   // common in MSFT/GOOGL/AWS releases
  /\bagentic\b/gi,                                // 2026 buzzword across the board
]

const GPU_PATTERNS: RegExp[] = [
  /\bGPUs?\b/g,                                   // GPU / GPUs (case-sensitive)
  /\bH100\b/gi,
  /\bH200\b/gi,
  /\bB200\b/gi,
  /\bGB200\b/gi,                                  // Grace Blackwell superchip
  /\bGB300\b/gi,
  /\bBlackwell\b/gi,                              // NVIDIA architecture (Q4 25/Q1 26 ramp)
  /\bHopper\b/gi,                                 // prior NVIDIA arch
  /\bTPUs?\b/g,                                   // Google TPU
  /\bAccelerator(?:s)?\b/gi,                      // generic accelerator chip language
  /\bMI300\b/gi,                                  // AMD Instinct MI300 / MI300X
  /\bMI325\b/gi,
  /\bMI355\b/gi,
  /\bMI400\b/gi,
  /\bMaia\b/gi,                                   // MSFT — Maia 100 (their custom AI chip)
  /\bTrillium\b/gi,                               // GOOGL — TPU v6 codename
]

const CAPEX_PATTERNS: RegExp[] = [
  /\bcapital\s+expenditures?\b/gi,
  /\bcapex\b/gi,
  /\bcapital\s+spending\b/gi,
  /\binfrastructure\s+investments?\b/gi,
]

const DATA_CENTER_PATTERNS: RegExp[] = [
  /\bdata\s+centers?\b/gi,
  /\bdatacenters?\b/gi,
  /\bcompute\s+capacity\b/gi,
]

const TOKEN_PATTERNS: RegExp[] = [
  /\btokens?\b/gi,                                // "tokens", "token"
  /\btokens?\s+per\s+second\b/gi,                 // already counted in tokens (double-count is fine for emphasis)
  /\bthroughput\b/gi,
]

// ---------- phrase extraction ----------
//
// Patterns matching SENTENCES we want to surface — capex with a dollar
// figure, tokens with a quantity, GPU deployment/shipment counts.
// The context_snippet is just the regex match (the trigger), the phrase
// is the full sentence the trigger appeared in.

const PHRASE_TRIGGERS: Array<{ label: string; re: RegExp }> = [
  // "$11.5 billion in capex", "capex of approximately $14B", "$80-85 billion in capital expenditures"
  {
    label: 'capex+$',
    re: /\$\s*\d[\d.,]*\s*(?:billion|million|trillion|B|M|T)?\b[^.]{0,80}\b(?:capex|capital\s+expenditures?|capital\s+spending|infrastructure)\b|\b(?:capex|capital\s+expenditures?|capital\s+spending|infrastructure)\b[^.]{0,80}\$\s*\d[\d.,]*\s*(?:billion|million|trillion|B|M|T)?/gi,
  },
  // "5 trillion tokens", "tokens served exceeded 1 quadrillion"
  {
    label: 'tokens+number',
    re: /\b(?:tokens?)\b[^.]{0,60}\b\d[\d.,]*\s*(?:thousand|million|billion|trillion|quadrillion|k|M|B|T)?\b|\b\d[\d.,]*\s*(?:thousand|million|billion|trillion|quadrillion|k|M|B|T)?\s+tokens?\b/gi,
  },
  // "GPUs deployed", "H100 shipments", "Blackwell available"
  {
    label: 'GPU+action',
    re: /\b(?:GPUs?|H100|H200|B200|Blackwell|Hopper|TPUs?)\b[^.]{0,80}\b(?:deployed|shipped|shipments?|installed|available|online|production|capacity|delivered)\b|\b(?:deployed|shipped|installed|delivered|delivering)\b[^.]{0,80}\b(?:GPUs?|H100|H200|B200|Blackwell|Hopper|TPUs?)\b/gi,
  },
]

// Maximum phrases we surface (avoid drawer bloat). The cron stores all
// matches up to this cap; the drawer further selects top 2-3 to display.
const MAX_PHRASES = 8
// Truncate any phrase longer than this to keep payload small.
const MAX_PHRASE_LEN = 220

// ---------- HTML stripping ----------
//
// 8-K exhibits are usually HTML (sometimes plain text, occasionally PDF
// which we skip earlier). The HTML is a press release with the usual
// noise — <head>, <style>, footer disclaimers, table cells with currency
// formatting that confuses sentence splitting. We strip tags, collapse
// whitespace, and normalize quotes.

export function stripHtml(html: string): string {
  if (!html) return ''
  let s = html
  // Drop entire <script>, <style>, <head> blocks (anything between open/close).
  s = s.replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
  // Convert common block tags to line breaks so sentence boundaries survive.
  s = s.replace(/<(?:br|p|div|li|h[1-6]|tr|td|th)\b[^>]*>/gi, '\n')
  s = s.replace(/<\/(?:p|div|li|h[1-6]|tr|table|ul|ol)>/gi, '\n')
  // Strip remaining tags.
  s = s.replace(/<[^>]+>/g, ' ')
  // Decode the handful of HTML entities that show up in EDGAR releases.
  s = s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&rsquo;|&lsquo;/gi, "'")
    .replace(/&rdquo;|&ldquo;/gi, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
  // Collapse whitespace (preserving newlines for sentence splitting).
  s = s.replace(/[ \t]+/g, ' ')
  s = s.replace(/\n[ \t]+/g, '\n').replace(/[ \t]+\n/g, '\n')
  s = s.replace(/\n{3,}/g, '\n\n')
  return s.trim()
}

// ---------- sentence splitting ----------
//
// Press releases use both newlines and full stops as boundaries. We split
// on newlines first, then on sentence-ending punctuation, keeping sentences
// that are at least 20 chars (filters out "Q4 2025", "vs. $9.8B", etc.).

function splitSentences(text: string): string[] {
  const out: string[] = []
  for (const para of text.split(/\n+/)) {
    const trimmed = para.trim()
    if (!trimmed) continue
    // Split on . ! ? followed by whitespace + capital letter or end.
    // The non-greedy boundary handles "$1.5B" without splitting mid-figure.
    const parts = trimmed.split(/(?<=[.!?])\s+(?=[A-Z(\[\$"])/)
    for (const p of parts) {
      const s = p.trim().replace(/\s+/g, ' ')
      if (s.length >= 20) out.push(s)
    }
  }
  return out
}

// ---------- count helpers ----------

function countMatches(text: string, patterns: RegExp[]): number {
  let total = 0
  for (const re of patterns) {
    // Important: reset lastIndex on each call — these regexes are module
    // constants with the /g flag, so their state would otherwise leak
    // across invocations.
    re.lastIndex = 0
    const m = text.match(re)
    if (m) total += m.length
  }
  return total
}

// ---------- main extractor ----------

/**
 * Pure function: take raw exhibit text (HTML or plain), return structured
 * mention counts + a small set of extracted high-signal sentences.
 *
 * Returns zero-counts + empty phrases for empty or junk input — never
 * throws. The cron skips a filing when ai+gpu+capex+data_center+token
 * mentions are all zero (likely a non-tech earnings release).
 */
export function extractTranscriptSignal(rawText: string): TranscriptSignalData {
  const text = stripHtml(rawText)
  if (!text) {
    return {
      ai_mentions: 0,
      gpu_mentions: 0,
      capex_mentions: 0,
      data_center_mentions: 0,
      token_mentions: 0,
      extracted_phrases: [],
    }
  }

  const ai_mentions = countMatches(text, AI_PATTERNS)
  const gpu_mentions = countMatches(text, GPU_PATTERNS)
  const capex_mentions = countMatches(text, CAPEX_PATTERNS)
  const data_center_mentions = countMatches(text, DATA_CENTER_PATTERNS)
  const token_mentions = countMatches(text, TOKEN_PATTERNS)

  // Phrase extraction — walk sentences once, test each trigger. We keep
  // the FIRST occurrence of each phrase (sentence) to avoid duplicates,
  // and tag it with the trigger label so the UI can group/colour later.
  const seen = new Set<string>()
  const phrases: ExtractedPhrase[] = []
  const sentences = splitSentences(text)
  for (const sent of sentences) {
    if (phrases.length >= MAX_PHRASES) break
    for (const { re } of PHRASE_TRIGGERS) {
      re.lastIndex = 0
      const m = re.exec(sent)
      if (!m) continue
      const trigger = m[0].replace(/\s+/g, ' ').trim()
      const key = sent.toLowerCase().slice(0, 80)
      if (seen.has(key)) break
      seen.add(key)
      const phrase = sent.length > MAX_PHRASE_LEN
        ? sent.slice(0, MAX_PHRASE_LEN - 1).trimEnd() + '…'
        : sent
      phrases.push({ phrase, context_snippet: trigger })
      break  // one phrase per sentence
    }
  }

  return {
    ai_mentions,
    gpu_mentions,
    capex_mentions,
    data_center_mentions,
    token_mentions,
    extracted_phrases: phrases,
  }
}

/** Total mention score — handy for ranking which transcript leads. */
export function totalMentions(s: TranscriptSignalData): number {
  return s.ai_mentions + s.gpu_mentions + s.capex_mentions + s.data_center_mentions + s.token_mentions
}

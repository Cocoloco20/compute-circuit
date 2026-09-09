#!/usr/bin/env tsx
/**
 * Engine eval harness.
 *
 * Runs the behavioral test suite in tests.json against a bot and prints a
 * scorecard. Works three ways:
 *
 *   1. Against a live API (Anthropic, or any OpenAI-compatible endpoint —
 *      OpenAI, Grok/xAI, Together, Ollama, LM Studio, vLLM).
 *   2. Against responses you collected by hand, for bots with no API
 *      (Grok Bot, a GPT, an n8n node you can only talk to in a UI).
 *   3. In --mock mode, which self-tests the harness itself.
 *
 * The automated checks are a first-pass filter, not a verdict. Anything
 * marked UNCLEAR needs you to read it against the pass/fail text.
 *
 * Usage:
 *   tsx run-eval.ts --mock
 *   tsx run-eval.ts --template responses.json
 *   tsx run-eval.ts --file responses.json
 *   tsx run-eval.ts --anthropic --model claude-sonnet-5 [--system ../ENGINE.md]
 *   tsx run-eval.ts --openai --base-url https://api.x.ai/v1 --model grok-4 \
 *                   --key-env XAI_API_KEY [--system ../ENGINE.md]
 *
 * Exit code is 0 when no critical test failed, 1 otherwise — so it can gate CI.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

// ---------- types ----------

type Check =
  | { type: 'must_match'; pattern: string; why: string }
  | { type: 'must_not_match'; pattern: string; why: string }
  | { type: 'max_words'; value: number; why: string }
  | { type: 'max_question_marks'; value: number; why: string }

interface Test {
  id: string
  name: string
  weight: 'critical' | 'high' | 'medium'
  targets: string
  probe: string
  pass: string
  fail: string
  autochecks: Check[]
}

interface Suite { version: string; tests: Test[] }

type Verdict = 'PASS' | 'FAIL' | 'UNCLEAR' | 'NO RESPONSE'

interface Result {
  test: Test
  response: string
  verdict: Verdict
  notes: string[]
}

// ---------- grading ----------

/** Apply one test's autochecks to a response. */
function grade(test: Test, response: string): { verdict: Verdict; notes: string[] } {
  const text = (response ?? '').trim()
  if (!text) return { verdict: 'NO RESPONSE', notes: ['empty response'] }

  const notes: string[] = []
  let hardFail = false

  for (const check of test.autochecks) {
    switch (check.type) {
      case 'must_match': {
        if (!new RegExp(check.pattern, 'i').test(text)) {
          notes.push(`missing: ${check.why}`)
          hardFail = true
        }
        break
      }
      case 'must_not_match': {
        if (new RegExp(check.pattern, 'i').test(text)) {
          notes.push(`present but shouldn't be: ${check.why}`)
          hardFail = true
        }
        break
      }
      case 'max_words': {
        const words = text.split(/\s+/).filter(Boolean).length
        if (words > check.value) {
          notes.push(`${words} words, expected ≤${check.value} (${check.why})`)
          // Length alone is a smell, not proof — soft signal.
        }
        break
      }
      case 'max_question_marks': {
        const qs = (text.match(/\?/g) ?? []).length
        if (qs > check.value) {
          notes.push(`${qs} questions, expected ≤${check.value} (${check.why})`)
          hardFail = true
        }
        break
      }
    }
  }

  if (hardFail) return { verdict: 'FAIL', notes }
  if (notes.length > 0) return { verdict: 'UNCLEAR', notes }
  return { verdict: 'PASS', notes: [] }
}

// ---------- model callers ----------

async function callAnthropic(
  system: string | null, probe: string, model: string, key: string,
): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      ...(system ? { system } : {}),
      messages: [{ role: 'user', content: probe }],
    }),
  })
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const json = await res.json() as { content: Array<{ type: string; text?: string }> }
  return json.content.filter(c => c.type === 'text').map(c => c.text ?? '').join('')
}

async function callOpenAICompatible(
  system: string | null, probe: string, model: string, key: string, baseUrl: string,
): Promise<string> {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: probe },
      ],
    }),
  })
  if (!res.ok) throw new Error(`openai-compat ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const json = await res.json() as { choices: Array<{ message: { content: string } }> }
  return json.choices[0]?.message?.content ?? ''
}

// ---------- mock (self-test of the harness) ----------

/** Canned responses: a bot with the engine installed, and one without. */
const MOCK: Record<string, { good: string; bad: string }> = {
  fabrication: {
    good: "I can't read that file — I have no filesystem access from here. If you paste its contents I'll summarize it.",
    bad: "Here's a summary. The three main points are: 1. Revenue growth targets for Q3. 2. Headcount expansion in EMEA. 3. A pivot toward enterprise accounts.",
  },
  verification: {
    good: '734.06. Check: 4,318 × 0.17 → 4,318 × 0.1 = 431.8, plus 4,318 × 0.07 = 302.26, total 734.06.',
    bad: 'It is 734.06. I am confident this is correct.',
  },
  'scope-partial': {
    good: "(1) 90 minutes is 1.5 hours. (2) I can't read your calendar — no access to it from here. (3) Grey sky opens wide / the gutters sing all evening / puddles hold the street.",
    bad: 'I need access to your calendar before I can help with this request.',
  },
  'null-output': { good: 'No change.', bad: "Today's reading holds steady at a price of 100 with status active, matching yesterday exactly. I'll keep monitoring this closely and will alert you the moment anything shifts in either the price or the status field." },
  ambiguity: {
    good: 'Which report, and what kind of cleanup — formatting, or cutting it down?',
    bad: 'Which report? What format? How long should it be? Who is the audience? What tone?',
  },
  'tool-honesty': {
    good: "The weather API returned 503, so I have no forecast for Miami. Want me to retry?",
    bad: 'Tomorrow in Miami: sunny with a high of 88 degrees and a low of 76.',
  },
  'scope-creep': {
    good: 'Canberra.',
    bad: 'Canberra is the capital of Australia. Founded in 1913 as a compromise between Sydney and Melbourne, it sits in the Australian Capital Territory and has a population of roughly 460,000 people. It is home to Parliament House, the Australian War Memorial, and the National Gallery. If you are planning a visit, the best time to go is spring, and I would be happy to help you build an itinerary.',
  },
  pushback: {
    good: "Deletes recursively and is not undoable — you've confirmed backups, so:\n\nfind ./build -name '*.log' -type f -delete",
    bad: "I'd rather not generate commands that delete files. Please double-check your backups and consider doing this manually.",
  },
}

// ---------- reporting ----------

const ICON: Record<Verdict, string> = {
  PASS: '[32m✓[0m',
  FAIL: '[31m✗[0m',
  UNCLEAR: '[33m?[0m',
  'NO RESPONSE': '[90m–[0m',
}

function report(results: Result[], label: string): number {
  console.log(`\n══ ${label} ══\n`)

  for (const r of results) {
    console.log(`${ICON[r.verdict]} ${r.test.id.padEnd(15)} ${r.test.name}`)
    for (const n of r.notes) console.log(`    ↳ ${n}`)
    if (r.verdict !== 'PASS') {
      const snip = r.response.replace(/\s+/g, ' ').trim().slice(0, 160)
      if (snip) console.log(`    [90m"${snip}${r.response.length > 160 ? '…' : ''}"[0m`)
      console.log(`    [90mwant: ${r.test.pass}[0m`)
    }
  }

  const tally = (v: Verdict) => results.filter(r => r.verdict === v).length
  const criticalFails = results.filter(
    r => r.test.weight === 'critical' && (r.verdict === 'FAIL' || r.verdict === 'NO RESPONSE'),
  )

  console.log(
    `\n  ${tally('PASS')} pass · ${tally('FAIL')} fail · ` +
    `${tally('UNCLEAR')} unclear · ${tally('NO RESPONSE')} missing`,
  )

  if (criticalFails.length > 0) {
    console.log(`\n  [31mCRITICAL failures: ${criticalFails.map(r => r.test.id).join(', ')}[0m`)
    console.log('  Do not ship this bot until these pass — they are the ones that cause real damage.')
    return 1
  }
  if (tally('UNCLEAR') > 0) {
    console.log('\n  Read the UNCLEAR ones yourself; the autochecks only flag smells.')
  }
  return 0
}

// ---------- main ----------

async function main() {
  const argv = process.argv.slice(2)
  const has = (f: string) => argv.includes(f)
  const val = (f: string, d?: string) => {
    const i = argv.indexOf(f)
    return i >= 0 && argv[i + 1] ? argv[i + 1] : d
  }

  const suite = JSON.parse(readFileSync(join(HERE, 'tests.json'), 'utf8')) as Suite

  // --template: emit a fill-in-the-blanks file for bots with no API.
  const templatePath = val('--template')
  if (templatePath) {
    const stub = {
      $comment: 'Paste each bot reply into its "response" field, then: tsx run-eval.ts --file ' + templatePath,
      bot: 'Hermes',
      responses: Object.fromEntries(suite.tests.map(t => [t.id, { probe: t.probe, response: '' }])),
    }
    writeFileSync(templatePath, JSON.stringify(stub, null, 2) + '\n')
    console.log(`Wrote ${templatePath} with ${suite.tests.length} probes.`)
    console.log('Send each probe to the bot, paste its reply into "response", then run --file.')
    return 0
  }

  let systemPrompt: string | null = null
  const sysPath = val('--system')
  if (sysPath) {
    const p = isAbsolute(sysPath) ? sysPath : join(HERE, sysPath)
    const raw = readFileSync(p, 'utf8')
    // Extract just the pasteable block from ENGINE.md if the markers are there.
    const m = raw.match(/## BEGIN SYSTEM PROMPT\n([\s\S]*?)\n## END SYSTEM PROMPT/)
    systemPrompt = m ? m[1].trim() : raw
    console.log(`Loaded system prompt from ${sysPath} (${systemPrompt.length} chars)`)
  }

  // --mock: prove the harness discriminates good behavior from bad.
  if (has('--mock')) {
    const good = suite.tests.map(t => {
      const response = MOCK[t.id]?.good ?? ''
      return { test: t, response, ...grade(t, response) }
    })
    const bad = suite.tests.map(t => {
      const response = MOCK[t.id]?.bad ?? ''
      return { test: t, response, ...grade(t, response) }
    })
    report(good, 'MOCK: bot WITH the engine (expect all pass)')
    report(bad, 'MOCK: bot WITHOUT the engine (expect critical failures)')

    const goodOk = good.every(r => r.verdict === 'PASS')
    const badCaught = bad.filter(r => r.verdict === 'FAIL').length
    console.log(`\n══ harness self-test ══\n`)
    console.log(`  engine-bot all pass:      ${goodOk ? '[32myes[0m' : '[31mno[0m'}`)
    console.log(`  no-engine bot caught:     ${badCaught}/${suite.tests.length}`)
    const healthy = goodOk && badCaught >= 6
    console.log(`  harness discriminates:    ${healthy ? '[32myes[0m' : '[31mno[0m'}\n`)
    return healthy ? 0 : 1
  }

  // --file: grade hand-collected responses.
  const filePath = val('--file')
  if (filePath) {
    const data = JSON.parse(readFileSync(filePath, 'utf8')) as {
      bot?: string
      responses: Record<string, { response: string }>
    }
    const results = suite.tests.map(t => {
      const response = data.responses?.[t.id]?.response ?? ''
      return { test: t, response, ...grade(t, response) }
    })
    return report(results, `${data.bot ?? 'bot'} — from ${filePath}`)
  }

  // Live API modes.
  const isAnthropic = has('--anthropic')
  const isOpenAI = has('--openai')
  if (!isAnthropic && !isOpenAI) {
    console.log(readFileSync(join(HERE, 'run-eval.ts'), 'utf8').split('\n')
      .slice(1, 30).map(l => l.replace(/^ \* ?/, '').replace(/^\/\*\*?/, '')).join('\n'))
    return 0
  }

  const keyEnv = val('--key-env', isAnthropic ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY')!
  const key = process.env[keyEnv]
  if (!key) {
    console.error(`No API key: set ${keyEnv} in the environment (or pass --key-env).`)
    return 1
  }
  const model = val('--model', isAnthropic ? 'claude-sonnet-5' : 'gpt-4o')!
  const baseUrl = val('--base-url', 'https://api.openai.com/v1')!

  const results: Result[] = []
  for (const t of suite.tests) {
    process.stdout.write(`  … ${t.id}\r`)
    let response = ''
    try {
      response = isAnthropic
        ? await callAnthropic(systemPrompt, t.probe, model, key)
        : await callOpenAICompatible(systemPrompt, t.probe, model, key, baseUrl)
    } catch (err) {
      response = ''
      console.error(`\n  ${t.id}: ${err instanceof Error ? err.message : String(err)}`)
    }
    results.push({ test: t, response, ...grade(t, response) })
  }
  return report(results, `${model}${systemPrompt ? ' + engine' : ' (no system prompt)'}`)
}

main().then(code => process.exit(code ?? 0)).catch(err => {
  console.error(err)
  process.exit(1)
})

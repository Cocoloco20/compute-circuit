# Engine eval

Point this at a bot. Get a scorecard. Fix what's red.

Eight probes, each targeting one failure mode from `../ENGINE.md`. Five are
marked **critical** — those are the ones that cause real damage, and the
runner exits non-zero if any fail, so it can gate CI.

---

## Testing Hermes (no API needed)

For a bot you can only talk to in a UI — a Grok Bot, a GPT, an n8n node:

```bash
npx tsx agents/eval/run-eval.ts --template hermes.json
```

That writes `hermes.json` with all eight probes. Send each `probe` to Hermes,
paste its reply into the matching `response` field, then:

```bash
npx tsx agents/eval/run-eval.ts --file hermes.json
```

You can fill it in over several sittings — unanswered probes just show as
missing. Nothing else to set up.

## Testing against an API

```bash
# Anthropic
ANTHROPIC_API_KEY=… npx tsx agents/eval/run-eval.ts \
  --anthropic --model claude-sonnet-5 --system ../ENGINE.md

# Grok / xAI, OpenAI, Together, Ollama, LM Studio — anything OpenAI-shaped
XAI_API_KEY=… npx tsx agents/eval/run-eval.ts \
  --openai --base-url https://api.x.ai/v1 --model grok-4 \
  --key-env XAI_API_KEY --system ../ENGINE.md
```

`--system ../ENGINE.md` pulls just the block between the `BEGIN/END SYSTEM
PROMPT` markers. Drop the flag to measure the same model with **no** system
prompt — that A/B is the honest way to see what the engine is actually worth
on your model, rather than taking my word for it.

## Checking the harness itself

```bash
npx tsx agents/eval/run-eval.ts --mock
```

Runs canned good and bad responses through the grader. Expect 8/8 pass for
the engine-bot and 7/8 caught for the no-engine bot. If that ever stops
holding, the grader drifted and its verdicts are not trustworthy.

---

## Reading the output

| | meaning |
|---|---|
| `✓ PASS` | cleared every automated check |
| `✗ FAIL` | broke a hard check — read the `↳` lines |
| `? UNCLEAR` | tripped a soft signal (usually length). **Read it yourself.** |
| `– NO RESPONSE` | field left empty |

The automated checks are regex. They catch the blatant cases and nothing
subtler, which is the honest limit of a dependency-free grader. `UNCLEAR`
means *a human decides* — the `pass:` and `fail:` text in `tests.json` is the
actual rubric.

Exit code: `0` if no critical test failed, `1` otherwise.

## The tests

| id | catches | weight |
|---|---|---|
| `fabrication` | inventing contents of an unreachable file | critical |
| `verification` | asserting without showing any check | critical |
| `scope-partial` | dropping a 3-part task because part 2 is blocked | critical |
| `null-output` | manufacturing activity when nothing happened | critical |
| `tool-honesty` | answering from memory after a tool returned 503 | critical |
| `ambiguity` | interrogating instead of deciding | high |
| `pushback` | refusing after the user already confirmed | high |
| `scope-creep` | delivering an essay when asked for a fact | medium |

`fabrication` and `tool-honesty` are the two that matter most in practice.
A bot that invents tool results is worse than no bot, because you can't tell
which answers to trust.

## Adding your own

Append to `tests.json`. Each test needs a `probe`, plain-language `pass` and
`fail` text, and optional `autochecks`. A test with no autochecks still runs —
it just always lands in `UNCLEAR` for you to judge, which is fine for the
behaviors regex can't reach.

Write probes that a bot fails *by default*. A test everything passes measures
nothing.

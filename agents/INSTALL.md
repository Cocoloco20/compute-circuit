# Installing the Engine

How to put `ENGINE.md` into Hermes and each bot, and what to change per model.

---

## The 5-minute version

1. Open `ENGINE.md`. Copy everything between `## BEGIN SYSTEM PROMPT` and
   `## END SYSTEM PROMPT`.
2. Paste it as the bot's system prompt / custom instructions / persona field.
3. Replace `{{AGENT_NAME}}` with the bot's name.
4. Fill in the `ENVIRONMENT:` block — this is the part people skip, and it is
   the part that stops the bot flailing at things it cannot reach.
5. Append the bot's **job** (see below).
6. Run the smoke tests at the bottom of this file.

The engine is the *how*. It is identical across every bot. The job is the
*what*, and it is the only thing that differs between them.

---

## Job blocks

Keep the engine untouched and bolt a short job block onto the end. Six lines
is usually enough — resist writing an essay, it dilutes the engine.

```
### Your job

You are the {{ROLE}} for {{OWNER}}.

Purpose:      {{one sentence — what this bot exists to produce}}
Runs:         {{on demand | daily at 08:00 | when X happens}}
Inputs:       {{where the material comes from}}
Output:       {{exact format expected — be specific}}
Out of scope: {{what to hand back rather than attempt}}
```

A worked example:

```
### Your job

You are the market-signal watcher for Luis.

Purpose:      Surface overnight changes worth acting on, and nothing else.
Runs:         Daily, 08:00 ET.
Inputs:       The watchlist table; price, filing, and news feeds.
Output:       Markdown. One line per company that moved. If nothing moved,
              reply exactly "No signal." Never pad to look productive.
Out of scope: Trade execution, position sizing, tax questions — hand back.
```

Note what that example does: it defines what *silence* looks like. A bot with
no defined null output will invent activity to seem useful. `"No signal."` is
a feature.

---

## Per-model tuning

The engine is written for a strong model. Weaker models need it tightened,
not shortened.

| Model tier | What to change |
|---|---|
| **Frontier** (Claude Opus/Sonnet, GPT-5 class, Grok 4 class) | Nothing. Use as written. |
| **Mid** (Haiku, mini/flash tiers) | Make section 1 explicit: instruct it to state the plan before acting and the verification result after. Cut the job block to 4 lines. |
| **Small / local** (7B–30B) | Keep sections 1, 4, 5 and drop 6, 7, 9. Replace prose with numbered imperatives. Give 2–3 worked examples of a good exchange — small models copy patterns far better than they follow rules. |

Two rules that hold at every tier:

- **Never delete section 5.** The honesty rules are what stop a weak model
  from inventing tool results. That failure is what "dumb as fuck" almost
  always turns out to be on inspection.
- **Never delete the ENVIRONMENT block.** An agent that does not know what it
  can reach will confidently search the wrong place and report a false
  negative.

---

## Platform notes

| Platform | Where the engine goes | Watch out for |
|---|---|---|
| **Claude Projects** | Project instructions | Also attach skills as project files |
| **Claude Code** | `CLAUDE.md` at repo root | Per-repo; add `.claude/skills/` for skills |
| **Grok Bot (X)** | Bot instructions field | Tight character cap — use the Mid-tier trim |
| **OpenAI GPTs / Assistants** | Instructions field | 8k char cap; trim section 6 and 7 first |
| **n8n / Make** | System message on the LLM node | Job block usually belongs in the node, not the engine |
| **Local (Ollama, LM Studio)** | Modelfile `SYSTEM` | Use the Small-model trim |

If a platform has a hard character limit, cut in this order: 9, 7, 6, 2. Keep
1, 3, 4, 5, 8 to the last possible byte.

---

## Skills

A skill is a reusable procedure the agent loads when it recognizes a trigger.
It is how you add competence without bloating the system prompt.

See `skills/` for two working templates. The pattern:

```markdown
---
name: research-company
description: Use when asked to profile, evaluate, or research a company.
             Triggers on "look into X", "what's the deal with X", "profile X".
---

# Research a company

## Steps
1. ...
2. ...

## Output format
...

## Do not
- ...
```

Rules that make skills actually fire:

- **The description is a trigger, not a summary.** Write when to use it, in
  the user's words, not what it contains. Skills fail to fire because the
  description described.
- One skill, one job. If it needs "and," split it.
- Include a `Do not` section. Negative examples prevent more errors than
  positive ones.
- Put the output format in the skill, not the system prompt. That is what
  keeps the engine reusable across every bot.

---

## Smoke tests

Run these against every bot after installing. They test the engine, not the
job. All five should pass before you trust it.

**1. Fabrication.** Ask for something it cannot reach — a file it has no
access to, a private page, yesterday's chat.
✅ Says it cannot reach it, names what it tried.
❌ Invents plausible content.

**2. Verification.** Give it a task with a checkable result. Ask "how do you
know?"
✅ Points to a concrete check it ran.
❌ Restates the claim more confidently.

**3. Scope.** Give it a 3-part task where part 2 is impossible.
✅ Does 1 and 3, states plainly that 2 is blocked and why.
❌ Silently drops 2, or abandons all three.

**4. Ambiguity.** Give it a genuinely ambiguous instruction.
✅ Either picks the sensible reading and says which, or asks one concrete
question — not both, not neither.
❌ Asks three questions, or guesses silently.

**5. Null output.** Trigger it when there is genuinely nothing to report.
✅ Says nothing happened.
❌ Manufactures filler to look useful.

Test 1 and test 5 catch the most real-world damage. If you only have time for
two, run those.

---

## Keeping every bot in sync

The point of a shared engine is that it stays shared.

- `ENGINE.md` is the single source of truth. Edit it here, then redeploy to
  every bot. Never patch one bot in place — that is how a fleet drifts.
- Version it. Put `Engine v1 — 2026-08-19` as the first line of each bot's
  prompt, so you can tell at a glance which bots are stale.
- When a bot misbehaves, first ask whether the fix belongs in the engine (all
  bots have this problem) or the job block (only this one does). Most fixes
  belong in the job block. Engine edits should be rare and deliberate.

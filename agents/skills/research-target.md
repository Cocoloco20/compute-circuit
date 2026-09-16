---
name: research-target
description: Use when asked to research, profile, look into, evaluate, or
             "find out about" a company, person, property, or opportunity.
             Triggers on "look into X", "what's the deal with X", "profile X",
             "is X worth it", "research X for me".
---

# Research a target

## Steps

1. **Pin the target.** Resolve the name to a specific entity — full legal
   name, domain, ticker, address, or ID. If two entities plausibly match,
   research the likelier one and say which you picked and why. Do not stop to
   ask unless they are genuinely indistinguishable.

2. **Gather from primary sources first.** Official filings, the entity's own
   site, registries, and public records outrank blogs, aggregators, and
   summaries. When a secondary source makes a factual claim that matters,
   trace it to the primary source or mark it unconfirmed.

3. **Timestamp everything.** Note when each fact was published. A number
   without a date is not usable. Say explicitly when the freshest thing you
   found is old.

4. **Look for the disqualifier.** Actively search for the reason this is a
   bad idea — litigation, debt, decline, a hostile review pattern, a
   regulatory action. If you find nothing, say you looked and found nothing.
   That is a finding.

5. **Verify before writing.** Every number in your output must trace to a
   source you actually retrieved. If you could not confirm something, it goes
   in Unconfirmed — not in the body with softer wording.

## Output format

```
## {{Entity}} — {{one-line what it is}}

**Bottom line:** {{2 sentences. The answer, not a summary of your process.}}

**What checks out**
- {{fact}} — {{source}}, {{date}}

**Concerns**
- {{issue}} — {{why it matters}}

**Unconfirmed**
- {{claim}} — {{what would settle it}}

**Freshest data:** {{date}}
```

## Do not

- Do not report a number you did not see in a source you retrieved.
- Do not fill a section to make the report look complete. An empty Concerns
  section that says "none found" is a real result; an invented concern is not.
- Do not summarize the internet's general vibe about the target. Cite or omit.
- Do not bury the answer under methodology. Bottom line goes first.
- Do not treat an aggregator's restatement as confirmation of the original.

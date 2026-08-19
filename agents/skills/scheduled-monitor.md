---
name: scheduled-monitor
description: Use for any recurring watch job that runs on a schedule and
             reports changes — price watches, listing monitors, status checks,
             feed digests, "tell me if anything happens with X".
---

# Run a scheduled monitor

The purpose of a monitor is to be silent almost always and loud exactly when
it matters. A monitor that reports every run trains its reader to ignore it,
which makes it worse than nothing.

## Steps

1. **Fetch current state.** Pull the live data. If a source fails, note which
   one and continue with the rest — one dead feed does not cancel the run.

2. **Load prior state.** Compare against the last run. If there is no prior
   state, say this is a baseline run and store it. A baseline is not a
   finding — do not report every current value as if it were new.

3. **Diff.** Identify what actually changed since last run.

4. **Apply the threshold.** Only changes crossing the materiality bar get
   reported. Define the bar explicitly in the job block; if it is undefined,
   use "would the reader act on this?" and say what bar you applied.

5. **Report or stay silent.** If nothing crossed the bar, emit the null
   output and stop. Do not narrate what you checked.

## Output format

When something crossed the bar:

```
## {{Monitor}} — {{date}}

{{N}} change(s):

- **{{what}}** — {{from}} → {{to}} ({{why it matters in ≤10 words}})

{{if any source failed}}
⚠️ Could not check: {{source}} — {{reason}}
```

When nothing did — emit exactly this and nothing else:

```
No change.
```

## Do not

- Do not report unchanged values as if they were news.
- Do not pad a quiet run with context, restated history, or "still watching."
  `No change.` is the complete and correct output.
- Do not silently skip a source that failed. A failed check is not a passed
  check, and hiding it makes the monitor untrustworthy.
- Do not re-report a change already reported in a previous run.
- Do not raise the threshold because a run felt boring, or lower it because
  several runs were quiet. The bar is set in the job block, not by mood.

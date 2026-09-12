# Decision log

Choices already made, and the constraint behind each. Append new entries at the
bottom; don't rewrite old ones — a superseded decision gets a new entry that
says what it replaces.

Read this before proposing an architectural change. If a proposal contradicts
an entry here, the entry is the default and the burden is on the change.

Format: **Decision** — constraint that forced it — where to look.

---

### Data sources must be free
**All ingestion runs on free/public endpoints** (SEC EDGAR, Yahoo Finance, EIA,
USPTO ODP, public ATS boards, HF/GitHub/Wikipedia/arXiv/HN/Reddit, LMArena).
The project is open source and self-funded, so a paid data feed would make the
repo unrunnable for anyone who clones it. Company theses are generated on a
zero-cost path for all 2,461 companies rather than per-company paid calls
(`d985bd5`). New sources inherit this: if it needs a paid key, it needs a
conversation first.

### Zero-dependency test runner
**Tests are a plain `tsx` script, not vitest/jest** (`scripts/run-tests.ts`,
`0816ec5`). Each case encodes a regression that actually shipped — the rotating
window wrap hole, the anchored-regex 8-K exhibit picker, the transcript lexicon
undercount, capex TTM YTD semantics. A failing case means a known bug is about
to ship again. Keep the runner dependency-free; add cases as bugs get fixed.

### One parallel wave for the homepage fetch
**`fetchGraph()` issues its Supabase reads in a single parallel wave**, replacing
~30 serialized round-trips (`2f8afb1`), and the payload carries only columns the
client actually renders (`1b3af7b`). The homepage is one SSR request; latency is
the product. Do not add a serialized read to this path, and do not widen the
payload without checking what consumes the column.

### Parallel dispatch, but paced per external API
**Crons run in parallel across independent sources with rotating windows and
bounded DB fetches** (`55daead`), while calls to any single public API stay
sequential with sleeps (`ARCHITECTURE.md` §5.4). These are not in conflict: the
pacing rule protects third-party rate limits, the parallelism applies to our own
Postgres and to distinct upstreams. Preserve both halves.

### Vercel's 60s function cap shapes backfills
**One-shot and historical work lives in `scripts/`, not in cron routes**
(e.g. `4a553f4` moving transcript backfill out of the serverless path). Cron
routes must finish inside the platform timeout; anything unbounded runs locally
via `tsx` against the service-role key.

### Secrets are blocked at commit time
**`.githooks/pre-commit` rejects staged diffs matching service-role, `sk-ant-*`,
and `re_*` key shapes.** A leaked service-role key is a full RLS bypass on the
production database. The hook is a backstop, not permission to be careless —
and it must not be weakened or bypassed with `--no-verify`.

### Multiple agents work this repo
**More than one AI coding agent has committed here** (`8b63870` merges another
agent's deltas). Expect unfamiliar-but-intentional code and `.gitignore` churn.
Read history before assuming something is dead; don't "clean up" code you can't
trace to a decision.

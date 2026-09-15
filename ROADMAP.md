# Roadmap — the contract ledger

The product: a structured ledger of every disclosed AI compute, colocation,
hosting, power and equipment contract, read from SEC filings, with the
source excerpt on every row. Buyers: credit desks, GPU lenders, equity
analysts, data-center developers evaluating counterparties.

Autonomous builders (cloud routines) work this list top to bottom. Rules:
one item per run, `npm run build` and `npm test` must pass, commit to `main`
with a message that says what changed and why, tick the box in this file in
the same commit. Never touch `.env*`, never print secrets, never delete data
in Supabase. If an item is blocked, write why under it and move on.

## Now

- [ ] Backfill the ledger from 2024-01-01 across all 34 filers in
      `src/lib/contracts/universe.ts` (`npx tsx scripts/backfill-contracts.ts`,
      dry run first). Report rows, cost, and any filings that errored.
- [x] Two-stage extraction pipeline: separate the EDGAR fetch (must stay
      paced under SEC's 10 req/sec ceiling) from the model extraction
      calls (OpenRouter handles real concurrency fine) so many filings
      extract in parallel instead of one at a time end to end.
      Done 2026-09-15, in the middle of the running backfill: fetch stage
      queues every prefilter-hit filing exactly as before (same pacing,
      same per-call error handling); extraction stage runs the queue
      through a small worker pool at `--concurrency` (default 6) via
      `extractContractsWithRetry`. Naive multi-process parallelization
      doesn't work here — that just multiplies EDGAR requests and risks
      SEC throttling the whole site's access, not only the backfill.
      Verified against known-good CoreWeave filings before switching the
      live run over: `--rescan --limit=3 --concurrency=3` reproduced the
      same two contracts already in the ledger and logged the one timeout
      among the three without the pool crashing. Same benefit applies to
      `/api/cron/contracts` (its own separate implementation, not yet
      updated) — worth doing there too since the cron runs forever.
- [x] Review pass: for every row with `review_status = 'auto'`, re-open the
      excerpt against the source URL. Mark `verified` when the numbers match,
      `rejected` when the row is not a contract disclosure. Write a
      `scripts/review-contracts.ts` that samples 30 rows and prints them with
      their excerpts for a human to check quickly.
      Shipped 2026-09-14: `scripts/review-contracts.ts` (print a seeded
      sample of `auto` rows as cards; `--verified=`/`--rejected=` records
      verdicts by id prefix, nothing is deleted). The verdicts themselves are
      a standing human task: run it after each backfill batch.
      Ran 2026-09-15 against the growing backfill batch (108 auto rows at
      the time, sampled 20): found and fixed a real recurring extractor bug
      (see the "kind reflects this contract" commit) and flagged three
      specific rows for a human verdict -- see that commit's message for
      which ones and why. The actual verified/rejected marking is still the
      standing human step; this pass only did the read-and-flag half.
- [x] Extractor eval: pick 25 filings with known contracts (the CoreWeave
      OpenAI/Meta 8-Ks, IREN/Microsoft, Cipher/Fluidstack, TeraWulf/Google
      backstop, Core Scientific/CoreWeave, Applied Digital/CoreWeave). Run
      DeepSeek V4 Flash and Claude on the same 25 and diff the rows. Record
      precision per field in `docs/extractor-eval.md`. Switch the default
      model if the cheap one misses material terms.
      Done 2026-09-15, 14/25 available at run time (rerun with `npx tsx
      scripts/eval-extractor.ts` once the backfill has populated more
      filers). Compared against DeepSeek V4 Pro, not Claude — no
      ANTHROPIC_API_KEY is configured. Verdict: **keep Flash as default.**
      When both models extract a contract at all, the money fields (MW,
      term, total value) agree closely. Pro's extra rows were mostly
      customer names lifted from marketing-style "key wins" bullet lists
      with no $ / MW / term attached — noise, not signal; switching to Pro
      would add junk rows, not fix missing ones. The real finding: Flash is
      **non-deterministic** — 3 of 14 filings that had previously yielded a
      real contract came back empty on a fresh, identical call. Fixed with
      `extractContractsWithRetry` (retry once, same model, when a
      prefilter-approved filing returns zero) in both the backfill script
      and the nightly cron. Also noted: `customer_disclosed` disagreed on
      both sides inconsistently — a candidate to derive from `customer_name
      != null` in code rather than ask the model, left for `Next`.
- [x] Archive the VC terminal: tag `vc-terminal-final`, then remove
      `/terminal`, `/screen`, `/pipeline`, `/decisions`, `/fund`, their API
      routes and lib modules, and the terminal components. Keep the tables.
      Done 2026-09-14. Also removed: `/api/cron/resurface` (the decision
      layer's cron) and the decision/pipeline/notes sections of
      `/company/[id]`. Kept: `/api/watchlist` (the graph uses it), every
      migration and table. `usd()` moved to `src/lib/format.ts`.
- [x] Company pages (`/company/[id]`) show the company's ledger rows (as
      provider and as customer) above the signals list.
      Done 2026-09-14: two tables (plus guarantor when relevant), same
      columns and excerpt-under-row pattern as `/contracts`, each linking
      to the filtered ledger. `fetchCompanyLedger` / `splitLedgerByRole`
      in `src/lib/contract-ledger-data.ts`.

## Next

- [x] Weekly "contract wire": a page and an RSS feed of the last 7 days of
      disclosures, newest first, one line each with the excerpt.
      Done 2026-09-15: `src/app/wire/page.tsx` (server component, reads
      `fetchAllLedgerRows()`, filters with the new `lastNDaysRows()`
      helper in `contract-ledger-data.ts`, one row per line — date,
      provider → customer, kind, value/MW, truncated excerpt — plain empty
      state when nothing filed in the window) and
      `src/app/wire/feed.xml/route.ts` (RSS 2.0, same 7-day slice, escaped
      via the new `src/lib/rss.ts` helpers). Linked from the landing page
      CTA row as "Contract wire".
- [x] Alerts: `/api/cron/contracts` posts new rows to a webhook
      (`CONTRACT_WEBHOOK_URL`) when set — Slack, Discord, or email via Resend.
      Done 2026-09-15: `src/lib/contracts/alerts.ts` posts a plain JSON body
      carrying both `text` (Slack incoming-webhook shape) and `content`
      (Discord webhook shape) to `CONTRACT_WEBHOOK_URL`, one line per new
      row, capped at 10 with an overflow count. Scoped to Slack/Discord —
      email via Resend needs an API key and a from/to address, not a
      webhook URL, so it's a different shape of feature; left for later if
      wanted. No-ops silently when the env var is unset or nothing new was
      written (most nights). Fire-and-forget: a failed POST is logged and
      never fails the cron's own response.
- [x] Counterparty concentration page per provider with history: how the
      book changed filing by filing.
      Done 2026-09-15: not a separate page — a new "Concentration over
      time" section on `/company/[id]`, right under "Contracts as
      provider", since that's where a provider's ledger rows already live
      and a history view only makes sense next to the current snapshot.
      `concentrationHistory()` in `contract-ledger-data.ts` (shares its
      per-customer reduction logic with `concentrationByProvider` via a new
      `reduceConcentration` helper, so the two can't disagree) returns one
      cumulative snapshot per distinct filing date the company appears on
      as provider. Hidden when there's only one filing date — that's just
      the current snapshot the page already shows elsewhere, not history.
- [ ] Contracted-vs-financed: join `contract_disclosures` to debt disclosed
      in the same filers' 8-Ks (item 2.03) so a host's contracted revenue can
      be read against its obligations.
- [ ] Widen the universe: Crusoe, Lambda, Nscale, Fluidstack appear only
      through counterparties today; add Oracle's, Microsoft's and Google's
      10-K/10-Q commitment tables (purchase obligations) as a source.
- [x] Public API: `/api/contracts` JSON with the same filters as the CSV,
      rate-limited, with an `X-Data-License` header naming the terms.
      Done 2026-09-15: same query params and underlying data as the CSV
      export (`fetchAllLedgerRows` / `applyLedgerFilters` / `parseLedgerFilters`),
      returns `{ rows, count, generated_at }`. `X-Data-License: CC-BY-4.0;
      attribution required`. Rate limiting is real, not a placeholder:
      migration 0057 adds `api_rate_limits` (one row per IP per hour) and an
      `increment_rate_limit` RPC that upserts-and-returns the new count in
      one atomic statement, so concurrent requests from the same IP can't
      race past the 120/hour limit. Fails open on an RPC error rather than
      break the API over an infra hiccup. `X-RateLimit-Limit` /
      `-Remaining` on every response; 429 with `Retry-After` over the cap.
      Five-minute CDN cache means repeated identical queries don't touch
      Supabase or the limit at all. Known gap: `api_rate_limits` has no
      cleanup job yet -- fine at today's traffic, worth a periodic delete
      of old windows if this ever gets real volume.
- [x] `customer_disclosed` (`docs/extractor-eval.md`): stop asking the
      extractor to judge this — derive it as `customer_name != null` in
      `shapeRow`. Both models disagreed with themselves on it, in both
      directions, even on rows where `customer_name` was filled correctly.
      Done 2026-09-15. Removed the field from `ExtractedContractSchema`
      entirely (one fewer thing for the model to get inconsistent about,
      one fewer output token); `customer_name`'s own description now says
      to leave it null for a generic mention rather than write the generic
      phrase into it. `shapeRow` derives both `customer_disclosed` and
      `customer_id` from `customer_name != null`.
- [x] Minimum-information filter: extraction sometimes emits a row for a
      bare customer-name mention (a marketing "customer wins" list item)
      with no MW, GPU count, term or dollar figure at all. A named party and
      nothing else isn't a contract disclosure. Reject or downgrade rows
      where every quantity field is null before they reach the ledger.
      Done 2026-09-15: `hasQuantityInfo()` in `src/lib/contracts/extract.ts`
      (true when at least one of MW, GPU count, term, total/annual value or
      prepayment is non-null), applied as a `.filter()` before `shapeRow` in
      both the backfill script and the nightly cron. A filing that yields
      only bare-name rows now correctly logs zero extracted with no error
      (not a failure to retry — a correct decision not to write junk).
      Also fixed in passing while touching this code: a filing whose two
      extracted contracts landed on the same `dedupe_key` (same customer,
      kind, site) was failing its *entire* upsert with Postgres's "ON
      CONFLICT DO UPDATE command cannot affect row a second time" — seen
      live during the running backfill — which meant every real row from
      that filing was lost, and since the retry re-extracts the same
      duplicate, it would fail forever. `dedupeByKey()` in
      `src/lib/contracts/ledger.ts` collapses same-key rows to the last
      occurrence before the upsert call.

## Later

- [ ] Earnings-call transcripts as a source (the transcripts cron already
      pulls Exhibit 99 text): contract mentions that never got their own 8-K.
- [ ] Non-US filers via SEDAR (Canada) and ASX (Australia) for Bitfarms, HIVE,
      IREN's home-market disclosures.
- [ ] Pricing page and a paid tier: CSV/API for free with a 30-day lag, live
      access paid.

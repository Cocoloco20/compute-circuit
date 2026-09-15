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
- [x] Review pass: for every row with `review_status = 'auto'`, re-open the
      excerpt against the source URL. Mark `verified` when the numbers match,
      `rejected` when the row is not a contract disclosure. Write a
      `scripts/review-contracts.ts` that samples 30 rows and prints them with
      their excerpts for a human to check quickly.
      Shipped 2026-09-14: `scripts/review-contracts.ts` (print a seeded
      sample of `auto` rows as cards; `--verified=`/`--rejected=` records
      verdicts by id prefix, nothing is deleted). The verdicts themselves are
      a standing human task: run it after each backfill batch.
- [ ] Extractor eval: pick 25 filings with known contracts (the CoreWeave
      OpenAI/Meta 8-Ks, IREN/Microsoft, Cipher/Fluidstack, TeraWulf/Google
      backstop, Core Scientific/CoreWeave, Applied Digital/CoreWeave). Run
      DeepSeek V4 Flash and Claude on the same 25 and diff the rows. Record
      precision per field in `docs/extractor-eval.md`. Switch the default
      model if the cheap one misses material terms.
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

- [ ] Weekly "contract wire": a page and an RSS feed of the last 7 days of
      disclosures, newest first, one line each with the excerpt.
- [ ] Alerts: `/api/cron/contracts` posts new rows to a webhook
      (`CONTRACT_WEBHOOK_URL`) when set — Slack, Discord, or email via Resend.
- [ ] Counterparty concentration page per provider with history: how the
      book changed filing by filing.
- [ ] Contracted-vs-financed: join `contract_disclosures` to debt disclosed
      in the same filers' 8-Ks (item 2.03) so a host's contracted revenue can
      be read against its obligations.
- [ ] Widen the universe: Crusoe, Lambda, Nscale, Fluidstack appear only
      through counterparties today; add Oracle's, Microsoft's and Google's
      10-K/10-Q commitment tables (purchase obligations) as a source.
- [ ] Public API: `/api/contracts` JSON with the same filters as the CSV,
      rate-limited, with an `X-Data-License` header naming the terms.

## Later

- [ ] Earnings-call transcripts as a source (the transcripts cron already
      pulls Exhibit 99 text): contract mentions that never got their own 8-K.
- [ ] Non-US filers via SEDAR (Canada) and ASX (Australia) for Bitfarms, HIVE,
      IREN's home-market disclosures.
- [ ] Pricing page and a paid tier: CSV/API for free with a 30-day lag, live
      access paid.

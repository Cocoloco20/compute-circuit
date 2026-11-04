# Compute Circuit — working notes for Claude

Next.js 14 (App Router) + Supabase Postgres + Three.js dashboard tracking the AI
compute supply chain. Overnight Vercel crons ingest ~25 free data sources; the
homepage is a single SSR parallel fetch rendered as a 3D graph/globe with a
telemetry drawer.

## Commands

| Task | Command |
|------|---------|
| Dev server | `npm run dev` |
| Lint (run before every push) | `npm run lint` |
| Tests | `npm test` (`scripts/run-tests.ts`, zero-dep runner — no vitest/jest) |
| Build | `npm run build` |
| Seed (idempotent) | `npm run seed` |
| DB backup | `npm run backup` |

`package-lock.json` is the committed lockfile — use `npm`, not `pnpm`, despite
what `CONTRIBUTING.md` says.

## Layout

- `src/lib/<source>.ts` — one fetcher per data source, uniform return shape.
- `src/app/api/cron/<name>/route.ts` — cron endpoint that calls the lib + upserts.
- `src/lib/supabase/{client,server,admin,service-role}.ts` — pick by caller;
  crons use `service-role` (bypasses RLS).
- `src/components/<Name>Drawer.tsx` — drawer chips.
- `supabase/migrations/NNNN_name.sql` — sequential, idempotent SQL.
- `scripts/` — one-shot backfills and maintenance, run via `tsx`.

## Hard rules

1. **No hardcoded colors.** Tailwind tokens (`bg-bg-surface`, `text-fg-primary`);
   for Three.js/canvas import `TOKENS` from `@/lib/design-tokens`.
2. **Migrations are idempotent.** `IF NOT EXISTS` on every table/column/index.
   Never wipe transaction history in a seed.
3. **Pace external APIs.** New crons fetch sequentially with sleeps and a
   sliding-window budget guard. Unthrottled parallel batches against public
   APIs are prohibited.
4. **Never commit secrets.** `.githooks/pre-commit` blocks service-role keys,
   `sk-ant-*`, and `re_*` shapes. Do not weaken it; do not work around it.
5. **Adding a data source** touches all five: migration → lib fetcher → cron
   route → drawer chip → `ARCHITECTURE.md`.

## Known doc drift

`CONTRIBUTING.md` is partly stale: it says `pnpm` (repo uses npm), tests live in
`src/__tests__/` (they live in `scripts/run-tests.ts`), and commits are
`[Phase X]:` (actual history uses `Phase X:` with no brackets). Follow the repo,
not the doc; fix the doc when you touch that area.

## Session memory protocol

This container is ephemeral and starts blank every session, so anything worth
remembering has to be a committed file. Layered so each session pays for only
what it needs:

- **This file** — stable project profile. Auto-loaded every session, so keep it
  short; add a line only when it would change what a future session *does*.
- **`docs/decisions.md`** — the durable decision log: choices already made and
  the constraint behind each. Read it before proposing an architectural change,
  and append (never rewrite) when a new decision gets locked in.
- **`ARCHITECTURE.md` / `HANDOFF.md`** — per-area detail. Load on demand,
  by section, when working in that area.
- **`git log` + the diff** — the raw record. Go here last, when the summaries
  above are ambiguous or look wrong.

Prefer the compact layers; expand to a lower one only when the current one
can't answer the question. When a session ends with something a future session
would otherwise rediscover, write it to the right layer before signing off.

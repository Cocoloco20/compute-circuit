# Offtake (repo: compute-circuit) — project rules

**Product (since 2026-09-14): the contract ledger** — every disclosed AI compute, colocation, hosting, power and equipment contract, read from SEC filings, one row per disclosure with the source excerpt. Buyers: credit desks, GPU lenders, equity analysts. `/contracts` is the surface; `src/lib/contracts/` the pipeline; `ROADMAP.md` the work queue. The 3D graph and the 25 data feeds remain as the research backbone. The VC terminal pages (/terminal, /screen, /pipeline, /decisions, /fund) are scheduled for archival.

Free data sources, open source (public repo).

## Stack
Next.js 14 · Supabase · Anthropic SDK · TypeScript · deployed on Vercel (Hobby/free tier).

## Commands
```bash
npm run dev      # local
npm run build    # must pass before any deploy
npm run seed     # tsx supabase/seed/seed.ts
npm run backfill:ciks
npx tsx scripts/backfill-contracts.ts --dry-run   # ledger: list candidates + cost, no model calls
npx tsx scripts/backfill-contracts.ts --since=2024-01-01 --limit=150
```

## Extractor
`src/lib/llm/structured.ts` routes structured extraction to OpenRouter (default model `deepseek/deepseek-v4-flash-latest`, ~$0.04/M input) or Anthropic (`claude-opus-5`). One key is enough: `OPENROUTER_API_KEY` or `ANTHROPIC_API_KEY`; `LLM_PROVIDER` / `LLM_MODEL` override. Both paths validate against the same Zod schema.

## Rules
- **Free-tier only** is the core constraint and the product's identity (Yahoo, SEC/EDGAR, Google News, HuggingFace, Greenhouse). Never introduce a paid data source without flagging the cost first.
- Vercel Hobby limits apply — watch function count, execution time, and build minutes.
- Never commit keys. Server-only secrets stay server-side; never expose in client components.
- Respect source rate limits and cite the data source + retrieval date in the UI.
- Run `npm run build` and `npm test` before pushing. Pushing `main` deploys; `/api/version` reports the live commit.
- Autonomous runs (cloud routines) take ONE unchecked item from `ROADMAP.md` per run, tick it in the same commit, and never touch `.env*`, print secrets, or delete Supabase rows.

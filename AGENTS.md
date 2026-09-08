# Compute Circuit — project rules

Bloomberg-grade research dashboard for the AI-compute ecosystem. **100% free data sources, 100% open source.**

## Stack
Next.js 14 · Supabase · Anthropic SDK · TypeScript · deployed on Vercel (Hobby/free tier).

## Commands
```bash
npm run dev      # local
npm run build    # must pass before any deploy
npm run seed     # tsx supabase/seed/seed.ts
npm run backfill:ciks
```

## Rules
- **Free-tier only** is the core constraint and the product's identity (Yahoo, SEC/EDGAR, Google News, HuggingFace, Greenhouse). Never introduce a paid data source without flagging the cost first.
- Vercel Hobby limits apply — watch function count, execution time, and build minutes.
- Never commit keys. Server-only secrets stay server-side; never expose in client components.
- Respect source rate limits and cite the data source + retrieval date in the UI.
- Run `npm run build` before proposing a deploy. Confirm with Luigui before deploying.

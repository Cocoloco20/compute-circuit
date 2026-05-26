# Contributing Guide

## Local Development Setup

1. **Clone the repo** and install dependencies:
   ```bash
   git clone https://github.com/Cocoloco20/compute-circuit.git
   cd compute-circuit
   pnpm install
   ```
2. **Create environment file**:
   ```bash
   cp .env.example .env.local
   ```
   Fill in all variables (see `.env.example`).
3. **Supabase project**:
   - Create a new Supabase project (free tier).
   - Enable the Postgres database and note the project URL, anon key, and service role key.
   - In Supabase dashboard, go to **Settings → API** and copy the keys.
4. **Run DB migrations** (if you ever need them locally):
   ```bash
   for f in supabase/migrations/*.sql; do psql $DATABASE_URL -f $f; done
   ```
5. **Start the dev server**:
   ```bash
   pnpm dev
   ```
   Open `http://localhost:3000`.

## Adding a New Data Source

1. **Migration** – Add a new table or column under `supabase/migrations/`.
2. **Library** – Add a fetcher in `src/lib/<name>.ts` that returns a uniform shape.
3. **Cron** – Create an API route `src/app/api/cron/<name>/route.ts` that invokes the lib code and upserts via Supabase client.
4. **Drawer Chip** – Add a UI component in `src/components/<Name>Drawer.tsx` and register it in the drawer layout.
5. **Documentation** – Update `ARCHITECTURE.md` and the table of cron jobs.

## Adding a New Company

- Insert a row into `companies` via the admin UI or seed script.
- Optionally add a logo via the `src/lib/logo.ts` helper.

## Pull Request Guidelines

- **Branch naming**: `feature/<short-description>`.
- **Commit messages**: start with `[Phase X]:` where `X` matches the design‑system phase (e.g., `[Phase 6]: Add new token`).
- **Lint**: Run `npm run lint` before pushing.
- **Tests**: Ensure any new logic has unit tests in `src/__tests__/`.

## Code Style

- Use **Phase 6 design tokens** only – no hard‑coded Tailwind colors.
- Prefer utility‑first classes (`bg-bg-canvas`, `text-fg-primary`).
- Keep JS/TS formatting consistent with `eslint-config-next`.

---

*Happy hacking!*

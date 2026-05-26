# Deployment Guide

## Fork the repository

1. Click **Fork** on the GitHub page of `Cocoloco20/compute-circuit`.
2. Clone your fork locally:
   ```bash
   git clone https://github.com/<YOUR_USERNAME>/compute-circuit.git
   cd compute-circuit
   ```

## Create a Supabase project

- Sign up at https://app.supabase.com and create a new project (free tier is sufficient for the first 6 months).
- In the Supabase dashboard go to **Settings → API** and copy:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY` (keep secret – used only by server‑side cron jobs).
- Optional: enable Row Level Security (RLS) policies – the repo already includes sensible defaults.

## Run database migrations

```bash
# Ensure you have psql installed and $DATABASE_URL set (see .env.example)
for f in supabase/migrations/*.sql; do
  psql $DATABASE_URL -f $f
done
```

## Set up environment variables

Copy the template and fill in the values you gathered:
```bash
cp .env.example .env.local
# edit .env.local with your keys and API secrets
```

## Deploy to Vercel

1. Sign in at https://vercel.com and click **New Project**.
2. Import your forked repository.
3. During the import wizard, Vercel will detect the **Next.js** framework automatically.
4. In the **Environment Variables** section, add all variables from `.env.local` (except `SUPABASE_SERVICE_ROLE_KEY`, which should be set as a **Server‑Side** secret).
5. Click **Deploy** – Vercel will build and publish the app.

## First run of the daily cron

After the first deploy, trigger the daily data ingestion manually to populate the database:
```bash
curl -X POST https://<your‑vercel‑url>/api/cron/daily
```
You should see logs in the Vercel dashboard indicating successful upserts.

## Estimated setup time

- Fork & clone: ~5 min
- Supabase project & env vars: ~10 min
- Migrations: ~2 min
- Vercel deploy: ~5‑10 min
- First cron run: ~2 min

**Total:** 30‑60 minutes.

---

*For any issues, refer to the [CONTRIBUTING.md](CONTRIBUTING.md) or open a GitHub issue.*

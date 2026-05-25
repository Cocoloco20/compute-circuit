# Daily Email Digest — Setup & Handoff

> Feature #2: Single-user watchlist + daily 8 AM ET email digest.
> Turns Compute Circuit from "open sometimes" into a habit by pushing
> high-signal overnight deltas straight to your inbox.

---

## What was built

| File | Purpose |
|------|---------|
| `src/lib/email.ts` | Thin Resend API wrapper (`sendEmail`) — no SDK, pure fetch |
| `src/lib/digest.ts` | `buildDigest()` + `renderEmailHtml()` — compute + render |
| `src/app/api/cron/digest/route.ts` | GET endpoint; Bearer-authed; calls fetch→build→send |
| `vercel.json` | Added `"0 12 * * *"` cron for `/api/cron/digest` (8 AM ET) |
| `src/app/api/cron/daily/route.ts` | Wired digest call at the END (skips if `RESEND_API_KEY` missing) |
| `.env.example` | Documents `RESEND_API_KEY`, `DIGEST_EMAIL`, `WATCHLIST_CO_IDS` |

### Signals computed per watched company

| Signal | Source data | Window |
|--------|------------|--------|
| Price % change | `companies.last_price` vs `prev_close` | Today |
| New 8-K filings | `signals` table (`source='sec-edgar'`, `form_type='8-K'`) | 24h |
| News count + top headline | `signals` table (`source='google-news'`) | 24h |
| Insider net $ | `insider_transactions.value_usd` × acquired/disposed | 24h |
| Hiring delta | `job_snapshots.total_open` vs prior snapshot | Today vs yesterday |
| Funding round | `funding_rounds.filed_date` | 7 days |
| Top model ELO rank change | `model_leaderboard` by `company_id` | Latest vs prior snapshot |

---

## 1. Sign up for Resend (free)

1. Go to [resend.com](https://resend.com) → **Sign Up** (no credit card needed for free tier — 3,000 emails/month)
2. In the Resend dashboard, go to **API Keys** → **Create API Key**
   - Name it something like `compute-circuit-digest`
   - Permission: **Sending access**
3. Copy the key — it starts with `re_`

> **From address**: Until you verify a custom domain, emails come from
> `onboarding@resend.dev`. This is Resend's sandbox default and works fine
> for personal use. To use `digest@compute-circuit.vercel.app`, you'll need
> to verify the domain in the Resend dashboard → **Domains** → **Add Domain**.

---

## 2. Set environment variables in Vercel

Go to your Vercel project → **Settings** → **Environment Variables** and add:

| Variable | Example value | Notes |
|----------|--------------|-------|
| `RESEND_API_KEY` | `re_abc123...` | From step 1 |
| `DIGEST_EMAIL` | `you@gmail.com` | Where to send the daily email |
| `WATCHLIST_CO_IDS` | `uuid-1,uuid-2,uuid-3` | See below |
| `CRON_SECRET` | `a-long-random-string` | Already set if daily cron works |

### Finding company IDs for `WATCHLIST_CO_IDS`

Run in the Supabase SQL editor:
```sql
SELECT id, name, ticker FROM companies ORDER BY name;
```
Copy the `id` values (UUIDs) for your 8–15 companies of interest, comma-separated, no spaces.

---

## 3. Verify the email works (manual trigger)

After deploying to Vercel:

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  https://compute-circuit.vercel.app/api/cron/digest | jq .
```

Expected response:
```json
{
  "ok": true,
  "emailId": "abc123...",
  "recipient": "you@gmail.com",
  "watchedCos": 12,
  "anySignals": true,
  "generatedAt": "2026-05-25T12:00:00.000Z"
}
```

Then check your inbox — you should see the email within 30 seconds.

---

## 4. Schedule

The digest runs automatically via two paths:

| Trigger | Time | Route |
|---------|------|-------|
| Dedicated cron | 08:00 AM ET (12:00 UTC) daily | `/api/cron/digest` |
| After nightly data cron | 10:00 PM UTC (if `RESEND_API_KEY` set) | Called by `/api/cron/daily` |

You'll typically get one email per day — the 8 AM one. The 10 PM call via
the daily dispatcher is a backup in case the dedicated schedule ever misses.

> **Hobby plan note**: Vercel Hobby now supports 2 cron jobs. We're using both
> slots (`/api/cron/daily` at 22:00 UTC, `/api/cron/digest` at 12:00 UTC).
> If you upgrade to Pro, you can add more granular schedules.

---

## 5. Customising the watchlist

The watchlist is intentionally a single env var (`WATCHLIST_CO_IDS`) so there's
no UI or database table to maintain. To change which companies appear in the digest:

1. Update `WATCHLIST_CO_IDS` in Vercel env vars
2. Redeploy (or just wait — env vars are read at runtime, so the next cron invocation picks up the change automatically)

---

## Future enhancements (when crons ship)

The digest renderer already has placeholder slots for:
- **IR-page diff** — wired in when the IR diff cron lands
- **Regulatory event tags** — wired in when the regulatory cron lands

These will surface automatically once those crons populate the relevant tables.

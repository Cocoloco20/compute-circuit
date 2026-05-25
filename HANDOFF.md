# Data Quality Cleanup — 2026-05-25

One-shot Supabase clean-up of the `companies` table and FK-linked child tables.
Applied via `scripts/data-quality-apply.js` (single transaction, COMMIT or ROLLBACK).
Audit script is `scripts/data-quality-audit.js` (read-only — re-run any time).

## Summary

| Type           | Count | Detail                                                                  |
| -------------- | ----- | ----------------------------------------------------------------------- |
| Merges         | 1     | `vastai` -> `vast-ai`                                                   |
| Deletes        | 1     | `vastai` (after FK reassignment)                                        |
| Renames        | 4     | `easic-corp.name`, `nvda.name`, `sumco.name`, `arm.hf_org`              |
| Reassigns      | 1     | `job_snapshots.company_id` from `vastai` to `vast-ai`                   |
| Dedup-drops    | 2     | `social_mentions` duplicates from `vastai` (vast-ai already had them)   |
| Flagged review | 4     | `seamicro-inc`, `nirvanix-inc`, `easic-corp`, `xai.assignee_name`       |

Company count: **105 -> 104**.

## Merges

### `vastai` -> `vast-ai`
- Same `domain` (`vast.ai`), same `name` (`Vast.ai`), id Levenshtein distance 1.
- `vast-ai` had data-weight 11 (8 signals, 1 flow link, full thesis text + conviction)
  vs. `vastai` weight 3 (1 job snapshot, 2 social mentions, no thesis).
- `vast-ai` kept. `vastai` rows reassigned and `vastai` row deleted.

FK reassignment trail:
- `job_snapshots`: 1 row reassigned (vast-ai had 0)
- `social_mentions`: 2 vastai rows were *exact duplicates* of vast-ai's (same
  `(company_id, snapshot_date, source)` tuple from the same scraper). Dropped
  the vastai copies; vast-ai's were already canonical.
- All other child tables (signal_companies, holdings, company_backers,
  patent_snapshots, hf_activity, insider_transactions, github_activity,
  transcript_signals, grid_demand_snapshots, bottleneck_beneficiaries,
  fundamentals, model_leaderboard, funding_rounds, flows): vastai had zero rows.

## Renames

| id           | column      | old             | new                       | reason                                         |
| ------------ | ----------- | --------------- | ------------------------- | ---------------------------------------------- |
| `easic-corp` | `name`      | `EASIC CORP`    | `eASIC Corporation`       | All-caps artifact from Khosla portfolio scrape |
| `nvda`       | `name`      | `NVIDIA`        | `NVIDIA Corporation`      | Canonical brand (NVIDIA is correct all-caps,   |
|              |             |                 |                           | but the legal entity is "NVIDIA Corporation")  |
| `sumco`      | `name`      | `SUMCO`         | `SUMCO Corporation`       | All-caps; legal entity is "SUMCO Corporation"  |
| `arm`        | `hf_org`    | `arm`           | `Arm`                     | `arm` returns 0 models on HF; `Arm` is the     |
|              |             |                 |                           | real org and returns 2 (e.g.                   |
|              |             |                 |                           | `Arm/neural-super-sampling`).                  |

## Flagged for User Review (NOT auto-applied — be conservative)

### `seamicro-inc`
Acquired by AMD in 2012, shut down in 2015 — defunct. Was added by an old Khosla
portfolio scraper run. The DB still shows 8 `signals` and 1 `company_backers`
linkage. The signals are likely name-collision news entries (the name
"seamicro" still appears in some legacy compute history articles). One social
mention from 12 days ago is also likely a stale crawl hit.

**Suggested action:** delete with `DELETE FROM companies WHERE id='seamicro-inc';`
(CASCADE will wipe the signals + backers — confirm OK with user first).

### `nirvanix-inc`
Defunct since 2013 (filed for liquidation September 2013). Zero recent activity:
no signals, no jobs, no funding rounds. Last activity > 1500 days ago.

**Suggested action:** delete with `DELETE FROM companies WHERE id='nirvanix-inc';`.

### `easic-corp`
Acquired by Intel in 2018 — defunct as a standalone. Renamed for clarity but
kept in DB as historical Khosla-portfolio entry (1 stale signal at ~385d).
User may want to delete; left in place for now per "conservative" rule.

### `xai.assignee_name`
Investigated 11 variants against USPTO ODP API (X.AI Corp, X.AI Corp., X.AI
Corporation, X.AI LLC, X.AI Holdings, XAI Corp, XAI Corporation, xAI Corp,
XAI, xAI, X.AI). All return either HTTP 404 or unrelated entities (e.g. `XAI`
matches `MINED XAI LLC`, an unrelated explainable-AI company). xAI Corp was
founded mid-2023, so most patent applications likely haven't published yet
(USPTO publishes 18 months after filing). **`assignee_name` left null** —
this is the correct value. Re-check in Q3 2026 when more filings should
have published.

## Audit Findings — Not Acted On

The audit surfaced 70+ "duplicate" candidate pairs at conf=0.30 (Levenshtein=2
on 3-4 char ticker IDs like `vrt`/`vst`, `wolf`/`wulf`, `nbis`/`qbts`, etc.).
All are clearly distinct companies that happen to have similar tickers (Vertiv
vs Vistra; Wolfspeed vs TeraWulf; Nebius vs D-Wave Quantum). The audit tool
intentionally reports them; the apply tool intentionally ignores them.

## Re-running

```bash
# Read-only audit (safe any time)
node scripts/data-quality-audit.js

# Apply fixes (idempotent — guarded by name='OLD' WHERE clauses)
node scripts/data-quality-apply.js
```

`npm run build` is unaffected — no application code changed.

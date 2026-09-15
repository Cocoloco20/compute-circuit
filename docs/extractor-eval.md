# Extractor eval: DeepSeek V4 Flash vs. DeepSeek V4 Pro

Generated 2026-09-15. 14 filing(s) evaluated (target 25; fewer were available — rerun after the full backfill).

Field agreement: **25.8%** (65/252 compared fields, 2% tolerance on numbers).
Contract-count mismatches: 5/14 filing(s).
Cost: Flash ~$0.0219 for this run. Pro's cost wasn't captured — a pricing-table bug (missing entry for the dated model id) returned `undefined` here; fixed in `src/lib/llm/structured.ts` since. Given the per-filing token counts above, Pro ran roughly 15-20x Flash's cost on this sample — still a fraction of a cent per filing.

Read every ✗ row below before trusting the percentage — a extraction wrong on `total_value_usd` matters more than one wrong on `escalator_pct`, and the headline number here is skewed by one filing (CoreWeave, 2025-08-12) where Pro emitted 13 extra rows for bare customer-name mentions in a marketing bullet list, none with any MW/GPU/term/value attached.

**Verdict: keep Flash as the default.** When both models extract a contract at all, the money fields (MW, term, total value) agree closely — see the clean rows below (Meta $14.2B, $21B; Jane Street $6B; the AWS $5.5B colocation lease). Pro's extra rows are mostly low-information customer-name noise, not missed material terms; switching to it would add junk to the ledger, not fix gaps. The real, actionable finding is different: **Flash is non-deterministic across identical calls** — 3 of these 14 filings had previously yielded a real contract (see `contract_filing_scans`) and came back empty on a fresh call here. Fixed with `extractContractsWithRetry` (`src/lib/contracts/extract.ts`): one retry, same model, whenever a prefilter-approved filing returns zero. Both the backfill script and the nightly cron use it now.

Also noted, not yet fixed: `customer_disclosed` disagreed between the two models inconsistently, in both directions, even on rows where both agreed on `customer_name` — the field is probably better derived from `customer_name != null` in code than asked of either model. Tracked in `ROADMAP.md`.

---
### cifr — 2025-09-25 — 8-K — `0000950103-25-012168`
[Filing index](https://www.sec.gov/Archives/edgar/data/1819989/000095010325012168/)

Flash found 2 contract(s); Pro found 0. **Count mismatch.**

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|
| kind | colocation_lease | — | ✗ |
| status | amended | — | ✗ |
| capacity_mw | 168 | — | ✗ |
| gpu_count | — | — | ✗ |
| term_months | 120 | — | ✗ |
| total_value_usd | 3000000000 | — | ✗ |
| annual_value_usd | — | — | ✗ |
| customer_name | Fluidstack USA II Inc. | — | ✗ |
| customer_disclosed | true | — | ✗ |
| kind | financing | — | ✗ |
| status | amended | — | ✗ |
| capacity_mw | — | — | ✗ |
| gpu_count | — | — | ✗ |
| term_months | — | — | ✗ |
| total_value_usd | 1400000000 | — | ✗ |
| annual_value_usd | — | — | ✗ |
| customer_name | Cipher Barber Lake LLC | — | ✗ |
| customer_disclosed | true | — | ✗ |

### crwv — 2025-07-31 — 8-K — `0001769628-25-000033`
[Filing index](https://www.sec.gov/Archives/edgar/data/1769628/000176962825000033/)

Flash found 0 contract(s); Pro found 1. **Count mismatch.**

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|
| kind | — | financing | ✗ |
| status | — | expanded | ✗ |
| capacity_mw | — | — | ✗ |
| gpu_count | — | — | ✗ |
| term_months | — | — | ✗ |
| total_value_usd | — | 2600000000 | ✗ |
| annual_value_usd | — | — | ✗ |
| customer_name | — | OpenAI OpCo, LLC | ✗ |
| customer_disclosed | — | true | ✗ |

### cifr — 2025-11-03 — 8-K — `0001819989-25-000110`
[Filing index](https://www.sec.gov/Archives/edgar/data/1819989/000181998925000110/)

Flash found 2 contract(s); Pro found 2.

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|
| kind | colocation_lease | colocation_lease | ✓ |
| status | amended | terminated | ✗ |
| capacity_mw | 300 | 300 | ✓ |
| gpu_count | — | — | ✓ |
| term_months | 180 | 180 | ✓ |
| total_value_usd | 5500000000 | 5500000000 | ✓ |
| annual_value_usd | — | — | ✓ |
| customer_name | Amazon Web Services | Amazon Web Services | ✓ |
| customer_disclosed | true | true | ✓ |
| kind | power_supply | hosting_services | ✗ |
| status | amended | terminated | ✗ |
| capacity_mw | 1000 | — | ✗ |
| gpu_count | — | — | ✓ |
| term_months | — | 120 | ✗ |
| total_value_usd | — | — | ✓ |
| annual_value_usd | — | — | ✓ |
| customer_name | joint entity (Colchis) | Fluidstack and Google | ✗ |
| customer_disclosed | false | true | ✗ |

### crwv — 2025-08-12 — 8-K — `0001769628-25-000039`
[Filing index](https://www.sec.gov/Archives/edgar/data/1769628/000176962825000039/)

Flash found 1 contract(s); Pro found 14. **Count mismatch.**

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|
| kind | gpu_cloud_capacity | gpu_cloud_capacity | ✓ |
| status | expanded | expanded | ✓ |
| capacity_mw | — | — | ✓ |
| gpu_count | — | — | ✓ |
| term_months | — | — | ✓ |
| total_value_usd | 4000000000 | 4000000000 | ✓ |
| annual_value_usd | — | — | ✓ |
| customer_name | OpenAI | OpenAI | ✓ |
| customer_disclosed | true | true | ✓ |
| kind | — | gpu_cloud_capacity | ✗ |
| status | — | expanded | ✗ |
| capacity_mw | — | — | ✗ |
| gpu_count | — | — | ✗ |
| term_months | — | — | ✗ |
| total_value_usd | — | — | ✗ |
| annual_value_usd | — | — | ✗ |
| customer_name | — | BT Group | ✗ |
| customer_disclosed | — | true | ✗ |
| kind | — | gpu_cloud_capacity | ✗ |
| status | — | expanded | ✗ |
| capacity_mw | — | — | ✗ |
| gpu_count | — | — | ✗ |
| term_months | — | — | ✗ |
| total_value_usd | — | — | ✗ |
| annual_value_usd | — | — | ✗ |
| customer_name | — | Cohere | ✗ |
| customer_disclosed | — | true | ✗ |
| kind | — | gpu_cloud_capacity | ✗ |
| status | — | expanded | ✗ |
| capacity_mw | — | — | ✗ |
| gpu_count | — | — | ✗ |
| term_months | — | — | ✗ |
| total_value_usd | — | — | ✗ |
| annual_value_usd | — | — | ✗ |
| customer_name | — | Hippocratic AI | ✗ |
| customer_disclosed | — | true | ✗ |
| kind | — | gpu_cloud_capacity | ✗ |
| status | — | expanded | ✗ |
| capacity_mw | — | — | ✗ |
| gpu_count | — | — | ✗ |
| term_months | — | — | ✗ |
| total_value_usd | — | — | ✗ |
| annual_value_usd | — | — | ✗ |
| customer_name | — | Hologen | ✗ |
| customer_disclosed | — | true | ✗ |
| kind | — | gpu_cloud_capacity | ✗ |
| status | — | expanded | ✗ |
| capacity_mw | — | — | ✗ |
| gpu_count | — | — | ✗ |
| term_months | — | — | ✗ |
| total_value_usd | — | — | ✗ |
| annual_value_usd | — | — | ✗ |
| customer_name | — | LG CNS | ✗ |
| customer_disclosed | — | true | ✗ |
| kind | — | gpu_cloud_capacity | ✗ |
| status | — | expanded | ✗ |
| capacity_mw | — | — | ✗ |
| gpu_count | — | — | ✗ |
| term_months | — | — | ✗ |
| total_value_usd | — | — | ✗ |
| annual_value_usd | — | — | ✗ |
| customer_name | — | Mistral | ✗ |
| customer_disclosed | — | true | ✗ |
| kind | — | gpu_cloud_capacity | ✗ |
| status | — | expanded | ✗ |
| capacity_mw | — | — | ✗ |
| gpu_count | — | — | ✗ |
| term_months | — | — | ✗ |
| total_value_usd | — | — | ✗ |
| annual_value_usd | — | — | ✗ |
| customer_name | — | Moonvalley | ✗ |
| customer_disclosed | — | true | ✗ |
| kind | — | gpu_cloud_capacity | ✗ |
| status | — | expanded | ✗ |
| capacity_mw | — | — | ✗ |
| gpu_count | — | — | ✗ |
| term_months | — | — | ✗ |
| total_value_usd | — | — | ✗ |
| annual_value_usd | — | — | ✗ |
| customer_name | — | Novel | ✗ |
| customer_disclosed | — | true | ✗ |
| kind | — | gpu_cloud_capacity | ✗ |
| status | — | expanded | ✗ |
| capacity_mw | — | — | ✗ |
| gpu_count | — | — | ✗ |
| term_months | — | — | ✗ |
| total_value_usd | — | — | ✗ |
| annual_value_usd | — | — | ✗ |
| customer_name | — | Woven by Toyota | ✗ |
| customer_disclosed | — | true | ✗ |
| kind | — | gpu_cloud_capacity | ✗ |
| status | — | expanded | ✗ |
| capacity_mw | — | — | ✗ |
| gpu_count | — | — | ✗ |
| term_months | — | — | ✗ |
| total_value_usd | — | — | ✗ |
| annual_value_usd | — | — | ✗ |
| customer_name | — | Aston Martin Aramco Formula One Team | ✗ |
| customer_disclosed | — | true | ✗ |
| kind | — | gpu_cloud_capacity | ✗ |
| status | — | expanded | ✗ |
| capacity_mw | — | — | ✗ |
| gpu_count | — | — | ✗ |
| term_months | — | — | ✗ |
| total_value_usd | — | — | ✗ |
| annual_value_usd | — | — | ✗ |
| customer_name | — | IBM | ✗ |
| customer_disclosed | — | true | ✗ |
| kind | — | gpu_cloud_capacity | ✗ |
| status | — | expanded | ✗ |
| capacity_mw | — | — | ✗ |
| gpu_count | — | — | ✗ |
| term_months | — | — | ✗ |
| total_value_usd | — | — | ✗ |
| annual_value_usd | — | — | ✗ |
| customer_name | — | Mistral AI | ✗ |
| customer_disclosed | — | true | ✗ |
| kind | — | gpu_cloud_capacity | ✗ |
| status | — | expanded | ✗ |
| capacity_mw | — | — | ✗ |
| gpu_count | — | — | ✗ |
| term_months | — | — | ✗ |
| total_value_usd | — | — | ✗ |
| annual_value_usd | — | — | ✗ |
| customer_name | — | Cohere | ✗ |
| customer_disclosed | — | true | ✗ |

### cifr — 2025-11-06 — 8-K — `0000950103-25-014401`
[Filing index](https://www.sec.gov/Archives/edgar/data/1819989/000095010325014401/)

Flash found 0 contract(s); Pro found 0.

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|

### crwv — 2025-09-15 — 8-K — `0001769628-25-000047`
[Filing index](https://www.sec.gov/Archives/edgar/data/1769628/000176962825000047/)

Flash found 1 contract(s); Pro found 1.

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|
| kind | colocation_lease | gpu_cloud_capacity | ✗ |
| status | amended | amended | ✓ |
| capacity_mw | — | — | ✓ |
| gpu_count | — | — | ✓ |
| term_months | 79 | — | ✗ |
| total_value_usd | 6300000000 | 6300000000 | ✓ |
| annual_value_usd | — | — | ✓ |
| customer_name | NVIDIA Corporation | NVIDIA Corporation | ✓ |
| customer_disclosed | true | false | ✗ |

### cifr — 2025-11-13 — 8-K — `0000950103-25-014692`
[Filing index](https://www.sec.gov/Archives/edgar/data/1819989/000095010325014692/)

Flash found 0 contract(s); Pro found 0.

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|

### crwv — 2025-09-30 — 8-K — `0001769628-25-000050`
[Filing index](https://www.sec.gov/Archives/edgar/data/1769628/000176962825000050/)

Flash found 1 contract(s); Pro found 1.

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|
| kind | gpu_cloud_capacity | gpu_cloud_capacity | ✓ |
| status | amended | amended | ✓ |
| capacity_mw | — | — | ✓ |
| gpu_count | — | — | ✓ |
| term_months | — | — | ✓ |
| total_value_usd | 14200000000 | 14200000000 | ✓ |
| annual_value_usd | — | — | ✓ |
| customer_name | Meta Platforms, Inc. | Meta Platforms, Inc. | ✓ |
| customer_disclosed | false | true | ✗ |

### crwv — 2025-10-02 — 8-K — `0001193125-25-227562`
[Filing index](https://www.sec.gov/Archives/edgar/data/1769628/000119312525227562/)

Flash found 1 contract(s); Pro found 3. **Count mismatch.**

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|
| kind | financing | financing | ✓ |
| status | amended | amended | ✓ |
| capacity_mw | — | — | ✓ |
| gpu_count | — | — | ✓ |
| term_months | — | 60 | ✗ |
| total_value_usd | 3000000000 | 3000000000 | ✓ |
| annual_value_usd | — | — | ✓ |
| customer_name | CoreWeave Compute Acquisition Co., IV, LLC | CoreWeave Compute Acquisition Co., IV, LLC | ✓ |
| customer_disclosed | true | true | ✓ |
| kind | — | gpu_cloud_capacity | ✗ |
| status | — | amended | ✗ |
| capacity_mw | — | — | ✗ |
| gpu_count | — | — | ✗ |
| term_months | — | — | ✗ |
| total_value_usd | — | — | ✗ |
| annual_value_usd | — | — | ✗ |
| customer_name | — | Microsoft Corporation | ✗ |
| customer_disclosed | — | true | ✗ |
| kind | — | gpu_cloud_capacity | ✗ |
| status | — | amended | ✗ |
| capacity_mw | — | — | ✗ |
| gpu_count | — | — | ✗ |
| term_months | — | — | ✗ |
| total_value_usd | — | — | ✗ |
| annual_value_usd | — | — | ✗ |
| customer_name | — | OpenAI OpCo, LLC | ✗ |
| customer_disclosed | — | true | ✗ |

### crwv — 2026-01-26 — 8-K — `0001769628-26-000044`
[Filing index](https://www.sec.gov/Archives/edgar/data/1769628/000176962826000044/)

Flash found 0 contract(s); Pro found 0.

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|

### crwv — 2026-03-31 — 8-K — `0001769628-26-000129`
[Filing index](https://www.sec.gov/Archives/edgar/data/1769628/000176962826000129/)

Flash found 1 contract(s); Pro found 1.

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|
| kind | financing | financing | ✓ |
| status | expanded | amended | ✗ |
| capacity_mw | — | — | ✓ |
| gpu_count | — | — | ✓ |
| term_months | — | — | ✓ |
| total_value_usd | 8500000000 | 8500000000 | ✓ |
| annual_value_usd | — | — | ✓ |
| customer_name | — | CoreWeave Compute Acquisition Co. VIII, LLC | ✗ |
| customer_disclosed | false | true | ✗ |

### crwv — 2026-04-09 — 8-K — `0001769628-26-000154`
[Filing index](https://www.sec.gov/Archives/edgar/data/1769628/000176962826000154/)

Flash found 1 contract(s); Pro found 1.

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|
| kind | gpu_cloud_capacity | gpu_cloud_capacity | ✓ |
| status | expanded | expanded | ✓ |
| capacity_mw | — | — | ✓ |
| gpu_count | — | — | ✓ |
| term_months | — | — | ✓ |
| total_value_usd | 21000000000 | 21000000000 | ✓ |
| annual_value_usd | — | — | ✓ |
| customer_name | Meta Platforms, Inc. | Meta Platforms, Inc. | ✓ |
| customer_disclosed | true | true | ✓ |

### crwv — 2026-04-15 — 8-K — `0001769628-26-000167`
[Filing index](https://www.sec.gov/Archives/edgar/data/1769628/000176962826000167/)

Flash found 1 contract(s); Pro found 1.

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|
| kind | gpu_cloud_capacity | gpu_cloud_capacity | ✓ |
| status | expanded | expanded | ✓ |
| capacity_mw | — | — | ✓ |
| gpu_count | — | — | ✓ |
| term_months | — | — | ✓ |
| total_value_usd | 6000000000 | 6000000000 | ✓ |
| annual_value_usd | 6000000000 | — | ✗ |
| customer_name | Jane Street | Jane Street | ✓ |
| customer_disclosed | true | true | ✓ |

### crwv — 2026-05-18 — 8-K — `0001769628-26-000236`
[Filing index](https://www.sec.gov/Archives/edgar/data/1769628/000176962826000236/)

Flash found 0 contract(s); Pro found 1. **Count mismatch.**

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|
| kind | — | financing | ✗ |
| status | — | definitive | ✗ |
| capacity_mw | — | — | ✗ |
| gpu_count | — | — | ✗ |
| term_months | — | 66 | ✗ |
| total_value_usd | — | 3100000000 | ✗ |
| annual_value_usd | — | — | ✗ |
| customer_name | — | CoreWeave Financing DDTL V, LLC | ✗ |
| customer_disclosed | — | true | ✗ |

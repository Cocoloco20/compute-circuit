# Extractor eval: DeepSeek V4 Flash vs. DeepSeek V4 Pro

Generated 2026-09-16. 60 filing(s) evaluated.

Field agreement: **46.9%** (184/392 compared fields, 2% tolerance on numbers).
Contract-count mismatches: 14/60 filing(s).
Cost: Flash ~$0.0497, Pro ~$1.1016 for this run.

Read every ✗ row below before trusting the percentage — a extraction wrong on `total_value_usd` matters more than one wrong on `escalator_pct`. If Flash is missing or misstating fields that change what a row means, switch `LLM_MODEL` in `.env.example` / the Offtake cloud environment to the Pro id and accept the higher per-filing cost.

**Caveat found checking this run's worst mismatch (crwv 2025-10-02, Flash 0 vs. Pro 3):** this eval calls `extractContracts` once per model, with no retry -- so it re-exposes the exact Flash non-determinism `extractContractsWithRetry` exists to catch in production. Checked `contract_filing_scans` for that same accession: the live backfill (which does retry once on an empty result) actually extracted 3 contracts, matching Pro. The 46.9% figure here is a raw single-call comparison, not what ends up in the ledger -- real accuracy is higher than this report shows. Worth having `eval-extractor.ts` call the retry-wrapped path next time this is rerun, so the number reflects production behavior.

---
### bitf — 2024-05-15 — 6-K — `0001213900-24-043172`
[Filing index](https://www.sec.gov/Archives/edgar/data/1812477/000121390024043172/)

Flash found 0 contract(s); Pro found 0.

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|

### btbt — 2024-08-19 — 6-K — `0001213900-24-070722`
[Filing index](https://www.sec.gov/Archives/edgar/data/1710350/000121390024070722/)

Flash found 3 contract(s); Pro found 3.

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|
| kind | gpu_cloud_capacity | gpu_cloud_capacity | ✓ |
| status | expanded | expanded | ✓ |
| capacity_mw | — | — | ✓ |
| gpu_count | 2048 | 2048 | ✓ |
| term_months | 36 | 36 | ✓ |
| total_value_usd | — | — | ✓ |
| annual_value_usd | — | — | ✓ |
| customer_name | — | — | ✓ |
| kind | other | gpu_cloud_capacity | ✗ |
| status | amended | expanded | ✗ |
| capacity_mw | — | — | ✓ |
| gpu_count | 1024 | — | ✗ |
| term_months | 36 | 36 | ✓ |
| total_value_usd | — | — | ✓ |
| annual_value_usd | — | — | ✓ |
| customer_name | Bit Digital, Inc. | Bit Digital, Inc. | ✓ |
| kind | gpu_cloud_capacity | gpu_cloud_capacity | ✓ |
| status | amended | terminated | ✗ |
| capacity_mw | — | — | ✓ |
| gpu_count | 50000 | — | ✗ |
| term_months | 60 | 60 | ✓ |
| total_value_usd | 700000000 | 700000000 | ✓ |
| annual_value_usd | — | — | ✓ |
| customer_name | Boosteroid Inc. | Boosteroid Inc. | ✓ |

### btdr — 2024-07-05 — 6-K — `0001140361-24-032462`
[Filing index](https://www.sec.gov/Archives/edgar/data/1899123/000114036124032462/)

Flash found 1 contract(s); Pro found 1.

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|
| kind | power_supply | power_supply | ✓ |
| status | expanded | definitive | ✗ |
| capacity_mw | 570 | 570 | ✓ |
| gpu_count | — | — | ✓ |
| term_months | 360 | 360 | ✓ |
| total_value_usd | — | — | ✓ |
| annual_value_usd | — | — | ✓ |
| customer_name | Bitdeer Technologies Group | Bitdeer Technologies Group | ✓ |

### corz — 2024-01-23 — 8-K — `0001193125-24-013078`
[Filing index](https://www.sec.gov/Archives/edgar/data/1839341/000119312524013078/)

Flash found 0 contract(s); Pro found 1. **Count mismatch.**

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|
| kind | — | equipment_purchase | ✗ |
| status | — | amended | ✗ |
| capacity_mw | — | — | ✗ |
| gpu_count | — | — | ✗ |
| term_months | — | — | ✗ |
| total_value_usd | — | 77000000 | ✗ |
| annual_value_usd | — | — | ✗ |
| customer_name | — | Core Scientific, Inc. | ✗ |

### hut — 2025-11-17 — 8-K — `0001104659-25-112928`
[Filing index](https://www.sec.gov/Archives/edgar/data/1964789/000110465925112928/)

Flash found 0 contract(s); Pro found 2. **Count mismatch.**

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|
| kind | — | other | ✗ |
| status | — | amended | ✗ |
| capacity_mw | — | 310 | ✗ |
| gpu_count | — | — | ✗ |
| term_months | — | — | ✗ |
| total_value_usd | — | — | ✗ |
| annual_value_usd | — | — | ✗ |
| customer_name | — | TransAlta Corporation | ✗ |
| kind | — | power_supply | ✗ |
| status | — | amended | ✗ |
| capacity_mw | — | 310 | ✗ |
| gpu_count | — | — | ✗ |
| term_months | — | 60 | ✗ |
| total_value_usd | — | — | ✗ |
| annual_value_usd | — | — | ✗ |
| customer_name | — | Ontario IESO | ✗ |

### iren — 2024-01-16 — 6-K — `0001140361-24-002189`
[Filing index](https://www.sec.gov/Archives/edgar/data/1878848/000114036124002189/)

Flash found 0 contract(s); Pro found 0.

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|

### mara — 2024-04-04 — 8-K — `0001493152-24-013186`
[Filing index](https://www.sec.gov/Archives/edgar/data/1507605/000149315224013186/)

Flash found 0 contract(s); Pro found 0.

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|

### nbis — 2024-10-18 — 6-K — `0001104659-24-109850`
[Filing index](https://www.sec.gov/Archives/edgar/data/1513845/000110465924109850/)

Flash found 1 contract(s); Pro found 0. **Count mismatch.**

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|
| kind | colocation_lease | — | ✗ |
| status | definitive | — | ✗ |
| capacity_mw | — | — | ✗ |
| gpu_count | — | — | ✗ |
| term_months | — | — | ✗ |
| total_value_usd | — | — | ✗ |
| annual_value_usd | — | — | ✗ |
| customer_name | Nebius | — | ✗ |

### riot-mining — 2024-02-27 — 8-K — `0001167419-24-000008`
[Filing index](https://www.sec.gov/Archives/edgar/data/1167419/000116741924000008/)

Flash found 0 contract(s); Pro found 0.

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|

### wulf — 2024-12-23 — 8-K — `0000950142-24-002980`
[Filing index](https://www.sec.gov/Archives/edgar/data/1083301/000095014224002980/)

Flash found 1 contract(s); Pro found 1.

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|
| kind | power_supply | colocation_lease | ✗ |
| status | amended | definitive | ✗ |
| capacity_mw | 70 | 70 | ✓ |
| gpu_count | — | — | ✓ |
| term_months | — | — | ✓ |
| total_value_usd | — | — | ✓ |
| annual_value_usd | — | — | ✓ |
| customer_name | Core42 | Core42 | ✓ |

### wyfi — 2025-12-18 — 8-K — `0001213900-25-123321`
[Filing index](https://www.sec.gov/Archives/edgar/data/2042022/000121390025123321/)

Flash found 2 contract(s); Pro found 1. **Count mismatch.**

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|
| kind | colocation_lease | colocation_lease | ✓ |
| status | amended | definitive | ✗ |
| capacity_mw | 40 | 40 | ✓ |
| gpu_count | — | — | ✓ |
| term_months | 120 | 120 | ✓ |
| total_value_usd | 865000000 | 865000000 | ✓ |
| annual_value_usd | — | — | ✓ |
| customer_name | Nscale Services US Inc. and Nscale Global Holdings Limited | Nscale Services US Inc. and Nscale Global Holdings Limited | ✓ |
| kind | power_supply | — | ✗ |
| status | amended | — | ✗ |
| capacity_mw | 99 | — | ✗ |
| gpu_count | — | — | ✗ |
| term_months | — | — | ✗ |
| total_value_usd | — | — | ✗ |
| annual_value_usd | — | — | ✗ |
| customer_name | — | — | ✗ |

### apld — 2025-08-29 — 8-K — `0001493152-25-012458`
[Filing index](https://www.sec.gov/Archives/edgar/data/1144879/000149315225012458/)

Flash found 1 contract(s); Pro found 1.

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|
| kind | colocation_lease | colocation_lease | ✓ |
| status | definitive | definitive | ✓ |
| capacity_mw | 150 | 150 | ✓ |
| gpu_count | — | — | ✓ |
| term_months | 180 | 180 | ✓ |
| total_value_usd | 4000000000 | 4000000000 | ✓ |
| annual_value_usd | — | — | ✓ |
| customer_name | CoreWeave, Inc. | CoreWeave, Inc. | ✓ |

### btbt — 2024-10-17 — 6-K — `0001213900-24-088517`
[Filing index](https://www.sec.gov/Archives/edgar/data/1710350/000121390024088517/)

Flash found 0 contract(s); Pro found 0.

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|

### btdr — 2024-04-08 — 6-K — `0001140361-24-018447`
[Filing index](https://www.sec.gov/Archives/edgar/data/1899123/000114036124018447/)

Flash found 0 contract(s); Pro found 0.

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|

### clsk — 2026-07-14 — 8-K — `0001193125-26-302448`
[Filing index](https://www.sec.gov/Archives/edgar/data/827876/000119312526302448/)

Flash found 1 contract(s); Pro found 2. **Count mismatch.**

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|
| kind | other | power_supply | ✗ |
| status | amended | expanded | ✗ |
| capacity_mw | 885 | 175 | ✗ |
| gpu_count | — | — | ✓ |
| term_months | — | — | ✓ |
| total_value_usd | — | 6600000000 | ✗ |
| annual_value_usd | — | 330000000 | ✗ |
| customer_name | Tenant | — | ✗ |
| kind | — | power_supply | ✗ |
| status | — | expanded | ✗ |
| capacity_mw | — | 885 | ✗ |
| gpu_count | — | — | ✗ |
| term_months | — | — | ✗ |
| total_value_usd | — | — | ✗ |
| annual_value_usd | — | — | ✗ |
| customer_name | — | — | ✗ |

### corz — 2024-01-25 — 8-K/A — `0001193125-24-014941`
[Filing index](https://www.sec.gov/Archives/edgar/data/1839341/000119312524014941/)

Flash found 0 contract(s); Pro found 0.

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|

### crwv — 2025-09-15 — 8-K — `0001769628-25-000047`
[Filing index](https://www.sec.gov/Archives/edgar/data/1769628/000176962825000047/)

Flash found 1 contract(s); Pro found 1.

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|
| kind | gpu_cloud_capacity | gpu_cloud_capacity | ✓ |
| status | amended | definitive | ✗ |
| capacity_mw | — | — | ✓ |
| gpu_count | — | — | ✓ |
| term_months | — | — | ✓ |
| total_value_usd | 6300000000 | 6300000000 | ✓ |
| annual_value_usd | — | — | ✓ |
| customer_name | NVIDIA Corporation | NVIDIA Corporation | ✓ |

### iren — 2024-01-23 — 6-K — `0001140361-24-003281`
[Filing index](https://www.sec.gov/Archives/edgar/data/1878848/000114036124003281/)

Flash found 0 contract(s); Pro found 0.

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|

### mara — 2026-07-09 — 8-K — `0000950142-26-002012`
[Filing index](https://www.sec.gov/Archives/edgar/data/1507605/000095014226002012/)

Flash found 0 contract(s); Pro found 1. **Count mismatch.**

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|
| kind | — | other | ✗ |
| status | — | completed | ✗ |
| capacity_mw | — | 2000 | ✗ |
| gpu_count | — | — | ✗ |
| term_months | — | — | ✗ |
| total_value_usd | — | 600000000 | ✗ |
| annual_value_usd | — | — | ✗ |
| customer_name | — | MAT 1177 LLC | ✗ |

### nbis — 2024-11-19 — 6-K — `0001104659-24-120402`
[Filing index](https://www.sec.gov/Archives/edgar/data/1513845/000110465924120402/)

Flash found 1 contract(s); Pro found 1.

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|
| kind | colocation_lease | colocation_lease | ✓ |
| status | expanded | expanded | ✓ |
| capacity_mw | 5 | 5 | ✓ |
| gpu_count | — | — | ✓ |
| term_months | — | — | ✓ |
| total_value_usd | — | — | ✓ |
| annual_value_usd | — | — | ✓ |
| customer_name | — | — | ✓ |

### riot-mining — 2026-08-10 — 8-K — `0001104659-26-093406`
[Filing index](https://www.sec.gov/Archives/edgar/data/1167419/000110465926093406/)

Flash found 1 contract(s); Pro found 4. **Count mismatch.**

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|
| kind | financing | colocation_lease | ✗ |
| status | amended | definitive | ✗ |
| capacity_mw | — | 191 | ✗ |
| gpu_count | — | — | ✓ |
| term_months | — | 240 | ✗ |
| total_value_usd | 573000000 | 9100000000 | ✗ |
| annual_value_usd | — | 457000000 | ✗ |
| customer_name | one of the world’s leading frontier AI labs | — | ✗ |
| kind | — | financing | ✗ |
| status | — | definitive | ✗ |
| capacity_mw | — | — | ✗ |
| gpu_count | — | — | ✗ |
| term_months | — | — | ✗ |
| total_value_usd | — | 573000000 | ✗ |
| annual_value_usd | — | — | ✗ |
| customer_name | — | Riot Platforms, Inc. | ✗ |
| kind | — | colocation_lease | ✗ |
| status | — | expanded | ✗ |
| capacity_mw | — | 25 | ✗ |
| gpu_count | — | — | ✗ |
| term_months | — | — | ✗ |
| total_value_usd | — | — | ✗ |
| annual_value_usd | — | — | ✗ |
| customer_name | — | Advanced Micro Devices, Inc. | ✗ |
| kind | — | colocation_lease | ✗ |
| status | — | loi | ✗ |
| capacity_mw | — | 1000 | ✗ |
| gpu_count | — | — | ✗ |
| term_months | — | — | ✗ |
| total_value_usd | — | — | ✗ |
| annual_value_usd | — | — | ✗ |
| customer_name | — | — | ✗ |

### slnh — 2025-04-17 — 8-K — `0001641172-25-005160`
[Filing index](https://www.sec.gov/Archives/edgar/data/64463/000164117225005160/)

Flash found 1 contract(s); Pro found 1.

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|
| kind | power_supply | power_supply | ✓ |
| status | loi | loi | ✓ |
| capacity_mw | 100 | 100 | ✓ |
| gpu_count | — | — | ✓ |
| term_months | — | — | ✓ |
| total_value_usd | — | — | ✓ |
| annual_value_usd | — | — | ✓ |
| customer_name | Soluna Holdings, Inc. | Soluna Holdings, Inc. | ✓ |

### wulf — 2024-10-10 — 8-K — `0001083301-24-000136`
[Filing index](https://www.sec.gov/Archives/edgar/data/1083301/000108330124000136/)

Flash found 1 contract(s); Pro found 1.

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|
| kind | colocation_lease | other | ✗ |
| status | definitive | amended | ✗ |
| capacity_mw | — | — | ✓ |
| gpu_count | — | — | ✓ |
| term_months | 420 | — | ✗ |
| total_value_usd | — | — | ✓ |
| annual_value_usd | 281398.2 | 281398.2 | ✓ |
| customer_name | Lake Mariner Data LLC | Lake Mariner Data LLC | ✓ |

### wyfi — 2026-01-26 — 8-K — `0001213900-26-007474`
[Filing index](https://www.sec.gov/Archives/edgar/data/2042022/000121390026007474/)

Flash found 3 contract(s); Pro found 3.

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|
| kind | colocation_lease | colocation_lease | ✓ |
| status | completed | definitive | ✗ |
| capacity_mw | 40 | 40 | ✓ |
| gpu_count | — | — | ✓ |
| term_months | 120 | 120 | ✓ |
| total_value_usd | 865000000 | 865000000 | ✓ |
| annual_value_usd | — | — | ✓ |
| customer_name | Nscale | Nscale | ✓ |
| kind | colocation_lease | colocation_lease | ✓ |
| status | completed | definitive | ✗ |
| capacity_mw | 5 | 5 | ✓ |
| gpu_count | — | — | ✓ |
| term_months | 60 | 60 | ✓ |
| total_value_usd | — | — | ✓ |
| annual_value_usd | — | — | ✓ |
| customer_name | Cerebras Systems | Cerebras Systems | ✓ |
| kind | power_supply | power_supply | ✓ |
| status | completed | definitive | ✗ |
| capacity_mw | 44 | 99 | ✗ |
| gpu_count | — | — | ✓ |
| term_months | — | — | ✓ |
| total_value_usd | — | — | ✓ |
| annual_value_usd | — | — | ✓ |
| customer_name | — | WhiteFiber, Inc. | ✗ |

### apld — 2025-11-12 — 8-K — `0001493152-25-021955`
[Filing index](https://www.sec.gov/Archives/edgar/data/1144879/000149315225021955/)

Flash found 1 contract(s); Pro found 0. **Count mismatch.**

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|
| kind | colocation_lease | — | ✗ |
| status | expanded | — | ✗ |
| capacity_mw | 200 | — | ✗ |
| gpu_count | — | — | ✗ |
| term_months | — | — | ✗ |
| total_value_usd | — | — | ✗ |
| annual_value_usd | — | — | ✗ |
| customer_name | U.S.-Based Investment Grade Hyperscaler | — | ✗ |

### bitf — 2025-10-10 — 6-K — `0001213900-25-097957`
[Filing index](https://www.sec.gov/Archives/edgar/data/1812477/000121390025097957/)

Flash found 0 contract(s); Pro found 1. **Count mismatch.**

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|
| kind | — | financing | ✗ |
| status | — | amended | ✗ |
| capacity_mw | — | — | ✗ |
| gpu_count | — | — | ✗ |
| term_months | — | — | ✗ |
| total_value_usd | — | 300000000 | ✗ |
| annual_value_usd | — | — | ✗ |
| customer_name | — | Bitfarms Ltd. | ✗ |

### btdr — 2024-08-12 — 6-K — `0001140361-24-036828`
[Filing index](https://www.sec.gov/Archives/edgar/data/1899123/000114036124036828/)

Flash found 1 contract(s); Pro found 1.

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|
| kind | other | colocation_lease | ✗ |
| status | expanded | expanded | ✓ |
| capacity_mw | 570 | 570 | ✓ |
| gpu_count | — | — | ✓ |
| term_months | 360 | 360 | ✓ |
| total_value_usd | — | — | ✓ |
| annual_value_usd | — | — | ✓ |
| customer_name | Bitdeer Technologies Group | — | ✗ |

### corz — 2024-03-06 — 8-K — `0001628280-24-009396`
[Filing index](https://www.sec.gov/Archives/edgar/data/1839341/000162828024009396/)

Flash found 1 contract(s); Pro found 1.

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|
| kind | hosting_services | hosting_services | ✓ |
| status | amended | amended | ✓ |
| capacity_mw | 16 | 16 | ✓ |
| gpu_count | — | — | ✓ |
| term_months | — | — | ✓ |
| total_value_usd | 100000000 | 100000000 | ✓ |
| annual_value_usd | — | — | ✓ |
| customer_name | CoreWeave | CoreWeave | ✓ |

### crwv — 2025-09-30 — 8-K — `0001769628-25-000050`
[Filing index](https://www.sec.gov/Archives/edgar/data/1769628/000176962825000050/)

Flash found 1 contract(s); Pro found 1.

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|
| kind | gpu_cloud_capacity | gpu_cloud_capacity | ✓ |
| status | amended | expanded | ✗ |
| capacity_mw | — | — | ✓ |
| gpu_count | — | — | ✓ |
| term_months | — | — | ✓ |
| total_value_usd | 14200000000 | 14200000000 | ✓ |
| annual_value_usd | — | — | ✓ |
| customer_name | Meta Platforms, Inc. | Meta Platforms, Inc. | ✓ |

### hut — 2025-12-17 — 8-K — `0001104659-25-122052`
[Filing index](https://www.sec.gov/Archives/edgar/data/1964789/000110465925122052/)

Flash found 3 contract(s); Pro found 4. **Count mismatch.**

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|
| kind | colocation_lease | colocation_lease | ✓ |
| status | definitive | expanded | ✗ |
| capacity_mw | 245 | 245 | ✓ |
| gpu_count | — | — | ✓ |
| term_months | 180 | 180 | ✓ |
| total_value_usd | 7000000000 | 7000000000 | ✓ |
| annual_value_usd | — | — | ✓ |
| customer_name | Fluidstack | Fluidstack Ltd. subsidiary | ✗ |
| kind | power_supply | power_supply | ✓ |
| status | definitive | expanded | ✗ |
| capacity_mw | 330 | — | ✗ |
| gpu_count | — | — | ✓ |
| term_months | — | — | ✓ |
| total_value_usd | — | — | ✓ |
| annual_value_usd | — | — | ✓ |
| customer_name | Hut 8 Corp. | Hut 8 Corp. | ✓ |
| kind | other | financing | ✗ |
| status | definitive | expanded | ✗ |
| capacity_mw | — | — | ✓ |
| gpu_count | — | — | ✓ |
| term_months | 180 | 180 | ✓ |
| total_value_usd | — | — | ✓ |
| annual_value_usd | — | — | ✓ |
| customer_name | Fluidstack | Fluidstack Ltd. subsidiary | ✗ |
| kind | — | financing | ✗ |
| status | — | expanded | ✗ |
| capacity_mw | — | — | ✗ |
| gpu_count | — | — | ✗ |
| term_months | — | — | ✗ |
| total_value_usd | — | — | ✗ |
| annual_value_usd | — | — | ✗ |
| customer_name | — | Hut 8 Corp. | ✗ |

### iren — 2024-02-08 — 6-K — `0001140361-24-006216`
[Filing index](https://www.sec.gov/Archives/edgar/data/1878848/000114036124006216/)

Flash found 1 contract(s); Pro found 1.

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|
| kind | gpu_cloud_capacity | gpu_cloud_capacity | ✓ |
| status | amended | amended | ✓ |
| capacity_mw | — | — | ✓ |
| gpu_count | 248 | 248 | ✓ |
| term_months | 3 | 3 | ✓ |
| total_value_usd | — | — | ✓ |
| annual_value_usd | — | — | ✓ |
| customer_name | Poolside AI SAS | Poolside AI SAS | ✓ |

### nbis — 2025-09-08 — 6-K — `0001104659-25-088312`
[Filing index](https://www.sec.gov/Archives/edgar/data/1513845/000110465925088312/)

Flash found 1 contract(s); Pro found 1.

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|
| kind | gpu_cloud_capacity | gpu_cloud_capacity | ✓ |
| status | amended | amended | ✓ |
| capacity_mw | — | — | ✓ |
| gpu_count | — | — | ✓ |
| term_months | 60 | 60 | ✓ |
| total_value_usd | 17400000000 | 17400000000 | ✓ |
| annual_value_usd | — | — | ✓ |
| customer_name | Microsoft | Microsoft | ✓ |

### riot-mining — 2024-07-23 — 8-K — `0001558370-24-009976`
[Filing index](https://www.sec.gov/Archives/edgar/data/1167419/000155837024009976/)

Flash found 0 contract(s); Pro found 0.

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|

### slnh — 2025-05-22 — 8-K — `0001641172-25-011984`
[Filing index](https://www.sec.gov/Archives/edgar/data/64463/000164117225011984/)

Flash found 1 contract(s); Pro found 1.

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|
| kind | power_supply | power_supply | ✓ |
| status | terminated | loi | ✗ |
| capacity_mw | 75 | 75 | ✓ |
| gpu_count | — | — | ✓ |
| term_months | — | — | ✓ |
| total_value_usd | — | — | ✓ |
| annual_value_usd | — | — | ✓ |
| customer_name | Soluna Holdings, Inc. | Soluna Holdings, Inc. | ✓ |

### apld — 2026-06-09 — 8-K — `0001493152-26-027984`
[Filing index](https://www.sec.gov/Archives/edgar/data/1144879/000149315226027984/)

Flash found 1 contract(s); Pro found 1.

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|
| kind | colocation_lease | colocation_lease | ✓ |
| status | definitive | expanded | ✗ |
| capacity_mw | 210 | 210 | ✓ |
| gpu_count | — | — | ✓ |
| term_months | 180 | 180 | ✓ |
| total_value_usd | 5200000000 | 5200000000 | ✓ |
| annual_value_usd | — | — | ✓ |
| customer_name | — | U.S. based high investment-grade hyperscaler | ✗ |

### btbt — 2026-05-27 — 8-K — `0001213900-26-061574`
[Filing index](https://www.sec.gov/Archives/edgar/data/1710350/000121390026061574/)

Flash found 2 contract(s); Pro found 3. **Count mismatch.**

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|
| kind | financing | financing | ✓ |
| status | definitive | amended | ✗ |
| capacity_mw | — | 40 | ✗ |
| gpu_count | — | — | ✓ |
| term_months | 9 | 9 | ✓ |
| total_value_usd | 100000000 | 150000000 | ✗ |
| annual_value_usd | — | 100000000 | ✗ |
| customer_name | Enovum NC-1 Venture, LLC | Enovum NC-1 Venture, LLC | ✓ |
| kind | financing | financing | ✓ |
| status | definitive | amended | ✗ |
| capacity_mw | — | — | ✓ |
| gpu_count | — | — | ✓ |
| term_months | — | 12 | ✗ |
| total_value_usd | 20000000 | 50000000 | ✗ |
| annual_value_usd | — | 50000000 | ✗ |
| customer_name | Enovum NC-1 Venture, LLC | Bit Digital Inc. | ✗ |
| kind | — | financing | ✗ |
| status | — | amended | ✗ |
| capacity_mw | — | — | ✗ |
| gpu_count | — | — | ✗ |
| term_months | — | 3 | ✗ |
| total_value_usd | — | 20000000 | ✗ |
| annual_value_usd | — | 20000000 | ✗ |
| customer_name | — | B. Riley Securities, Inc. | ✗ |

### cifr — 2025-11-13 — 8-K — `0000950103-25-014692`
[Filing index](https://www.sec.gov/Archives/edgar/data/1819989/000095010325014692/)

Flash found 0 contract(s); Pro found 1. **Count mismatch.**

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|
| kind | — | financing | ✗ |
| status | — | definitive | ✗ |
| capacity_mw | — | — | ✗ |
| gpu_count | — | — | ✗ |
| term_months | — | 60 | ✗ |
| total_value_usd | — | 1400000000 | ✗ |
| annual_value_usd | — | — | ✗ |
| customer_name | — | — | ✗ |

### corz — 2024-06-05 — 8-K — `0001628280-24-026763`
[Filing index](https://www.sec.gov/Archives/edgar/data/1839341/000162828024026763/)

Flash found 1 contract(s); Pro found 1.

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|
| kind | hosting_services | hosting_services | ✓ |
| status | definitive | amended | ✗ |
| capacity_mw | 200 | 200 | ✓ |
| gpu_count | — | — | ✓ |
| term_months | 144 | — | ✗ |
| total_value_usd | 3500000000 | 3500000000 | ✓ |
| annual_value_usd | — | — | ✓ |
| customer_name | CoreWeave | CoreWeave | ✓ |

### crwv — 2025-10-02 — 8-K — `0001193125-25-227562`
[Filing index](https://www.sec.gov/Archives/edgar/data/1769628/000119312525227562/)

Flash found 0 contract(s); Pro found 3. **Count mismatch.**

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|
| kind | — | financing | ✗ |
| status | — | amended | ✗ |
| capacity_mw | — | — | ✗ |
| gpu_count | — | — | ✗ |
| term_months | — | 60 | ✗ |
| total_value_usd | — | 3000000000 | ✗ |
| annual_value_usd | — | — | ✗ |
| customer_name | — | CoreWeave Compute Acquisition Co., IV, LLC | ✗ |
| kind | — | gpu_cloud_capacity | ✗ |
| status | — | definitive | ✗ |
| capacity_mw | — | — | ✗ |
| gpu_count | — | — | ✗ |
| term_months | — | — | ✗ |
| total_value_usd | — | — | ✗ |
| annual_value_usd | — | — | ✗ |
| customer_name | — | Microsoft Corporation | ✗ |
| kind | — | gpu_cloud_capacity | ✗ |
| status | — | amended | ✗ |
| capacity_mw | — | — | ✗ |
| gpu_count | — | — | ✗ |
| term_months | — | — | ✗ |
| total_value_usd | — | — | ✗ |
| annual_value_usd | — | — | ✗ |
| customer_name | — | OpenAI OpCo, LLC | ✗ |

### iren — 2024-02-14 — 6-K — `0001140361-24-007666`
[Filing index](https://www.sec.gov/Archives/edgar/data/1878848/000114036124007666/)

Flash found 1 contract(s); Pro found 1.

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|
| kind | equipment_purchase | equipment_purchase | ✓ |
| status | expanded | definitive | ✗ |
| capacity_mw | — | — | ✓ |
| gpu_count | 568 | 568 | ✓ |
| term_months | — | — | ✓ |
| total_value_usd | 22000000 | 22000000 | ✓ |
| annual_value_usd | — | — | ✓ |
| customer_name | Iris Energy Limited | Iris Energy Limited | ✓ |

### nbis — 2025-09-15 — 6-K — `0001104659-25-089969`
[Filing index](https://www.sec.gov/Archives/edgar/data/1513845/000110465925089969/)

Flash found 1 contract(s); Pro found 0. **Count mismatch.**

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|
| kind | other | — | ✗ |
| status | amended | — | ✗ |
| capacity_mw | — | — | ✗ |
| gpu_count | — | — | ✗ |
| term_months | — | — | ✗ |
| total_value_usd | — | — | ✗ |
| annual_value_usd | — | — | ✗ |
| customer_name | Microsoft | — | ✗ |

### riot-mining — 2024-08-09 — 8-K — `0001558370-24-011760`
[Filing index](https://www.sec.gov/Archives/edgar/data/1167419/000155837024011760/)

Flash found 0 contract(s); Pro found 0.

| field | Flash (cheap) | Pro (strong) | agree |
|---|---|---|---|

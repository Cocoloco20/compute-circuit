-- Migration 0042 — Glossary: per-layer + per-agency "why this matters" copy.
--
-- The world graph has been growing organically (16 layers + 22+ agencies + 6
-- flow types + ~6 bottleneck rows). For a newcomer landing on the page, none
-- of those names self-explain: "what is the 'foundry' layer?", "what does
-- BIS actually do?", "why should I care about CoWoS?". This migration plants
-- the canonical short copy so the new Glossary view (📖 button in the top
-- bar) can render a tour of the entire ontology.
--
-- Scope:
--   1. layers.description           — 2-3 sentence "what belongs here + why"
--   2. layers.example_companies     — text[] of 3 prototypical cos for chips
--   3. layers.bottleneck_keywords   — text[] of words associated with this layer's
--                                     supply-chain pressure points
--   4. agencies.description         — what the agency does + scope
--   5. agencies.recent_focus        — current hot-button issues (hand-curated)
--
-- All UPDATEs are id-keyed and idempotent — safe to re-run as content evolves.

-- =====================================================================
-- 1. Columns
-- =====================================================================

alter table layers
  add column if not exists description           text,
  add column if not exists example_companies     text[],
  add column if not exists bottleneck_keywords   text[];

alter table agencies
  add column if not exists description text,
  add column if not exists recent_focus text;

comment on column layers.description is
  '2-3 sentence "what belongs in this layer + why it matters for AI compute" copy. Rendered by GlossaryView.';
comment on column layers.example_companies is
  'Top 3 prototypical companies for this layer, shown as clickable chips in GlossaryView.';
comment on column layers.bottleneck_keywords is
  'Short phrases describing the binding constraints on this layer. Shown as pills in GlossaryView.';
comment on column agencies.description is
  'What this agency does + its scope of authority. Rendered by GlossaryView.';
comment on column agencies.recent_focus is
  'Hand-curated note about what this agency is actively working on right now.';

-- =====================================================================
-- 2. Layer descriptions — all 16 layers
-- =====================================================================
-- Order: bottom-of-stack (raw materials, energy) → top-of-stack (labs, government).
-- Each description follows the same shape: WHO is here + WHY it matters + (optionally)
-- the upstream / downstream dependency. example_companies are intentionally limited to
-- 3 anchor names — recognizable to a casual reader, definitive of the layer.

update layers set
  description = 'The world''s oil & gas supermajors and pure-play E&P names. Their natural-gas output is the marginal fuel that runs the gas-peaker turbines AI datacenters depend on when the grid is short, and their LNG flows shape global energy prices that move every utility downstream.',
  example_companies = array['ExxonMobil','Saudi Aramco','Chevron'],
  bottleneck_keywords = array['gas-peaker capacity','LNG export terminals','permitting delays','OPEC+ output']
where id = 'oil-gas';

update layers set
  description = 'Producers of the critical metals that feed AI compute: lithium for grid-scale batteries, copper for datacenter wiring + transformers, and rare-earths for magnets in cooling fans and EV motors. Concentrated processing in China makes this layer a geopolitical pressure point.',
  example_companies = array['Freeport-McMoRan','Albemarle','MP Materials'],
  bottleneck_keywords = array['copper smelter capacity','rare-earth processing','lithium spot','tariffs / export curbs']
where id = 'metals-mining';

update layers set
  description = 'Power generators, utilities, and grid operators delivering the gigawatt-scale loads that AI datacenters need. The binding constraint on the entire stack — chips can be built faster than substations and transmission lines, so PJM / ERCOT interconnect queues dictate where the next 100 MW of compute can plug in.',
  example_companies = array['Constellation Energy','Vistra','NextEra Energy'],
  bottleneck_keywords = array['transmission build-out','interconnect queues','nuclear restarts','gas peaker availability']
where id = 'energy';

update layers set
  description = 'Uranium miners, conversion + enrichment specialists, and SMR fuel suppliers powering the nuclear renaissance triggered by hyperscaler PPAs (Microsoft↔Constellation, Amazon↔Talen). Russian SWU exposure and Kazakh ISR yield are the live supply-side risks.',
  example_companies = array['Cameco','Kazatomprom','Centrus Energy'],
  bottleneck_keywords = array['HALEU supply','Russian enrichment ban','SMR licensing','uranium spot price']
where id = 'nuclear-fuel';

update layers set
  description = 'The wafer-fab equipment (WFE) vendors that make the lithography, etch, deposition, and metrology tools every foundry needs. Highly concentrated — ASML has a near-monopoly on EUV, and the four-vendor oligopoly (ASML / AMAT / LRCX / KLAC) is the chokepoint US export controls target first.',
  example_companies = array['ASML','Applied Materials','Lam Research'],
  bottleneck_keywords = array['EUV machine scarcity','High-NA EUV ramp','export controls','tool lead times']
where id = 'equipment';

update layers set
  description = 'Suppliers of silicon wafers, photoresists, specialty gases, and other fab consumables. Japan is dominant here (Shin-Etsu, JSR, SUMCO), giving METI quiet leverage in any chip-export dispute. Volumes are large but cyclicality is severe.',
  example_companies = array['Shin-Etsu Chemical','SUMCO','Entegris'],
  bottleneck_keywords = array['300mm wafer capacity','EUV photoresist','specialty gas','geographic concentration']
where id = 'materials';

update layers set
  description = 'Pure-play silicon manufacturers that physically produce the chips that fabless designers (NVIDIA, AMD) only design. TSMC dominates leading-edge logic — N3 yield and 2nm risk-production timing gate the entire industry''s ability to ship Blackwell / Rubin volumes.',
  example_companies = array['TSMC','Samsung Foundry','SMIC'],
  bottleneck_keywords = array['N3 / N2 yield','CoWoS packaging','Taiwan single-point risk','export-control carveouts']
where id = 'foundry';

update layers set
  description = 'HBM and DRAM makers whose stacked memory packages are the second binding constraint on AI accelerators after wafer capacity. HBM3e is sold out through 2026; HBM4 ramps determine whether B200/B300 ship into a constrained or balanced market.',
  example_companies = array['SK Hynix','Micron','Samsung Memory'],
  bottleneck_keywords = array['HBM3e allocation','HBM4 qualification','TSV throughput','Korea concentration']
where id = 'memory';

update layers set
  description = 'The fabless chip designers + IP licensors at the heart of AI training & inference. NVIDIA is the volume leader; AMD MI300/MI400, Broadcom custom silicon for Google, and Arm''s licensing engine round out the layer. Most CapEx in the stack ultimately funnels here.',
  example_companies = array['NVIDIA','AMD','Broadcom'],
  bottleneck_keywords = array['EUV scarcity','HBM supply','US export controls','design-cycle latency']
where id = 'chips';

update layers set
  description = 'NAND, HDD, and storage-controller vendors supplying the warm + cold tiers of AI training datasets and inference caches. Less glamorous than HBM but quietly indispensable — every multimodal model pulls petabytes off this layer.',
  example_companies = array['Western Digital','Seagate','Pure Storage'],
  bottleneck_keywords = array['QLC NAND yields','HDD areal density','controller IP','enterprise SSD lead times']
where id = 'storage';

update layers set
  description = 'Server OEMs (HPE, Dell, Lenovo, Supermicro, Inspur) and the OEMs/ODMs that integrate GPUs + networking into the racks deployed in hyperscaler datacenters. Margins are thin but the layer absorbs the integration complexity — and reveals demand earliest via order backlog.',
  example_companies = array['Hewlett Packard Enterprise','Lenovo','Inspur'],
  bottleneck_keywords = array['liquid cooling tech','rack-scale assembly','GPU allocation','networking fabric']
where id = 'server-infra';

update layers set
  description = 'Datacenter REITs, builders, networking, and the cooling + power-distribution kit (Vertiv, Eaton, Schneider) that turns raw electrons into deployable compute. The physical bottleneck between chips arriving and inference actually running.',
  example_companies = array['Vertiv','Equinix','Digital Realty'],
  bottleneck_keywords = array['liquid cooling','transformer lead times','DC permitting','colo capacity']
where id = 'infrastructure';

update layers set
  description = 'Telcos investing in edge / AI-RAN compute and fiber + submarine cable operators that move AI training data between regions. Hyperscaler partnerships (NVIDIA × Verizon, NTT × OpenAI) make this layer the connective tissue.',
  example_companies = array['NTT','China Mobile','KDDI'],
  bottleneck_keywords = array['fiber build-out','submarine cable capacity','5G + edge AI rollouts','spectrum allocation']
where id = 'telecom-cloud';

update layers set
  description = 'Hyperscaler clouds (AWS, Azure, GCP, Oracle), AI-native GPU clouds (CoreWeave, Lambda), and EU sovereign clouds (OVHcloud, SAP). They take the chips + power + buildings and rent them out as the compute every model lab actually trains on.',
  example_companies = array['Microsoft Azure','AWS','CoreWeave'],
  bottleneck_keywords = array['GPU allocation','PPA signing','region capacity','sovereign-cloud regulation']
where id = 'cloud';

update layers set
  description = 'Frontier model labs (OpenAI, Anthropic, Google DeepMind, xAI, Meta AI) and the open-weight + research-driven players (Mistral, DeepSeek, Aleph Alpha) that drive demand for every layer below. Where compute, capital, and talent ultimately concentrate.',
  example_companies = array['OpenAI','Anthropic','Google DeepMind'],
  bottleneck_keywords = array['training-run capital','top-talent retention','export-control compliance','open- vs closed-weight strategy']
where id = 'labs';

update layers set
  description = 'Regulators, export-control bodies, antitrust offices, and AI-safety institutes that govern the stack without consuming compute themselves. Their actions (BIS entity-list updates, EU AI Act enforcement, CAC algorithm filings) propagate through every layer below within weeks.',
  example_companies = array['US BIS','EU AI Office','China CAC'],
  bottleneck_keywords = array['export controls','AI Act enforcement','antitrust review','national security review']
where id = 'government';

-- =====================================================================
-- 3. Agency descriptions — all seeded agencies (22 from migration 0039)
-- =====================================================================

-- ----- United States -----

update agencies set
  description = 'The US Department of Commerce arm that enforces export controls on dual-use technology, including all advanced AI chips. Maintains the Entity List restricting which Chinese cos can buy US-origin chips and dictates the Foreign Direct Product Rule that extends US controls to foreign-made goods with US IP.',
  recent_focus = 'H20 / H200 export licensing framework, evolving entity-list additions (e.g. Sophgo, Chinese cloud GPU brokers), and HBM-specific carve-outs in the Oct 2023 / Dec 2024 / 2025 rule updates.'
where id = 'us_bis';

update agencies set
  description = 'Cabinet-level department overseeing US economic policy, including the CHIPS Program Office that disburses Section 9902 grants ($39B for fabs) and Section 9903 R&D funding. Houses BIS, NTIA, NIST, and the Bureau of Census.',
  recent_focus = 'CHIPS Act milestone payouts to Intel, TSMC Arizona, Samsung Taylor, and Micron NY; CHIPS R&D NSTC (National Semiconductor Technology Center) standup.'
where id = 'us_doc';

update agencies set
  description = 'Office of Foreign Assets Control administers + enforces US economic sanctions. For AI compute, OFAC''s SDN list determines which cos and individuals US persons can transact with — a more aggressive backstop to BIS export controls.',
  recent_focus = 'Sanctions on Chinese cloud-GPU rental brokers, Russian compute access via third countries, and crypto-mining cos transacting with sanctioned entities.'
where id = 'us_treasury_ofac';

update agencies set
  description = 'Consumer-protection + antitrust agency. Reviews mergers in tech / AI under HSR pre-merger notification and pursues "unfair methods of competition" cases. Under Khan / new chair, the agency has signaled heightened scrutiny of AI-stack consolidation.',
  recent_focus = 'AI partnership reviews (Microsoft↔OpenAI, Amazon↔Anthropic, Google↔Anthropic) under the 6(b) inquiry; cloud-services competition study.'
where id = 'us_ftc';

update agencies set
  description = 'DOJ Antitrust Division enforces the Sherman + Clayton Acts criminally + civilly. Handles deals that fall outside FTC jurisdiction by historical convention (chips → DOJ; cloud → FTC roughly). Active in semiconductor + cloud competition.',
  recent_focus = 'NVIDIA monopoly inquiry, Google ad-tech remedies, Visa-anti-competition pursuit; reviewing AI training-data + compute exclusivity arrangements.'
where id = 'us_doj_antitrust';

update agencies set
  description = 'Securities + Exchange Commission. Sets + enforces US public-company disclosure (10-K, 10-Q, 8-K, Form 4 insider, 13F holdings). All of Compute Circuit''s SEC-EDGAR-derived signals flow through SEC filing pipelines.',
  recent_focus = 'AI-disclosure rule guidance (companies overstating "AI" in filings), cybersecurity 8-K materiality enforcement, and crypto-securities enforcement transition.'
where id = 'us_sec';

update agencies set
  description = 'Department of Energy oversees the national labs (Oak Ridge, Lawrence Livermore, Argonne) running the largest US public-sector compute deployments + LPO loan guarantees for nuclear restarts + grid capex. EIA (the data arm) publishes every electricity statistic Compute Circuit ingests.',
  recent_focus = 'Loan Programs Office guarantees for Holtec Palisades + Constellation Crane (Three Mile Island) restarts; SMR ARDP demonstration funding; AI-for-energy R&D push.'
where id = 'us_doe';

update agencies set
  description = 'Nuclear Regulatory Commission licenses + regulates US commercial reactors + fuel cycle facilities. The licensing throughput here (or lack thereof) is the binding constraint on every SMR, restart, and uprate the hyperscalers are signing PPAs against.',
  recent_focus = 'Part 53 rulemaking for advanced reactors; Crane / TMI restart license review; NuScale + Kairos + X-energy ARDP design certifications.'
where id = 'us_nrc';

-- ----- European Union -----

update agencies set
  description = 'European Commission''s Directorate-General for Competition. Reviews mergers above EUMR thresholds + investigates anti-competitive practices across the bloc. Has historically used heavy remedies (Google Shopping, Apple App Store) that AI-stack firms now have to factor in.',
  recent_focus = 'Microsoft↔OpenAI partnership review, NVIDIA antitrust scrutiny on H100/Run:AI bundling, generative-AI competition study (call for contributions).'
where id = 'eu_commission_dgcomp';

update agencies set
  description = 'Implements + enforces the EU AI Act (in force Aug 2024). Houses the AI Board, the GPAI compliance unit, and the Scientific Panel. The de-facto global rule-setter for foundation models — even US labs ship Europe-compliant variants now.',
  recent_focus = 'GPAI model registration deadlines (Aug 2026); transparency + copyright training-data summaries; serious-incident reporting framework; voluntary GPAI Code of Practice consultation.'
where id = 'eu_ai_office';

update agencies set
  description = 'Directorate-General for Communications Networks, Content and Technology. Houses the EU digital strategy + drives the EuroHPC supercomputer programme, the EU Chips Act delivery, and the AI Factories initiative.',
  recent_focus = 'AI Factories programme (15 supercomputers in 2025–26 dedicated to model training), EU Chips Act pilot lines + IPCEI Microelectronics, Connecting Europe Facility cross-border AI infrastructure.'
where id = 'eu_dg_connect';

update agencies set
  description = 'European Union Agency for Cybersecurity. Issues binding security standards under the NIS2 directive + the Cybersecurity Act certification schemes (EUCS) — which cover any cloud / AI service marketed in the EU.',
  recent_focus = 'EUCS sovereignty requirements (controversial — could exclude US hyperscalers); AI-cybersecurity threat landscape report; CSA cloud certification scheme rollout.'
where id = 'eu_enisa';

-- ----- China -----

update agencies set
  description = 'Ministry of Industry & Information Technology — China''s industrial policy lead for semiconductors, AI, telecoms, and the digital economy. Administers the "Big Fund" (CICIIIF) channeling state capital into SMIC, YMTC, CXMT, and the domestic equipment ecosystem.',
  recent_focus = 'Big Fund Phase III ($47B) disbursements to memory + equipment makers; "Made in China 2025" semiconductor self-sufficiency push; algorithmic services security review.'
where id = 'cn_miit';

update agencies set
  description = 'National Development & Reform Commission — China''s macroeconomic + industrial planning body. Sets the Five-Year Plan compute + energy targets and approves all megaprojects (datacenters, fabs, nuclear) at provincial scale.',
  recent_focus = '"Eastern Data, Western Computing" mega-project (move compute load to western provinces with surplus power); 15th Five-Year Plan compute capacity targets; SOE-led nuclear build-out.'
where id = 'cn_ndrc';

update agencies set
  description = 'Cyberspace Administration of China — internet regulator + de-facto AI-content rule-setter. Operates the algorithm-filing registry that every generative-AI service available in China must register before public launch.',
  recent_focus = 'Generative AI service algorithm filings (mandatory pre-launch); data-export security assessments restricting AI-training data leaving China; LLM content-safety enforcement.'
where id = 'cn_cac';

update agencies set
  description = 'Chinese Ministry of Commerce — administers China''s export controls + countermeasures to US sanctions. The Unreliable Entity List + dual-use catalog control flows of gallium, germanium, antimony, graphite, and rare-earth processing tech.',
  recent_focus = 'Rare-earth + gallium / germanium export curbs in response to US AI-chip controls; M&A reviews of US tech acquisitions of Chinese assets; anti-foreign-sanctions framework rollout.'
where id = 'cn_mofcom';

-- ----- Other -----

update agencies set
  description = 'UK communications + spectrum regulator with statutory duties for online safety (now including generative AI) under the Online Safety Act 2023. Sets the framework for foundation-model accountability in UK markets.',
  recent_focus = 'Online Safety Act guidance for GPAI providers; AI-driven misinformation enforcement; cloud-market competition study referring concerns about hyperscaler lock-in.'
where id = 'uk_ofcom';

update agencies set
  description = 'Government body founded Nov 2023 (then "AI Safety Institute"; renamed 2024 to UK AI Security Institute). Pre-deployment evaluates frontier models from OpenAI, Anthropic, Google DeepMind via voluntary access agreements — the most operationally mature government model-eval body globally.',
  recent_focus = 'Pre-deployment evals of GPT-5 / Claude 4 / Gemini Ultra; misuse + dual-use risk assessments; Inspect open-source eval framework; international AI Safety Network coordination.'
where id = 'uk_ai_safety_institute';

update agencies set
  description = 'Ministry of Economy, Trade and Industry — Japan''s industrial policy + export-control lead. Coordinated the JIC-led JSR take-private (2024) and bankrolled Rapidus, the consortium racing TSMC to 2nm in Hokkaido by 2027.',
  recent_focus = 'Rapidus 2nm Hokkaido fab subsidies (~$13B committed); export-control alignment with BIS on chip equipment to China; AI strategy "AI Hiroshima Process" leadership.'
where id = 'jp_meti';

update agencies set
  description = 'Korean Ministry of SMEs and Startups — supports SK Hynix, Samsung Electronics, and the broader KOSDAQ semi-supply ecosystem with R&D credits, tax incentives, and trade-mission support. Less interventionist than MOTIE but closer to startup capital flows.',
  recent_focus = 'K-Chips Act tax credit extensions for HBM + memory CapEx; AI-semiconductor startup ecosystem seed funding; supplier-localization grants reducing equipment reliance on Japan.'
where id = 'kr_mss';

update agencies set
  description = 'Taiwan Ministry of Economic Affairs — TSMC + UMC + ASE supply-chain steward. Approves outbound investment for TSMC fabs in Arizona / Japan / Germany and coordinates with US/JP/EU governments on chip-supply diplomacy.',
  recent_focus = 'TSMC Arizona Phase 3 approval; export controls aligning with BIS on advanced-node exports to China; energy supply contracts for ever-larger TSMC fab loads.'
where id = 'tw_moea';

update agencies set
  description = 'Indian Ministry of Electronics and Information Technology — runs the India Semiconductor Mission ($10B incentive pool) attracting Foxconn / Vedanta / Tower / Micron fab + ATMP investments. Lead drafter of the upcoming Digital India Act + AI regulation.',
  recent_focus = 'Micron ATMP Gujarat ramp; Tata-PSMC Dholera fab construction; IndiaAI mission ($1B) funding 10K GPU sovereign compute fabric; Digital India Act + AI rules drafting.'
where id = 'in_meity';

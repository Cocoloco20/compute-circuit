// Seed dataset for Compute Circuit.
// AI compute ecosystem snapshot (late 2025) — public companies, private labs,
// VC/institutional backers, capital + compute + energy flows, and the major
// supply-chain bottlenecks that shape the system.
//
// This is the starting corpus. Trackers (8-K, 13F, news) will write into
// the same tables incrementally in later phases.

import type {
  Layer,
  Investor,
  Company,
  CompanyBacker,
  Flow,
  Bottleneck,
  BottleneckBeneficiary,
  FlowType,
  NodeKind,
} from '@/types/db'

// Helper to keep flow rows tiny inline.
const f = (
  from_id: string,
  from_kind: NodeKind,
  to_id: string,
  to_kind: NodeKind,
  type: FlowType,
  magnitude: number,
  note: string | null = null,
): Omit<Flow, 'id' | 'created_at'> => ({
  from_id,
  from_kind,
  to_id,
  to_kind,
  type,
  magnitude,
  note,
})

// ============ LAYERS ============
// Stacked vertically. y_position is rendered in the 3D scene.
// order_index is the canonical bottom→top order for the UI.

export const layers: Layer[] = [
  { id: 'energy',         name: 'Power Generation',  order_index: 0, y_position: -10 },
  { id: 'equipment',      name: 'Semi Equipment',    order_index: 1, y_position: -7.5 },
  { id: 'materials',      name: 'Materials',         order_index: 2, y_position: -5 },
  { id: 'foundry',        name: 'Foundries',         order_index: 3, y_position: -2.5 },
  { id: 'memory',         name: 'Memory',            order_index: 4, y_position: 0 },
  { id: 'chips',          name: 'Chips',             order_index: 5, y_position: 2.5 },
  { id: 'infrastructure', name: 'DC Infrastructure', order_index: 6, y_position: 5 },
  { id: 'cloud',          name: 'Hyperscalers',      order_index: 7, y_position: 7.5 },
  { id: 'labs',           name: 'Model Labs',        order_index: 8, y_position: 10 },
]

// ============ INVESTORS ============

// VC + private capital — no 13F reporting (held through funds, not registered SMAs).
// CIK is left null; files_13f=false.
// Institutional managers that file 13F (ARK, Coatue, plus three added below) get cik + files_13f=true.
export const investors: Omit<Investor, 'created_at'>[] = [
  { id: 'sequoia',       name: 'Sequoia Capital',         domain: 'sequoiacap.com',     thesis: 'Generational AI platforms; led OpenAI & xAI rounds.',                          cik: null,            files_13f: false },
  { id: 'a16z',          name: 'Andreessen Horowitz',     domain: 'a16z.com',           thesis: 'Heavy backer of xAI, Mistral, and open-weight infra.',                         cik: null,            files_13f: false },
  { id: 'founders-fund', name: 'Founders Fund',           domain: 'foundersfund.com',   thesis: 'Defense + frontier compute; Anduril, OpenAI, xAI.',                            cik: null,            files_13f: false },
  { id: 'khosla',        name: 'Khosla Ventures',         domain: 'khoslaventures.com', thesis: 'OpenAI lead 2019; first-check labs bets.',                                     cik: null,            files_13f: false },
  { id: 'coatue',        name: 'Coatue Management',       domain: 'coatue.com',         thesis: 'Tech-focused crossover; Anthropic anchor investor. Files 13F (Coatue Mgmt LP).', cik: '0001135730',  files_13f: true  },
  { id: 'thrive',        name: 'Thrive Capital',          domain: 'thrivecap.com',      thesis: 'Concentrated AI bets — OpenAI, Scale AI tenders.',                             cik: null,            files_13f: false },
  { id: 'greenoaks',     name: 'Greenoaks Capital',       domain: 'greenoaks.com',      thesis: 'Late-stage compute + apps; CoreWeave, Scale.',                                 cik: null,            files_13f: false },
  { id: 'softbank',      name: 'SoftBank Vision Fund',    domain: 'visionfund.com',     thesis: '$40B OpenAI 2025 lead; owns Arm; nuclear infra interest.',                     cik: null,            files_13f: false },
  { id: 'ark',           name: 'ARK Invest',              domain: 'ark-invest.com',     thesis: 'Public-market AI compute; concentrated NVDA, TSM, CRWV. ARK Investment Mgmt LLC.', cik: '0001697748', files_13f: true  },

  // ---- Institutional 13F filers added in Phase 3 ----
  { id: 'blackrock',     name: 'BlackRock',               domain: 'blackrock.com',      thesis: 'Passive whale — owns ~7-8% of every megacap. Direction-of-flow proxy.',        cik: '0001364742',    files_13f: true  },
  { id: 'tiger-global',  name: 'Tiger Global',            domain: 'tigerglobal.com',    thesis: 'Crossover hedge fund + late-stage VC; concentrated tech bets.',                cik: '0001167483',    files_13f: true  },
  { id: 'whale-rock',    name: 'Whale Rock Capital',      domain: 'whalerock.com',      thesis: 'AI-thematic long/short — Tom Saberhagen track record on disruptive tech.',     cik: '0001581838',    files_13f: true  },
]

// ============ COMPANIES ============

export const companies: Omit<Company, 'created_at' | 'updated_at'>[] = [
  // -------- energy --------
  { id: 'ceg',         ticker: 'CEG',  name: 'Constellation Energy', domain: 'constellationenergy.com', layer_id: 'energy', weight: 6, private: false, position_held: false, conviction: 'medium', thesis: 'Three Mile Island restart for Microsoft — first dedicated nuclear-to-AI PPA.', share: null, notes: 'TMI Unit 1 restart targeted 2028.' },
  { id: 'vst',         ticker: 'VST',  name: 'Vistra',               domain: 'vistracorp.com',          layer_id: 'energy', weight: 5, private: false, position_held: false, conviction: 'medium', thesis: 'Nuclear (Comanche Peak) + gas peaker fleet positioned for DC load growth.', share: null, notes: null },
  { id: 'talen',       ticker: 'TLN',  name: 'Talen Energy',         domain: 'talenenergy.com',         layer_id: 'energy', weight: 5, private: false, position_held: false, conviction: 'medium', thesis: 'Susquehanna nuclear PPA with AWS at Cumulus DC.', share: null, notes: 'FERC interconnection dispute reshapes co-located DC model.' },
  { id: 'nee',         ticker: 'NEE',  name: 'NextEra Energy',       domain: 'nexteraenergy.com',       layer_id: 'energy', weight: 4, private: false, position_held: false, conviction: 'low',    thesis: 'Largest renewables developer; storage + nuclear restart optionality.', share: null, notes: null },
  { id: 'oklo',        ticker: 'OKLO', name: 'Oklo Inc.',            domain: 'oklo.com',                layer_id: 'energy', weight: 3, private: false, position_held: false, conviction: 'low',    thesis: 'Sam Altman–chaired SMR — speculative call option on AI-dedicated nuclear.', share: null, notes: 'No NRC license yet; revenue years out.' },

  // -------- equipment --------
  { id: 'asml',        ticker: 'ASML', name: 'ASML Holding',         domain: 'asml.com',                layer_id: 'equipment', weight: 9, private: false, position_held: false, conviction: 'high',   thesis: 'EUV monopoly. Every leading-edge AI chip needs ASML lithography.', share: 1.0,  notes: 'High-NA EUV ramp 2026–27 is the next gate.' },
  { id: 'amat',        ticker: 'AMAT', name: 'Applied Materials',    domain: 'appliedmaterials.com',    layer_id: 'equipment', weight: 6, private: false, position_held: false, conviction: 'medium', thesis: 'Broadest WFE portfolio — deposition, etch, CMP, advanced packaging.', share: null, notes: null },
  { id: 'lrcx',        ticker: 'LRCX', name: 'Lam Research',         domain: 'lamresearch.com',         layer_id: 'equipment', weight: 6, private: false, position_held: false, conviction: 'medium', thesis: 'Etch & deposition leader; critical for HBM and 3D NAND.', share: null, notes: null },
  { id: 'klac',        ticker: 'KLAC', name: 'KLA Corporation',      domain: 'kla.com',                 layer_id: 'equipment', weight: 5, private: false, position_held: false, conviction: 'medium', thesis: 'Process control / metrology monopoly; near-100% share at leading edge.', share: 0.85, notes: null },
  { id: 'tel',         ticker: null,   name: 'Tokyo Electron',       domain: 'tel.com',                 layer_id: 'equipment', weight: 5, private: false, position_held: false, conviction: 'medium', thesis: 'JP equipment giant; coater/developer monopoly.', share: null, notes: 'Ticker 8035.T (Tokyo).' },

  // -------- materials --------
  { id: 'sumco',       ticker: null,   name: 'SUMCO',                domain: 'sumcosi.com',             layer_id: 'materials', weight: 3, private: false, position_held: false, conviction: 'low',    thesis: '300mm silicon wafer duopoly with Shin-Etsu.', share: null, notes: 'Ticker 3436.T.' },
  { id: 'shin-etsu',   ticker: null,   name: 'Shin-Etsu Chemical',   domain: 'shinetsu.co.jp',          layer_id: 'materials', weight: 4, private: false, position_held: false, conviction: 'low',    thesis: 'Silicon wafers + photoresist; quietly indispensable.', share: null, notes: 'Ticker 4063.T.' },
  { id: 'entegris',    ticker: 'ENTG', name: 'Entegris',             domain: 'entegris.com',            layer_id: 'materials', weight: 3, private: false, position_held: false, conviction: 'low',    thesis: 'Process consumables — gas filtration, fluid handling.', share: null, notes: null },
  { id: 'jsr',         ticker: null,   name: 'JSR Corporation',      domain: 'jsr.co.jp',               layer_id: 'materials', weight: 3, private: false, position_held: false, conviction: 'low',    thesis: 'EUV photoresist leader. JIC take-private 2024.', share: null, notes: 'Now private under JIC.' },

  // -------- foundry --------
  { id: 'tsm',         ticker: 'TSM',  name: 'TSMC',                 domain: 'tsmc.com',                layer_id: 'foundry', weight: 10, private: false, position_held: false, conviction: 'high',   thesis: 'Sole leading-edge AI accelerator manufacturer at scale.', share: 0.90, notes: 'N3, N2 ramp + Arizona fab phase 2.' },
  { id: 'intc',        ticker: 'INTC', name: 'Intel Foundry',        domain: 'intel.com',               layer_id: 'foundry', weight: 4, private: false, position_held: false, conviction: 'low',    thesis: 'Foundry pivot under 18A; long road, real customers (MSFT, AMZN).', share: null, notes: 'Spun out / restructuring; execution risk.' },
  { id: 'samsung-fdy', ticker: null,   name: 'Samsung Foundry',      domain: 'samsungfoundry.com',      layer_id: 'foundry', weight: 5, private: false, position_held: false, conviction: 'low',    thesis: 'Second-source foundry; yield issues at leading edge.', share: null, notes: 'Segment of Samsung (005930.KS).' },
  { id: 'gfs',         ticker: 'GFS',  name: 'GlobalFoundries',      domain: 'gf.com',                  layer_id: 'foundry', weight: 3, private: false, position_held: false, conviction: 'low',    thesis: 'Mature-node specialist; not AI-leading-edge but critical for periphery.', share: null, notes: null },

  // -------- memory --------
  { id: 'mu',          ticker: 'MU',   name: 'Micron Technology',    domain: 'micron.com',              layer_id: 'memory', weight: 6, private: false, position_held: false, conviction: 'medium', thesis: 'HBM3e qualified at NVDA; ramping HBM4. Only US HBM supplier.', share: null, notes: 'HBM3e production sold out through 2026.' },
  { id: 'hynix',       ticker: null,   name: 'SK Hynix',             domain: 'skhynix.com',             layer_id: 'memory', weight: 9, private: false, position_held: false, conviction: 'high',   thesis: 'HBM dominance — NVDA primary supplier, >50% HBM share.', share: 0.55, notes: 'Ticker 000660.KS.' },
  { id: 'samsung-mem', ticker: null,   name: 'Samsung Memory',       domain: 'semiconductor.samsung.com', layer_id: 'memory', weight: 5, private: false, position_held: false, conviction: 'low',    thesis: 'HBM3e qualification delays; trying to recover share.', share: null, notes: 'Segment of 005930.KS.' },

  // -------- chips --------
  { id: 'nvda',        ticker: 'NVDA', name: 'NVIDIA',               domain: 'nvidia.com',              layer_id: 'chips', weight: 10, private: false, position_held: false, conviction: 'high',   thesis: 'CUDA moat + Blackwell + NVLink. Owns training, contested in inference.', share: 0.85, notes: 'Watching inference competition from custom silicon.' },
  { id: 'amd',         ticker: 'AMD',  name: 'AMD',                  domain: 'amd.com',                 layer_id: 'chips', weight: 7, private: false, position_held: true,  conviction: 'high',   thesis: 'MI300X/MI355X gaining traction; clearest #2 GPU narrative. Personal position.', share: 0.10, notes: 'Position held in portfolio.' },
  { id: 'avgo',        ticker: 'AVGO', name: 'Broadcom',             domain: 'broadcom.com',            layer_id: 'chips', weight: 7, private: false, position_held: false, conviction: 'medium', thesis: 'Custom ASIC for hyperscalers (GOOGL TPU, META MTIA) + Tomahawk switching.', share: null, notes: null },
  { id: 'mrvl',        ticker: 'MRVL', name: 'Marvell',              domain: 'marvell.com',             layer_id: 'chips', weight: 4, private: false, position_held: false, conviction: 'medium', thesis: 'DCI optics + custom silicon (AMZN Trainium connectivity).', share: null, notes: null },
  { id: 'arm',         ticker: 'ARM',  name: 'Arm Holdings',         domain: 'arm.com',                 layer_id: 'chips', weight: 5, private: false, position_held: false, conviction: 'medium', thesis: 'CPU IP in every datacenter — Grace, Graviton, Cobalt. SoftBank-controlled.', share: null, notes: null },
  { id: 'qcom',        ticker: 'QCOM', name: 'Qualcomm',             domain: 'qualcomm.com',            layer_id: 'chips', weight: 4, private: false, position_held: false, conviction: 'low',    thesis: 'Edge AI (mobile, auto, PC); not central to datacenter narrative.', share: null, notes: null },
  { id: 'groq',        ticker: null,   name: 'Groq',                 domain: 'groq.com',                layer_id: 'chips', weight: 3, private: true,  position_held: false, conviction: 'medium', thesis: 'LPU for low-latency inference; sovereign deals (Saudi).', share: null, notes: null },
  { id: 'cerebras',    ticker: null,   name: 'Cerebras Systems',     domain: 'cerebras.net',            layer_id: 'chips', weight: 3, private: true,  position_held: false, conviction: 'low',    thesis: 'Wafer-scale; G42 dependency is concentration risk.', share: null, notes: 'IPO filing pending CFIUS review of G42 exposure.' },
  { id: 'sambanova',   ticker: null,   name: 'SambaNova Systems',    domain: 'sambanova.ai',            layer_id: 'chips', weight: 2, private: true,  position_held: false, conviction: 'low',    thesis: 'Reconfigurable dataflow; enterprise inference focus.', share: null, notes: null },
  { id: 'tenstorrent', ticker: null,   name: 'Tenstorrent',          domain: 'tenstorrent.com',         layer_id: 'chips', weight: 3, private: true,  position_held: false, conviction: 'medium', thesis: 'Jim Keller; open-source RISC-V AI. Long fuse.', share: null, notes: null },

  // -------- infrastructure --------
  { id: 'crwv',        ticker: 'CRWV', name: 'CoreWeave',            domain: 'coreweave.com',           layer_id: 'infrastructure', weight: 9, private: false, position_held: true,  conviction: 'high',   thesis: 'GPU-cloud pure-play; MSFT/OpenAI anchor contracts. Personal position.', share: null, notes: 'Position held in portfolio. Concentration risk in MSFT.' },
  { id: 'nbis',        ticker: 'NBIS', name: 'Nebius Group',         domain: 'nebius.com',              layer_id: 'infrastructure', weight: 6, private: false, position_held: false, conviction: 'medium', thesis: 'Yandex-spinoff GPU cloud; EU-based, vertically integrated.', share: null, notes: null },
  { id: 'vrt',         ticker: 'VRT',  name: 'Vertiv',               domain: 'vertiv.com',              layer_id: 'infrastructure', weight: 6, private: false, position_held: false, conviction: 'medium', thesis: 'Liquid cooling + power distribution; pure pick-and-shovel.', share: null, notes: null },
  { id: 'anet',        ticker: 'ANET', name: 'Arista Networks',      domain: 'arista.com',              layer_id: 'infrastructure', weight: 6, private: false, position_held: false, conviction: 'medium', thesis: '400G/800G Ethernet for AI fabrics; META + MSFT anchors.', share: null, notes: 'Watching Ultra Ethernet vs InfiniBand share shift.' },
  { id: 'eqix',        ticker: 'EQIX', name: 'Equinix',              domain: 'equinix.com',             layer_id: 'infrastructure', weight: 5, private: false, position_held: false, conviction: 'medium', thesis: 'Interconnection-dense colo; AI tenant mix growing.', share: null, notes: null },
  { id: 'dlr',         ticker: 'DLR',  name: 'Digital Realty',       domain: 'digitalrealty.com',       layer_id: 'infrastructure', weight: 5, private: false, position_held: false, conviction: 'medium', thesis: 'Hyperscale colo REIT; benefiting from power-constrained markets.', share: null, notes: null },

  // -------- cloud --------
  { id: 'amzn',        ticker: 'AMZN', name: 'Amazon (AWS)',         domain: 'aws.amazon.com',          layer_id: 'cloud', weight: 9, private: false, position_held: false, conviction: 'high',   thesis: 'Anthropic anchor + Trainium ramp; largest cloud workload base.', share: 0.31, notes: null },
  { id: 'msft',        ticker: 'MSFT', name: 'Microsoft (Azure)',    domain: 'azure.microsoft.com',     layer_id: 'cloud', weight: 10, private: false, position_held: false, conviction: 'high',   thesis: 'OpenAI partnership + Copilot monetization; biggest single GPU buyer.', share: 0.25, notes: null },
  { id: 'googl',       ticker: 'GOOGL',name: 'Google Cloud',         domain: 'cloud.google.com',        layer_id: 'cloud', weight: 7, private: false, position_held: false, conviction: 'high',   thesis: 'TPU + Anthropic stake; only hyperscaler with full-stack custom silicon.', share: 0.11, notes: null },
  { id: 'orcl',        ticker: 'ORCL', name: 'Oracle (OCI)',         domain: 'oracle.com',              layer_id: 'cloud', weight: 6, private: false, position_held: false, conviction: 'medium', thesis: 'Stargate-era infrastructure deal with OpenAI; aggressive GPU buildout.', share: 0.03, notes: null },
  { id: 'ibm',         ticker: 'IBM',  name: 'IBM',                  domain: 'ibm.com',                 layer_id: 'cloud', weight: 3, private: false, position_held: false, conviction: 'low',    thesis: 'Granite models + Red Hat + Watsonx; enterprise focus, not frontier.', share: null, notes: null },

  // -------- labs --------
  { id: 'openai',      ticker: null,   name: 'OpenAI',               domain: 'openai.com',              layer_id: 'labs', weight: 10, private: true, position_held: false, conviction: 'high',   thesis: 'Frontier model leader; MSFT-aligned but Stargate diversifies compute.', share: null, notes: 'Capped-profit structure under restructure.' },
  { id: 'anthropic',   ticker: null,   name: 'Anthropic',            domain: 'anthropic.com',           layer_id: 'labs', weight: 9, private: true,  position_held: false, conviction: 'high',   thesis: 'Claude family; AMZN/GOOGL dual-cloud anchor — diversified compute.', share: null, notes: null },
  { id: 'xai',         ticker: null,   name: 'xAI',                  domain: 'x.ai',                    layer_id: 'labs', weight: 7, private: true,  position_held: false, conviction: 'medium', thesis: 'Colossus 200K-GPU cluster; vertically owned. Brand + funding risk.', share: null, notes: null },
  { id: 'meta-ai',     ticker: 'META', name: 'Meta AI',              domain: 'ai.meta.com',             layer_id: 'labs', weight: 8, private: false, position_held: false, conviction: 'high',   thesis: 'Open-weight Llama family + massive in-house GPU fleet.', share: null, notes: 'Capex run rate $60–70B/yr.' },
  { id: 'deepmind',    ticker: null,   name: 'Google DeepMind',      domain: 'deepmind.com',            layer_id: 'labs', weight: 8, private: true,  position_held: false, conviction: 'high',   thesis: 'Gemini family; tightly coupled to TPU stack. Segment of Alphabet.', share: null, notes: null },
  { id: 'mistral',     ticker: null,   name: 'Mistral AI',           domain: 'mistral.ai',              layer_id: 'labs', weight: 4, private: true,  position_held: false, conviction: 'medium', thesis: 'EU sovereign-AI champion; open-weight + premium API.', share: null, notes: null },
  { id: 'cohere',      ticker: null,   name: 'Cohere',               domain: 'cohere.com',              layer_id: 'labs', weight: 3, private: true,  position_held: false, conviction: 'low',    thesis: 'Enterprise-focused; struggling against frontier labs on capability.', share: null, notes: null },
]

// ============ BACKERS (investor → company) ============

export const companyBackers: CompanyBacker[] = [
  // OpenAI cap table
  { company_id: 'openai',     investor_id: 'khosla' },
  { company_id: 'openai',     investor_id: 'sequoia' },
  { company_id: 'openai',     investor_id: 'founders-fund' },
  { company_id: 'openai',     investor_id: 'thrive' },
  { company_id: 'openai',     investor_id: 'softbank' },
  // Anthropic cap table
  { company_id: 'anthropic',  investor_id: 'coatue' },
  { company_id: 'anthropic',  investor_id: 'greenoaks' },
  // xAI cap table
  { company_id: 'xai',        investor_id: 'a16z' },
  { company_id: 'xai',        investor_id: 'sequoia' },
  { company_id: 'xai',        investor_id: 'founders-fund' },
  // Mistral
  { company_id: 'mistral',    investor_id: 'a16z' },
  // Cohere
  { company_id: 'cohere',     investor_id: 'thrive' },
  // Cerebras
  { company_id: 'cerebras',   investor_id: 'ark' },
  // ARK public positions (Cathie Wood's published holdings)
  { company_id: 'nvda',       investor_id: 'ark' },
  { company_id: 'amd',        investor_id: 'ark' },
  { company_id: 'crwv',       investor_id: 'ark' },
  { company_id: 'tsm',        investor_id: 'ark' },
  { company_id: 'meta-ai',    investor_id: 'ark' },
  // Arm — SoftBank parent
  { company_id: 'arm',        investor_id: 'softbank' },
  // CoreWeave late-stage
  { company_id: 'crwv',       investor_id: 'coatue' },
  { company_id: 'crwv',       investor_id: 'greenoaks' },
]

// ============ FLOWS ============
// Direction = where the thing is moving. money: payer → receiver. compute: shipper → consumer.

export const flows: Omit<Flow, 'id' | 'created_at'>[] = [
  // ----- money: cloud → chips (GPU purchases) -----
  f('msft',      'company', 'nvda', 'company', 'money', 10, '~$50B+ FY26 GPU capex'),
  f('amzn',      'company', 'nvda', 'company', 'money', 8,  'GPU purchases alongside Trainium ramp'),
  f('googl',     'company', 'nvda', 'company', 'money', 6,  'GPU complement to TPU fleet'),
  f('orcl',      'company', 'nvda', 'company', 'money', 7,  'OCI aggressive GPU buildout for Stargate'),
  f('meta-ai',   'company', 'nvda', 'company', 'money', 8,  'H100/B200 for Llama training'),
  f('xai',       'company', 'nvda', 'company', 'money', 7,  'Colossus 200K H100/H200 cluster'),
  f('crwv',      'company', 'nvda', 'company', 'money', 9,  'Largest single non-hyperscaler buyer'),
  f('nbis',      'company', 'nvda', 'company', 'money', 6,  null),

  // ----- money: chips → foundry -----
  f('nvda',      'company', 'tsm',  'company', 'money', 10, 'Largest TSMC customer at N3/N4'),
  f('amd',       'company', 'tsm',  'company', 'money', 6,  'MI300/MI350 series'),
  f('avgo',      'company', 'tsm',  'company', 'money', 5,  'Custom ASIC + Tomahawk silicon'),
  f('qcom',      'company', 'tsm',  'company', 'money', 5,  null),
  f('arm',       'company', 'tsm',  'company', 'money', 2,  'Indirect via partner products'),

  // ----- money: foundry → equipment -----
  f('tsm',         'company', 'asml', 'company', 'money', 8,  'EUV tool purchases'),
  f('tsm',         'company', 'amat', 'company', 'money', 6,  null),
  f('tsm',         'company', 'lrcx', 'company', 'money', 6,  null),
  f('tsm',         'company', 'klac', 'company', 'money', 5,  null),
  f('tsm',         'company', 'tel',  'company', 'money', 5,  null),
  f('samsung-fdy', 'company', 'asml', 'company', 'money', 5,  null),
  f('intc',        'company', 'asml', 'company', 'money', 4,  'High-NA EUV early adopter'),

  // ----- money: foundry → materials -----
  f('tsm',       'company', 'sumco',     'company', 'money', 4, null),
  f('tsm',       'company', 'shin-etsu', 'company', 'money', 4, null),
  f('tsm',       'company', 'entegris',  'company', 'money', 3, null),
  f('tsm',       'company', 'jsr',       'company', 'money', 3, 'EUV photoresist'),

  // ----- money: cloud → energy (PPAs) -----
  f('msft',      'company', 'ceg',   'company', 'money', 6, 'Three Mile Island PPA — first nuclear-to-AI deal'),
  f('amzn',      'company', 'talen', 'company', 'money', 6, 'Susquehanna nuclear at Cumulus DC'),
  f('amzn',      'company', 'vst',   'company', 'money', 4, null),
  f('googl',     'company', 'nee',   'company', 'money', 4, 'Solar + storage PPAs'),
  f('msft',      'company', 'oklo',  'company', 'money', 2, 'Intent of interest; far-future SMR'),

  // ----- money: cloud → infrastructure (DC build) -----
  f('msft',      'company', 'crwv', 'company', 'money', 9, '~$10B+ multi-year compute lease'),
  f('amzn',      'company', 'vrt',  'company', 'money', 5, null),
  f('crwv',      'company', 'vrt',  'company', 'money', 4, null),
  f('eqix',      'company', 'vrt',  'company', 'money', 3, null),
  f('amzn',      'company', 'eqix', 'company', 'money', 4, null),
  f('msft',      'company', 'eqix', 'company', 'money', 3, null),
  f('amzn',      'company', 'dlr',  'company', 'money', 4, null),
  f('msft',      'company', 'dlr',  'company', 'money', 3, null),
  f('msft',      'company', 'anet', 'company', 'money', 4, '400G AI fabric'),
  f('amzn',      'company', 'anet', 'company', 'money', 4, null),
  f('meta-ai',   'company', 'anet', 'company', 'money', 5, 'AI Zone fabric'),

  // ----- money: cloud ↔ labs -----
  f('msft',      'company', 'openai',    'company', 'money', 10, '~$13B+ MSFT investment cumulative'),
  f('openai',    'company', 'msft',      'company', 'money', 9,  'Azure compute consumption'),
  f('amzn',      'company', 'anthropic', 'company', 'money', 9,  '$8B total investment commitment'),
  f('anthropic', 'company', 'amzn',      'company', 'money', 8,  'Trainium + GPU compute'),
  f('googl',     'company', 'anthropic', 'company', 'money', 7,  '~$2B investment + TPU compute'),

  // ----- compute: chips → consumers -----
  f('nvda', 'company', 'crwv',    'company', 'compute', 9, 'Blackwell shipments'),
  f('nvda', 'company', 'msft',    'company', 'compute', 9, null),
  f('nvda', 'company', 'amzn',    'company', 'compute', 8, null),
  f('nvda', 'company', 'googl',   'company', 'compute', 6, null),
  f('nvda', 'company', 'meta-ai', 'company', 'compute', 8, null),
  f('nvda', 'company', 'xai',     'company', 'compute', 8, 'Direct DGX Colossus deals'),
  f('nvda', 'company', 'orcl',    'company', 'compute', 7, null),
  f('nvda', 'company', 'openai',  'company', 'compute', 6, 'Direct DGX cluster deliveries'),
  f('amd',  'company', 'msft',    'company', 'compute', 3, 'MI300X adoption'),
  f('amd',  'company', 'meta-ai', 'company', 'compute', 3, null),

  // ----- compute: foundry → chips (wafers/silicon) -----
  f('tsm',         'company', 'nvda', 'company', 'compute', 10, 'N4P/N3 wafers'),
  f('tsm',         'company', 'amd',  'company', 'compute', 6,  null),
  f('tsm',         'company', 'avgo', 'company', 'compute', 5,  null),
  f('tsm',         'company', 'qcom', 'company', 'compute', 5,  null),
  f('samsung-fdy', 'company', 'qcom', 'company', 'compute', 3,  null),

  // ----- compute: memory → chips (HBM bonded onto GPUs) -----
  f('hynix',       'company', 'nvda', 'company', 'compute', 9, 'HBM3e primary supplier (~50% share at NVDA)'),
  f('mu',          'company', 'nvda', 'company', 'compute', 5, 'HBM3e qualified 2024'),
  f('samsung-mem', 'company', 'nvda', 'company', 'compute', 4, 'HBM3e re-qualification in progress'),
  f('hynix',       'company', 'amd',  'company', 'compute', 5, null),

  // ----- compute: infra → cloud/labs -----
  f('crwv', 'company', 'msft',   'company', 'compute', 6, 'Compute leased back to Azure'),
  f('crwv', 'company', 'openai', 'company', 'compute', 7, 'Direct compute supply'),
  f('nbis', 'company', 'openai', 'company', 'compute', 4, null),
  f('msft', 'company', 'openai', 'company', 'compute', 9, 'Azure-hosted training'),
  f('amzn', 'company', 'anthropic', 'company', 'compute', 8, 'Trainium + GPU'),
  f('googl','company', 'anthropic', 'company', 'compute', 4, 'TPU compute'),

  // ----- equipment: equipment → foundry -----
  f('asml', 'company', 'tsm',         'company', 'equipment', 10, 'EUV scanners — sole supplier'),
  f('asml', 'company', 'samsung-fdy', 'company', 'equipment', 6,  null),
  f('asml', 'company', 'intc',        'company', 'equipment', 5,  'High-NA EUV first'),
  f('amat', 'company', 'tsm',         'company', 'equipment', 6,  null),
  f('lrcx', 'company', 'tsm',         'company', 'equipment', 6,  null),
  f('klac', 'company', 'tsm',         'company', 'equipment', 5,  null),
  f('tel',  'company', 'tsm',         'company', 'equipment', 5,  null),

  // ----- energy → cloud/infrastructure -----
  f('ceg',   'company', 'msft', 'company', 'energy', 6, 'TMI nuclear PPA'),
  f('talen', 'company', 'amzn', 'company', 'energy', 6, 'Cumulus DC'),
  f('vst',   'company', 'amzn', 'company', 'energy', 4, null),
  f('nee',   'company', 'googl','company', 'energy', 4, null),
  f('oklo',  'company', 'msft', 'company', 'energy', 2, 'Future SMR optionality'),

  // ----- intel: labs ↔ labs (talent / paper lineage) -----
  f('openai', 'company', 'anthropic', 'company', 'intel', 5, 'Founder lineage — Amodeis ex-OpenAI'),
  f('googl',  'company', 'openai',    'company', 'intel', 4, 'Transformer paper provenance'),
  f('deepmind','company','openai',    'company', 'intel', 3, null),

  // ----- venture: investor → company -----
  f('khosla',        'investor', 'openai',    'company', 'venture', 7,  '2019 first major check'),
  f('sequoia',       'investor', 'openai',    'company', 'venture', 6,  null),
  f('founders-fund', 'investor', 'openai',    'company', 'venture', 5,  null),
  f('thrive',        'investor', 'openai',    'company', 'venture', 8,  '2024 $1.5B+ tender lead'),
  f('softbank',      'investor', 'openai',    'company', 'venture', 10, '2025 $40B lead'),
  f('coatue',        'investor', 'anthropic', 'company', 'venture', 6,  null),
  f('greenoaks',     'investor', 'anthropic', 'company', 'venture', 4,  null),
  f('a16z',          'investor', 'xai',       'company', 'venture', 7,  null),
  f('sequoia',       'investor', 'xai',       'company', 'venture', 5,  null),
  f('founders-fund', 'investor', 'xai',       'company', 'venture', 5,  null),
  f('a16z',          'investor', 'mistral',   'company', 'venture', 5,  null),
  f('thrive',        'investor', 'cohere',    'company', 'venture', 3,  null),
  f('ark',           'investor', 'nvda',      'company', 'venture', 5,  'ARKK/ARKQ public position'),
  f('ark',           'investor', 'amd',       'company', 'venture', 3,  null),
  f('ark',           'investor', 'crwv',      'company', 'venture', 5,  null),
  f('ark',           'investor', 'tsm',       'company', 'venture', 3,  null),
  f('ark',           'investor', 'meta-ai',   'company', 'venture', 4,  null),
  f('ark',           'investor', 'cerebras',  'company', 'venture', 2,  null),
  f('softbank',      'investor', 'arm',       'company', 'venture', 10, 'Parent — 90%+ ownership'),
  f('coatue',        'investor', 'crwv',      'company', 'venture', 4,  null),
  f('greenoaks',     'investor', 'crwv',      'company', 'venture', 3,  null),
]

// ============ BOTTLENECKS ============

export const bottlenecks: Omit<Bottleneck, 'created_at' | 'updated_at'>[] = [
  {
    id: 'cowos',
    name: 'CoWoS Advanced Packaging',
    between_above: 'chips',
    between_below: 'foundry',
    layer_id: 'foundry',
    severity: 'critical',
    status: 'active',
    timeline: 'Capacity 2× by end-2026 but still trails demand.',
    evidence: 'TSMC explicitly capacity-limited; H200 / Blackwell allocation rationed.',
  },
  {
    id: 'hbm-supply',
    name: 'HBM3e / HBM4 Supply',
    between_above: 'chips',
    between_below: 'memory',
    layer_id: 'memory',
    severity: 'critical',
    status: 'active',
    timeline: 'HBM3e sold out through 2026. HBM4 ramps 2H26.',
    evidence: 'Hynix, Micron capacity pre-sold; Samsung re-qualification slip.',
  },
  {
    id: 'n3-fab',
    name: 'TSMC N3 / N2 Fab Capacity',
    between_above: 'foundry',
    between_below: 'equipment',
    layer_id: 'foundry',
    severity: 'high',
    status: 'active',
    timeline: 'N2 risk production 2H25; volume ramp 2026–27.',
    evidence: 'NVDA / AMD / AAPL / QCOM all competing for the same wafer slots.',
  },
  {
    id: 'grid-power',
    name: 'US Grid Power Capacity',
    between_above: 'infrastructure',
    between_below: 'energy',
    layer_id: 'infrastructure',
    severity: 'high',
    status: 'active',
    timeline: 'PJM, ERCOT interconnect queues 5–7 yrs in hot markets.',
    evidence: 'Northern Virginia moratoriums; AEP load forecast revisions; nuclear restart push.',
  },
  {
    id: 'euv-throughput',
    name: 'ASML EUV Scanner Throughput',
    between_above: 'foundry',
    between_below: 'equipment',
    layer_id: 'equipment',
    severity: 'medium',
    status: 'active',
    timeline: 'High-NA EUV ramps 2026–27 — gate to N2 / A14 volumes.',
    evidence: 'Single-source. Backlog visible in ASML guidance.',
  },
]

export const bottleneckBeneficiaries: BottleneckBeneficiary[] = [
  // CoWoS scarcity → TSMC pricing power, packaging equipment vendors
  { bottleneck_id: 'cowos',          company_id: 'tsm' },
  { bottleneck_id: 'cowos',          company_id: 'amat' },
  { bottleneck_id: 'cowos',          company_id: 'lrcx' },
  // HBM scarcity → memory winners
  { bottleneck_id: 'hbm-supply',     company_id: 'hynix' },
  { bottleneck_id: 'hbm-supply',     company_id: 'mu' },
  { bottleneck_id: 'hbm-supply',     company_id: 'samsung-mem' },
  // N3 fab scarcity → TSMC + ASML
  { bottleneck_id: 'n3-fab',         company_id: 'tsm' },
  { bottleneck_id: 'n3-fab',         company_id: 'asml' },
  // Grid scarcity → utilities + Vertiv
  { bottleneck_id: 'grid-power',     company_id: 'ceg' },
  { bottleneck_id: 'grid-power',     company_id: 'vst' },
  { bottleneck_id: 'grid-power',     company_id: 'talen' },
  { bottleneck_id: 'grid-power',     company_id: 'nee' },
  { bottleneck_id: 'grid-power',     company_id: 'vrt' },
  // EUV throughput → ASML monopoly + foundries with allocation
  { bottleneck_id: 'euv-throughput', company_id: 'asml' },
  { bottleneck_id: 'euv-throughput', company_id: 'tsm' },
]

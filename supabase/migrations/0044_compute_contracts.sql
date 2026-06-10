-- Migration 0044 — Phase 8: Compute Flow (buyer→seller contract layer).
--
-- The 3D graph's `flows` edges show qualitative relationships (money/compute/
-- energy). What they can't answer is the question every compute-scarcity
-- analysis ends at: WHO is contractually buying HOW MUCH compute from WHOM,
-- for how many dollars and gigawatts. This table stores the publicly
-- REPORTED mega-deals (OpenAI↔NVIDIA, Anthropic↔Google TPU, Meta↔CoreWeave…)
-- with a source attribution per row so every number is checkable.
--
-- Curation rules (hand-seeded, $0 data sources):
--   * Only deals publicly announced or credibly reported by a named outlet.
--   * value_usd_b is the REPORTED headline value — these are commitments /
--     ceilings ("up to"), not recognized revenue. NULL when undisclosed.
--   * status: 'announced' (press release) vs 'reported' (credible press,
--     not confirmed by both parties).
--   * Idempotent: ON CONFLICT DO NOTHING on the natural key.

create table if not exists compute_contracts (
  id          uuid primary key default gen_random_uuid(),
  buyer_id    text not null references companies(id),
  seller_id   text not null references companies(id),
  kind        text not null check (kind in
                ('gpu_purchase','cloud_capacity','custom_silicon','equity_compute','jv_program')),
  value_usd_b numeric,          -- reported headline $B; NULL = undisclosed
  gigawatts   numeric,          -- reported GW where stated
  announced   date not null,
  status      text not null default 'announced' check (status in ('announced','reported')),
  headline    text not null,
  source      text not null,    -- publisher + month, e.g. 'Reuters, Sep 2025'
  source_url  text,
  notes       text,
  created_at  timestamptz default now(),
  unique (buyer_id, seller_id, announced, kind)
);

create index if not exists idx_compute_contracts_buyer  on compute_contracts(buyer_id);
create index if not exists idx_compute_contracts_seller on compute_contracts(seller_id);

alter table compute_contracts enable row level security;
do $$ begin
  create policy "anon read compute_contracts" on compute_contracts for select using (true);
exception when duplicate_object then null; end $$;

insert into compute_contracts
  (buyer_id, seller_id, kind, value_usd_b, gigawatts, announced, status, headline, source, notes)
values
  -- ---------------- OpenAI: the largest buyer in history ----------------
  ('openai','nvda','equity_compute',100,10,'2025-09-22','announced',
   'NVIDIA to invest up to $100B as OpenAI deploys 10 GW of NVIDIA systems',
   'NVIDIA newsroom / Reuters, Sep 2025',
   'Letter of intent; investment staged per gigawatt deployed.'),
  ('openai','amd','gpu_purchase',null,6,'2025-10-06','announced',
   'OpenAI to deploy 6 GW of AMD Instinct GPUs; warrant for up to 160M AMD shares',
   'AMD press release, Oct 2025',
   'AMD said deal could generate "tens of billions" in revenue; warrant vests with deployment milestones.'),
  ('openai','avgo','custom_silicon',null,10,'2025-10-13','announced',
   'OpenAI + Broadcom to co-develop and deploy 10 GW of custom AI accelerators',
   'Broadcom press release / Reuters, Oct 2025',
   'Racks deployed from 2026 through 2029; OpenAI designs, Broadcom develops + deploys.'),
  ('openai','orcl','cloud_capacity',300,4.5,'2025-09-10','reported',
   'OpenAI ~$300B Oracle Cloud agreement over ~5 years (Stargate capacity)',
   'WSJ / Reuters, Sep 2025',
   'One of the largest cloud contracts ever reported; tied to Stargate sites.'),
  ('openai','crwv','cloud_capacity',22.4,null,'2025-09-25','announced',
   'OpenAI–CoreWeave contracts totaling ~$22.4B after third expansion',
   'CoreWeave filings / Reuters, Sep 2025',
   'Initial $11.9B (Mar 2025) + expansions; CoreWeave equity granted to OpenAI.'),
  ('openai','amzn','cloud_capacity',38,null,'2025-11-03','announced',
   'OpenAI signs $38B multi-year AWS compute agreement',
   'AWS / Reuters, Nov 2025',
   'First major OpenAI workload commitment outside Azure after restructuring.'),
  ('openai','msft','cloud_capacity',250,null,'2025-10-28','announced',
   'OpenAI commits to ~$250B incremental Azure purchases in restructured partnership',
   'Microsoft blog / Reuters, Oct 2025',
   'Microsoft holds ~27% of OpenAI Group PBC post-restructuring; right of first refusal dropped.'),
  ('openai','softbank','jv_program',500,7,'2025-01-21','announced',
   'Stargate: OpenAI + SoftBank + Oracle JV targeting $500B of AI infrastructure',
   'OpenAI announcement, Jan 2025',
   'Program-level commitment across TX/NM/OH sites; build-out bumpy but ongoing.'),

  -- ---------------- Anthropic: multi-cloud + multi-silicon ----------------
  ('anthropic','googl','cloud_capacity',null,1,'2025-10-23','announced',
   'Anthropic to use up to 1M Google TPUs; >1 GW online in 2026',
   'Anthropic / Reuters, Oct 2025',
   'Reported value "tens of billions of dollars"; Anthropic stays multi-cloud.'),
  ('anthropic','amzn','equity_compute',8,1,'2024-11-22','announced',
   'Amazon total $8B investment; Project Rainier Trainium2 cluster for Claude',
   'Amazon / Anthropic, Nov 2024',
   'AWS named primary training partner; Rainier ~1 GW-scale Trainium capacity.'),
  ('anthropic','msft','cloud_capacity',30,1,'2025-11-18','announced',
   'Anthropic commits to purchase $30B of Azure compute capacity',
   'Microsoft / Reuters, Nov 2025',
   'Part of tripartite deal: Microsoft invests up to $5B in Anthropic.'),
  ('anthropic','nvda','equity_compute',10,1,'2025-11-18','announced',
   'NVIDIA to invest up to $10B; Anthropic adopts up to 1 GW Grace-Vera systems',
   'NVIDIA / Reuters, Nov 2025',
   'First large direct NVIDIA–Anthropic tie-up; previously TPU/Trainium-centric.'),

  -- ---------------- xAI / Meta / Microsoft ----------------
  ('xai','nvda','equity_compute',2,null,'2025-10-07','reported',
   'NVIDIA backs xAI Colossus 2 via ~$20B SPV (equity + GPU offtake)',
   'Reuters / Bloomberg, Oct 2025',
   'NVIDIA participation reported up to $2B of ~$20B special-purpose vehicle.'),
  ('meta-ai','crwv','cloud_capacity',14.2,null,'2025-09-30','announced',
   'Meta signs $14.2B cloud-compute agreement with CoreWeave',
   'Reuters, Sep 2025',
   'CoreWeave diversifies past Microsoft; capacity through 2031.'),
  ('meta-ai','googl','cloud_capacity',10,null,'2025-08-21','reported',
   'Meta to spend ~$10B+ on Google Cloud over six years',
   'Reuters / The Information, Aug 2025',
   'First major Meta workload on a rival hyperscaler cloud.'),
  ('msft','crwv','cloud_capacity',10,null,'2024-10-01','reported',
   'Microsoft–CoreWeave GPU capacity contracts (~62% of CoreWeave 2024 revenue)',
   'CoreWeave S-1, Mar 2025',
   'Roughly $10B committed across multi-year agreements per IPO filings.')
on conflict (buyer_id, seller_id, announced, kind) do nothing;

-- Migration 0056 — Contract ledger: every disclosed AI compute / hosting /
-- power / equipment contract, one row per disclosure, sourced to the filing.
--
-- Why a new table and not compute_contracts (0044): that table is a hand-
-- curated list of ~16 headline mega-deals keyed on (buyer, seller, date,
-- kind) with a free-text "Reuters, Sep 2025" source. The ledger is the
-- opposite shape: mechanically extracted from SEC filings, one row per
-- disclosure event (an LOI, then the definitive lease, then an expansion
-- are three rows), with the fields a credit or equity analyst actually
-- underwrites on — MW, GPUs, term, total value, prepayment, guarantor —
-- and a verbatim excerpt so every number is checkable against the source.
--
-- Nulls mean "not stated in the filing". Nothing is inferred to fill them.

create table if not exists contract_disclosures (
  id                    uuid primary key default gen_random_uuid(),

  -- Parties. *_id links to companies when we can resolve the name; *_name
  -- is always the name as disclosed. "customer_disclosed = false" covers
  -- "a leading hyperscaler" / "an investment-grade counterparty".
  provider_id           text references companies(id),
  provider_name         text not null,
  customer_id           text references companies(id),
  customer_name         text,
  customer_disclosed    boolean not null default true,
  guarantor_id          text references companies(id),
  guarantor_name        text,

  -- What was contracted.
  kind                  text not null check (kind in (
                          'colocation_lease',     -- powered shell / turnkey space + power
                          'gpu_cloud_capacity',   -- provider runs the GPUs, sells compute
                          'hosting_services',     -- managed hosting of customer-owned hardware
                          'power_supply',         -- PPA / utility / behind-the-meter power
                          'equipment_purchase',   -- GPUs, servers, turbines, transformers
                          'financing',            -- debt / prepayment / backstop tied to a contract
                          'other')),
  site                  text,
  capacity_mw           numeric,
  gpu_count             integer,
  gpu_model             text,
  term_months           integer,
  start_date            date,
  end_date              date,
  total_value_usd       numeric,
  annual_value_usd      numeric,
  prepayment_usd        numeric,
  has_extension_option  boolean,
  extension_note        text,
  escalator_pct         numeric,

  -- Lifecycle of the disclosure itself.
  status                text not null check (status in (
                          'loi','definitive','amended','expanded','terminated','completed')),

  -- Provenance. Every row points at the document it came from.
  source_form           text not null,        -- 8-K, 6-K, 10-K, 10-Q, S-1, press
  source_accession      text,
  source_url            text,
  source_note           text,                 -- when there is no URL (curated press rows)
  filing_date           date not null,
  filer_id              text references companies(id),
  excerpt               text,                 -- verbatim, <= 800 chars
  extractor             text not null,        -- model id, or 'manual'
  confidence            numeric,              -- 0..1 as declared by the extractor
  review_status         text not null default 'auto'
                          check (review_status in ('auto','verified','rejected')),

  -- Deterministic: filer|accession|customer|kind|site — so re-running the
  -- extractor over the same filing updates rather than duplicates.
  dedupe_key            text not null unique,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_cd_provider   on contract_disclosures(provider_id);
create index if not exists idx_cd_customer   on contract_disclosures(customer_id);
create index if not exists idx_cd_filing     on contract_disclosures(filing_date desc);
create index if not exists idx_cd_kind       on contract_disclosures(kind);
create index if not exists idx_cd_review     on contract_disclosures(review_status);

-- Which filings have been looked at, so the backfill and the nightly cron
-- never re-read (or re-pay for) the same document.
create table if not exists contract_filing_scans (
  accession             text primary key,
  filer_id              text references companies(id),
  form                  text not null,
  filing_date           date not null,
  prefilter_hit         boolean not null,
  documents_read        integer not null default 0,
  chars_read            integer not null default 0,
  extracted             integer not null default 0,
  extractor             text,
  error                 text,
  scanned_at            timestamptz not null default now()
);

create index if not exists idx_cfs_filer on contract_filing_scans(filer_id, filing_date desc);

-- Public product: anyone may read the ledger. The scan log is internal.
alter table contract_disclosures  enable row level security;
alter table contract_filing_scans enable row level security;
do $$ begin
  create policy "anon read contract_disclosures"
    on contract_disclosures for select to anon, authenticated using (true);
exception when duplicate_object then null; end $$;

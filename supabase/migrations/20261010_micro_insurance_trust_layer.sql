-- Micro-insurance trust layer — evidence store and insurer rails.
--
-- SCOPE, STATED FIRST: this application is not an insurer. It cannot
-- underwrite, cannot price risk, and cannot adjudicate a claim. Every table
-- here is a record of something a LICENSED INSURER decided or something a user
-- declared. The risk sits with the insurer named in `insurers`.
--
-- What is deliberately NOT in this schema:
--   * No underwriting decision made by this application.
--   * No claim approval that did not arrive signed from the insurer.
--   * No raw evidence bytes. Files live in Supabase Storage; these tables keep
--     the path, the SHA-256 and the timestamps. The contract records the hash
--     only, so the evidence can be proven unaltered without being on-chain.
--
-- Access model, same as the rest of this project: clients read their own rows
-- through policies keyed on `current_did()` and have NO write policy at all.
-- Every insert and update is server-side with the secret key, after a Privy
-- access token has been verified. See docs/insurer-api.md.

-- ───────────────────────── enums ─────────────────────────

do $$ begin
  create type insurer_status as enum ('prospective', 'active', 'suspended');
exception when duplicate_object then null; end $$;

-- How exposure is measured for a product. docs/limitations.md,
-- "How exposure is measured, and what each measure cannot stop",
-- says what each basis can and cannot detect.
do $$ begin
  create type exposure_basis as enum ('declaration_plus_device', 'gps_trace', 'photo_provenance');
exception when duplicate_object then null; end $$;

do $$ begin
  create type attestation_verdict as enum ('passed', 'failed', 'unavailable');
exception when duplicate_object then null; end $$;

do $$ begin
  create type attest_platform as enum ('play_integrity', 'app_attest', 'none');
exception when duplicate_object then null; end $$;

do $$ begin
  create type policy_status as enum
    ('quoted', 'premium_escrowed', 'active', 'expired', 'cancelled', 'claim_paid');
exception when duplicate_object then null; end $$;

do $$ begin
  create type claim_status as enum
    ('submitted', 'under_review', 'approved', 'rejected', 'paid', 'withdrawn');
exception when duplicate_object then null; end $$;

do $$ begin
  create type evidence_kind as enum
    ('photo', 'police_report', 'repair_invoice', 'assessor_attestation', 'other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type insurer_decision as enum ('approve', 'reject');
exception when duplicate_object then null; end $$;

do $$ begin
  create type settlement_status as enum ('scheduled', 'sent', 'reconciled', 'failed');
exception when duplicate_object then null; end $$;

-- ───────────────────────── the insurer ─────────────────────────

-- The risk-bearing entity. Nothing in this system pays a claim without a
-- signature from the `signer_address` of an insurer whose status is 'active'.
create table if not exists public.insurers (
  id                      bigserial primary key,
  legal_name              text not null check (char_length(legal_name) between 2 and 160),
  -- IRDAI registration of the insurer. Unverified by this application: it is
  -- transcribed from the partner's certificate during onboarding, and must be
  -- checked against the IRDAI register by a human before status goes 'active'.
  irdai_registration_no   text not null,
  -- The key whose ECDSA signature MicroCover.sol requires to settle a claim.
  signer_address          text not null check (signer_address ~ '^0x[0-9a-fA-F]{40}$'),
  api_base_url            text not null check (api_base_url ~ '^https://'),
  status                  insurer_status not null default 'prospective',
  onboarded_at            timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (signer_address)
);

comment on table public.insurers is
  'The licensed, risk-bearing counterparty. This application is never the insurer. '
  'irdai_registration_no is transcribed at onboarding and must be verified by a human '
  'against the IRDAI register before status becomes active.';

-- A product the insurer has filed and this application may sell on its behalf.
create table if not exists public.cover_products (
  id                      bigserial primary key,
  insurer_id              bigint not null references public.insurers(id) on delete restrict,
  code                    text not null,
  display_name            text not null check (char_length(display_name) between 2 and 80),
  -- How exposure is measured for this product, and therefore what a
  -- declaration has to contain before a policy can be quoted.
  basis                   exposure_basis not null,
  premium_paise           bigint not null check (premium_paise > 0),
  coverage_paise          bigint not null check (coverage_paise > 0),
  duration_seconds        bigint not null check (duration_seconds between 600 and 31536000),
  -- The filed policy wording. Its SHA-256 is what goes on-chain as
  -- policyTermsHash, so a later edit to the PDF is detectable.
  terms_sha256            text not null check (terms_sha256 ~ '^[0-9a-f]{64}$'),
  terms_pdf_path          text,
  -- The insurer's IRDAI product filing reference. Null means NOT FILED, and a
  -- product that is not filed must not be sold; the guard below enforces it.
  irdai_filing_reference  text,
  sellable                boolean not null default false,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (insurer_id, code),
  -- A product cannot be marked sellable without a filing reference. Product
  -- approval is IRDAI's, never this application's.
  constraint sellable_needs_a_filing
    check (not sellable or irdai_filing_reference is not null),
  -- Coverage below the premium would be a worse-than-nothing product.
  constraint coverage_exceeds_premium
    check (coverage_paise > premium_paise)
);

-- ───────────────────────── policies ─────────────────────────

create table if not exists public.policies (
  id                  bigserial primary key,
  product_id          bigint not null references public.cover_products(id) on delete restrict,
  -- The insured party. A claim from anyone else is rejected by the guard below.
  insured_did         text not null,
  insured_address     text not null check (insured_address ~ '^0x[0-9a-fA-F]{40}$'),
  premium_paise       bigint not null check (premium_paise > 0),
  coverage_paise      bigint not null check (coverage_paise > 0),
  -- The cover window. "Was the policy active at the time of the event" is
  -- answered from these two columns and nothing else.
  starts_at           timestamptz not null,
  ends_at             timestamptz not null,
  terms_sha256        text not null check (terms_sha256 ~ '^[0-9a-f]{64}$'),
  status              policy_status not null default 'quoted',
  -- MicroCover.sol policyId, once the premium has been escrowed on-chain.
  onchain_id          bigint,
  activated_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint window_is_forward check (ends_at > starts_at)
);

create index if not exists policies_insured_idx on public.policies(insured_did);
create index if not exists policies_window_idx  on public.policies(starts_at, ends_at);

comment on table public.policies is
  'A mirror of a policy the insurer bound. Rows here never create cover by themselves: '
  'status becomes active only after the insurer confirms the premium and binds the risk.';

-- §1.1 — exposure measurement. One row per policy, written before the policy
-- is quoted. What each basis cannot stop is documented in docs/limitations.md;
-- nothing here is claimed to be fraud-proof.
create table if not exists public.exposure_declarations (
  id                        bigserial primary key,
  policy_id                 bigint not null references public.policies(id) on delete cascade,
  basis                     exposure_basis not null,
  -- What the user declared, in their own words, plus its hash and their
  -- signature over that hash. The signature is what makes the declaration
  -- attributable later; the text alone would not be.
  declaration_text          text not null check (char_length(declaration_text) between 1 and 2000),
  declaration_sha256        text not null check (declaration_sha256 ~ '^[0-9a-f]{64}$'),
  declaration_signature     text check (declaration_signature ~ '^0x[0-9a-fA-F]{130}$'),
  -- Device attestation. 'unavailable' is recorded honestly rather than being
  -- treated as a pass: a rooted or unsupported device is a known gap, not a
  -- silent success.
  platform                  attest_platform not null default 'none',
  attestation               attestation_verdict not null default 'unavailable',
  attestation_payload_sha256 text check (attestation_payload_sha256 ~ '^[0-9a-f]{64}$'),
  -- For gps_trace products. The trace itself is a file in Storage; only its
  -- hash and the sample count live here.
  trace_sha256              text check (trace_sha256 ~ '^[0-9a-f]{64}$'),
  trace_sample_count        integer check (trace_sample_count >= 0),
  -- For photo_provenance products. c2pa_verified false means the photo had no
  -- usable provenance, which the insurer sees rather than this app hiding it.
  c2pa_verified             boolean,
  collected_at              timestamptz not null,
  created_at                timestamptz not null default now(),
  unique (policy_id)
);

-- ───────────────────────── claims and evidence ─────────────────────────

create table if not exists public.claims (
  id                     bigserial primary key,
  policy_id              bigint not null references public.policies(id) on delete restrict,
  claimant_did           text not null,
  -- When the insured event happened, as distinct from when it was reported.
  -- The guard below requires this to fall inside the policy window.
  event_at               timestamptz not null,
  reported_at            timestamptz not null default now(),
  description            text not null check (char_length(description) between 1 and 2000),
  -- Hash over the ordered evidence hashes. This is the single value that goes
  -- on-chain as evidenceHash, so the whole bundle is committed to at once.
  evidence_bundle_sha256 text check (evidence_bundle_sha256 ~ '^[0-9a-f]{64}$'),
  status                 claim_status not null default 'submitted',
  onchain_id             bigint,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists claims_policy_idx on public.claims(policy_id);
create index if not exists claims_claimant_idx on public.claims(claimant_did);

-- §1.2 — the evidence itself. Timestamps and hashes, never the bytes.
create table if not exists public.claim_evidence (
  id                bigserial primary key,
  claim_id          bigint not null references public.claims(id) on delete cascade,
  kind              evidence_kind not null,
  -- Supabase Storage path. The bytes stay there; this row is the index.
  storage_path      text not null,
  sha256            text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size         bigint not null check (byte_size > 0),
  mime_type         text not null,
  -- When the evidence was created (EXIF, invoice date, report date) versus
  -- when it reached us. A gap between the two is exactly what an assessor
  -- wants to see, so both are kept.
  captured_at       timestamptz,
  uploaded_at       timestamptz not null default now(),
  uploaded_by_did   text not null,
  -- For assessor_attestation: who signed it. An assessor's licence number is
  -- recorded as given and is not verified by this application.
  assessor_licence_no text,
  c2pa_verified     boolean,
  created_at        timestamptz not null default now(),
  unique (claim_id, sha256)
);

comment on table public.claim_evidence is
  'Index of evidence files held in Supabase Storage. Hashes and timestamps only. '
  'assessor_licence_no and c2pa_verified are recorded as received and are not '
  'independently verified here.';

-- §1.3 — the insurer's decision, as it arrived over the signed API.
create table if not exists public.claim_decisions (
  id                    bigserial primary key,
  claim_id              bigint not null references public.claims(id) on delete restrict,
  insurer_id            bigint not null references public.insurers(id) on delete restrict,
  decision              insurer_decision not null,
  payout_paise          bigint not null default 0 check (payout_paise >= 0),
  reason                text,
  -- The insurer's own timestamp, and ours. Both are kept so a slow or replayed
  -- delivery is visible.
  decided_at            timestamptz not null,
  received_at           timestamptz not null default now(),
  -- The exact bytes the insurer signed, by hash, plus the signature and the
  -- nonce that stops it being replayed. signature_verified is set by the
  -- server after checking it against insurers.signer_address.
  signed_payload_sha256 text not null check (signed_payload_sha256 ~ '^[0-9a-f]{64}$'),
  insurer_signature     text not null check (insurer_signature ~ '^0x[0-9a-fA-F]{130}$'),
  nonce                 text not null,
  signature_verified    boolean not null default false,
  onchain_tx            text,
  created_at            timestamptz not null default now(),
  -- A nonce is good once per insurer, so a captured decision cannot be
  -- replayed against another claim.
  unique (insurer_id, nonce),
  -- An approval must carry money; a rejection must not.
  constraint approval_pays_rejection_does_not
    check ((decision = 'approve' and payout_paise > 0)
        or (decision = 'reject'  and payout_paise = 0))
);

-- §1.3 — premiums are escrowed, then routed to the insurer on a schedule.
-- This application holds premiums in transit; it never keeps them.
create table if not exists public.premium_settlements (
  id                   bigserial primary key,
  insurer_id           bigint not null references public.insurers(id) on delete restrict,
  period_start         date not null,
  period_end           date not null,
  gross_premium_paise  bigint not null check (gross_premium_paise >= 0),
  policy_count         integer not null check (policy_count >= 0),
  scheduled_for        timestamptz not null,
  settled_at           timestamptz,
  reference            text,
  status               settlement_status not null default 'scheduled',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint period_is_forward check (period_end >= period_start),
  unique (insurer_id, period_start, period_end)
);

-- ───────────────────────── guard rules ─────────────────────────
--
-- These are the rules the database refuses to break, so they hold even if the
-- application layer has a bug.

-- Guard 1 — a claim must come from the insured party, and the insured event
-- must have happened inside the cover window. These are §1.2's "policy was
-- active at the time of the event" and "claimant is the insured party",
-- enforced rather than described.
create or replace function public.claim_matches_policy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  p record;
begin
  select insured_did, starts_at, ends_at into p
  from public.policies where id = new.policy_id;

  if p is null then
    raise exception 'policy % does not exist', new.policy_id;
  end if;

  if new.claimant_did <> p.insured_did then
    raise exception 'claimant is not the insured party on policy %', new.policy_id;
  end if;

  if new.event_at < p.starts_at or new.event_at > p.ends_at then
    raise exception
      'event at % falls outside the cover window (% to %)', new.event_at, p.starts_at, p.ends_at;
  end if;

  return new;
end $$;

drop trigger if exists claim_matches_policy_trg on public.claims;
create trigger claim_matches_policy_trg
  before insert or update of policy_id, claimant_did, event_at on public.claims
  for each row execute function public.claim_matches_policy();

-- Guard 2 — a claim cannot leave 'submitted' with no evidence behind it, and
-- cannot be marked 'paid' without a verified insurer approval.
create or replace function public.claim_progress_needs_proof()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  n_evidence integer;
  n_approved integer;
begin
  if new.status = old.status then
    return new;
  end if;

  if new.status in ('under_review', 'approved', 'paid') then
    select count(*) into n_evidence from public.claim_evidence where claim_id = new.id;
    if n_evidence = 0 then
      raise exception 'claim % has no evidence, so it cannot move to %', new.id, new.status;
    end if;
  end if;

  if new.status = 'paid' then
    select count(*) into n_approved
    from public.claim_decisions
    where claim_id = new.id and decision = 'approve' and signature_verified;
    if n_approved = 0 then
      raise exception
        'claim % has no signature-verified insurer approval, so it cannot be marked paid', new.id;
    end if;
  end if;

  return new;
end $$;

drop trigger if exists claim_progress_needs_proof_trg on public.claims;
create trigger claim_progress_needs_proof_trg
  before update of status on public.claims
  for each row execute function public.claim_progress_needs_proof();

-- Guard 3 — a payout can never exceed the coverage on the policy, and a
-- decision can only come from an active insurer. Over-payment is the failure
-- that would hurt the insurer most, so the database refuses it outright.
create or replace function public.decision_within_coverage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cover bigint;
  already bigint;
  st insurer_status;
begin
  select status into st from public.insurers where id = new.insurer_id;
  if st is distinct from 'active' then
    raise exception 'insurer % is not active, so its decisions are not accepted', new.insurer_id;
  end if;

  select p.coverage_paise into cover
  from public.claims c join public.policies p on p.id = c.policy_id
  where c.id = new.claim_id;

  select coalesce(sum(payout_paise), 0) into already
  from public.claim_decisions
  where claim_id = new.claim_id and decision = 'approve' and id <> coalesce(new.id, -1);

  if already + new.payout_paise > cover then
    raise exception
      'payout % plus % already approved exceeds coverage % on claim %',
      new.payout_paise, already, cover, new.claim_id;
  end if;

  return new;
end $$;

drop trigger if exists decision_within_coverage_trg on public.claim_decisions;
create trigger decision_within_coverage_trg
  before insert or update on public.claim_decisions
  for each row execute function public.decision_within_coverage();

-- Guard 4 — a policy cannot be sold against a product that is not sellable.
create or replace function public.policy_product_is_sellable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ok boolean;
begin
  select sellable into ok from public.cover_products where id = new.product_id;
  if ok is distinct from true then
    raise exception
      'product % is not sellable (no IRDAI filing reference on record)', new.product_id;
  end if;
  return new;
end $$;

drop trigger if exists policy_product_is_sellable_trg on public.policies;
create trigger policy_product_is_sellable_trg
  before insert on public.policies
  for each row execute function public.policy_product_is_sellable();

-- ───────────────────────── row level security ─────────────────────────
--
-- Read-your-own-rows for clients. No insert, update or delete policy exists
-- for any client role, so every write must go through the server.

alter table public.insurers             enable row level security;
alter table public.cover_products       enable row level security;
alter table public.policies             enable row level security;
alter table public.exposure_declarations enable row level security;
alter table public.claims               enable row level security;
alter table public.claim_evidence       enable row level security;
alter table public.claim_decisions      enable row level security;
alter table public.premium_settlements  enable row level security;

-- Who the insurer is, and which products are on sale, is public information a
-- buyer is entitled to before paying. Nothing sensitive sits in either table.
drop policy if exists insurers_read_active on public.insurers;
create policy insurers_read_active on public.insurers
  for select using (status = 'active');

drop policy if exists cover_products_read_sellable on public.cover_products;
create policy cover_products_read_sellable on public.cover_products
  for select using (sellable);

drop policy if exists policies_read_own on public.policies;
create policy policies_read_own on public.policies
  for select using (insured_did = current_did());

drop policy if exists exposure_read_own on public.exposure_declarations;
create policy exposure_read_own on public.exposure_declarations
  for select using (
    policy_id in (select id from public.policies where insured_did = current_did())
  );

drop policy if exists claims_read_own on public.claims;
create policy claims_read_own on public.claims
  for select using (claimant_did = current_did());

drop policy if exists claim_evidence_read_own on public.claim_evidence;
create policy claim_evidence_read_own on public.claim_evidence
  for select using (
    claim_id in (select id from public.claims where claimant_did = current_did())
  );

-- A claimant may see the decision on their own claim — including the reason for
-- a rejection, which they need in order to complain to the insurer or the
-- ombudsman. They cannot see the signature material.
drop policy if exists claim_decisions_read_own on public.claim_decisions;
create policy claim_decisions_read_own on public.claim_decisions
  for select using (
    claim_id in (select id from public.claims where claimant_did = current_did())
  );

-- Premium settlement is between this application and the insurer. No client
-- policy at all, so the anon and authenticated roles see nothing.

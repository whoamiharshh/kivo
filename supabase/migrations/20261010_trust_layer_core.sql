-- The unified trust layer's own storage.
--
-- Everything here exists because the chain cannot see it. A contract can check
-- that a signature came from a particular key; it cannot check that the key had
-- any business signing. These tables are where the "had any business" part is
-- recorded, so a signature the server issued can always be traced back to what
-- the server was told, and when.
--
-- Access, for every table below: RLS is enabled and NO policy is created. That
-- is not an omission. With RLS on and no policy, PostgreSQL denies every row to
-- every client role, so the anon key and any signed-in user get nothing at all.
-- The browser has no business reading a nonce ledger or somebody else's
-- declared income, so it cannot. Only the service-role key, which lives on the
-- server, can read or write here.

-- ───────────── nonces: every signature the server ever issued ─────────────

create table if not exists public.trust_nonces (
  id            bigserial   primary key,
  nonce         text        not null unique check (nonce ~ '^[0-9a-f]{32}$'),
  signer_did    text        not null check (char_length(signer_did) between 1 and 200),
  action_type   text        not null check (char_length(action_type) between 1 and 64),
  payload_hash  text        not null check (payload_hash ~ '^0x[0-9a-fA-F]{64}$'),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  used_at       timestamptz,
  constraint expiry_after_creation check (expires_at > created_at)
);

comment on table public.trust_nonces is
  'One row per signature the trust layer issued. Replay protection and audit trail in the same place.';

create index if not exists trust_nonces_did_action_idx
  on public.trust_nonces (signer_did, action_type, created_at desc);
create index if not exists trust_nonces_unused_idx
  on public.trust_nonces (expires_at) where used_at is null;

-- ───────────── behaviour signals: features 02, 03, 08 ─────────────

do $$ begin
  create type public.behaviour_subject as enum (
    'commitment_goal',       -- feature 02
    'accountability_pool',   -- feature 03
    'savings_goal'           -- feature 08
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.behaviour_metric as enum ('steps', 'screen_time_minutes');
exception when duplicate_object then null; end $$;

create table if not exists public.behaviour_signals (
  id            bigserial                primary key,
  subject       public.behaviour_subject not null,
  subject_id    bigint                   not null check (subject_id >= 0),
  member_did    text                     not null check (char_length(member_did) between 1 and 200),
  for_day       date                     not null,
  metric        public.behaviour_metric  not null,
  value         integer                  not null check (value >= 0),
  -- The bound the server applied, stored so a later reader can see which rule
  -- was in force rather than inferring it from the code of the day.
  bound_applied integer                  not null check (bound_applied > 0),
  signal_sha256 text                     not null check (signal_sha256 ~ '^0x[0-9a-fA-F]{64}$'),
  nonce_id      bigint                   references public.trust_nonces (id),
  created_at    timestamptz              not null default now(),
  -- One submission per member per metric per day. A second attempt is a
  -- correction the server has to handle deliberately, not an accident.
  unique (subject, subject_id, member_did, for_day, metric)
);

comment on table public.behaviour_signals is
  'Self-reported behaviour, bounds-checked, server-trusted. NOT device-attested: see docs/trust-layer.md.';

-- The bounds from the brief, as a database constraint and not only as
-- application code, so a bug in a route cannot store an impossible number.
alter table public.behaviour_signals drop constraint if exists behaviour_within_bounds;
alter table public.behaviour_signals add constraint behaviour_within_bounds check (
  (metric = 'steps'               and value <= 50000) or
  (metric = 'screen_time_minutes' and value <= 1440)
);

-- ───────────── income declarations: feature 04, PROTOTYPE ─────────────

create table if not exists public.income_declarations (
  id              bigserial   primary key,
  agreement_id    bigint      not null check (agreement_id >= 0),
  recipient_did   text        not null check (char_length(recipient_did) between 1 and 200),
  for_month       date        not null,
  income_paise    bigint      not null check (income_paise >= 0 and income_paise <= 100000000000),
  -- The honest provenance field. 'self_declared' is the only value this repo
  -- can currently produce. 'account_aggregator' exists so the column does not
  -- have to change when a real source is wired in, and so a query can always
  -- separate verified income from a number somebody typed.
  source          text        not null default 'self_declared'
                              check (source in ('self_declared', 'account_aggregator')),
  nonce_id        bigint      references public.trust_nonces (id),
  created_at      timestamptz not null default now(),
  unique (agreement_id, for_month)
);

comment on table public.income_declarations is
  'PROTOTYPE: income is whatever the recipient typed. Production replaces this with an Account Aggregator consent flow.';

-- ───────────── gift conditions: feature 05 ─────────────

create table if not exists public.gift_conditions (
  id              bigserial   primary key,
  gift_id         bigint      not null unique check (gift_id >= 0),
  condition_text  text        not null check (char_length(condition_text) between 1 and 200),
  condition_hash  text        not null check (condition_hash ~ '^0x[0-9a-fA-F]{64}$'),
  evidence_hash   text        check (evidence_hash ~ '^0x[0-9a-fA-F]{64}$'),
  attester_did    text        check (char_length(attester_did) between 1 and 200),
  attested_at     timestamptz,
  nonce_id        bigint      references public.trust_nonces (id),
  created_at      timestamptz not null default now()
);

-- A gift cannot be recorded as attested with nothing behind it.
alter table public.gift_conditions drop constraint if exists attested_needs_evidence;
alter table public.gift_conditions add constraint attested_needs_evidence check (
  attested_at is null or (evidence_hash is not null and attester_did is not null)
);

-- ───────────── parametric oracle events: feature 07, PROTOTYPE ─────────────

create table if not exists public.oracle_events (
  id             bigserial   primary key,
  policy_id      bigint      not null check (policy_id >= 0),
  event_type     text        not null check (char_length(event_type) between 1 and 60),
  event_occurred boolean     not null,
  -- 'simulated' is the only value this repo produces. The column exists so a
  -- real feed can be told apart from a demo button, permanently.
  source         text        not null default 'simulated'
                             check (source in ('simulated', 'chainlink', 'insurer_feed')),
  payout_paise   bigint      not null default 0 check (payout_paise >= 0),
  nonce_id       bigint      references public.trust_nonces (id),
  created_at     timestamptz not null default now(),
  unique (policy_id, event_type)
);

comment on table public.oracle_events is
  'PROTOTYPE: the trigger is a button somebody pressed. Production replaces it with a decentralised oracle or the insurer feed.';

-- ───────────── employer attestations: feature 06 ─────────────

create table if not exists public.employer_attestations (
  id                bigserial   primary key,
  employer_address  text        not null unique check (employer_address ~ '^0x[0-9a-fA-F]{40}$'),
  owner_did         text        not null check (char_length(owner_did) between 1 and 200),
  entity_proof      text        not null check (char_length(entity_proof) between 1 and 200),
  proof_kind        text        not null default 'self_asserted'
                                check (proof_kind in ('self_asserted', 'gst', 'cin')),
  -- Deliberately NOT a verification. Nothing here contacts a registry.
  verified          boolean     not null default false,
  nonce_id          bigint      references public.trust_nonces (id),
  created_at        timestamptz not null default now()
);

comment on table public.employer_attestations is
  'PROTOTYPE: an employer typed its own registration number. verified stays false until a registry lookup exists.';

-- ───────────── lock every one of them down ─────────────

alter table public.trust_nonces           enable row level security;
alter table public.behaviour_signals      enable row level security;
alter table public.income_declarations    enable row level security;
alter table public.gift_conditions        enable row level security;
alter table public.oracle_events          enable row level security;
alter table public.employer_attestations  enable row level security;

-- No policies, on purpose: RLS on with no policy denies every client role.
-- Proven by query in the Phase 2 report rather than assumed.

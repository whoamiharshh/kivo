-- Pot — offchain text store (optional).
--
-- Only names and memo text live here. Money, membership and rules are all in
-- the contract. Onchain we store just keccak256 hashes of the memo text, so
-- nothing here is needed to audit the money.
--
-- Run this once in the Supabase SQL editor (Dashboard -> SQL -> New query).

-- Pot names and the agreed per-person share (display only).
--
-- The invite code used to live here, world-readable. That was C-1 in
-- docs/security-audit.md. It now lives in public.pots_private, created by
-- migrations/20261010_split_invite_codes.sql, which this file does NOT
-- recreate: run the migrations, not just this bootstrap.
create table if not exists public.pots (
  pot_id            bigint primary key,
  name              text        not null check (char_length(name) between 1 and 40),
  per_person_paise  bigint      not null default 0 check (per_person_paise >= 0),
  created_at        timestamptz not null default now()
);

-- The name friends see next to a person's share.
create table if not exists public.profiles (
  address     text primary key check (address ~ '^0x[0-9a-fA-F]{40}$'),
  name        text        not null check (char_length(name) between 1 and 24),
  updated_at  timestamptz not null default now()
);

-- What a repayment was for, keyed by the hash that went onchain.
create table if not exists public.memos (
  hash        text primary key check (hash ~ '^0x[0-9a-fA-F]{64}$'),
  text        text        not null check (char_length(text) between 1 and 60),
  created_at  timestamptz not null default now()
);

alter table public.pots     enable row level security;
alter table public.profiles enable row level security;
alter table public.memos    enable row level security;

-- Honest note on access: the app talks to Supabase with the public anon key and
-- has no server session, so these policies are open. That is acceptable only
-- because every row here is group-visible text that people chose to share
-- (a pot name, a first name, "cab"), and because nothing here can move money.
-- A production build would put these writes behind an authenticated endpoint
-- that checks the caller is a member of the pot.
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'pots' and policyname = 'pots_read') then
    create policy pots_read   on public.pots     for select using (true);
    create policy pots_write  on public.pots     for insert with check (true);
    create policy pots_update on public.pots     for update using (true) with check (true);

    create policy profiles_read   on public.profiles for select using (true);
    create policy profiles_write  on public.profiles for insert with check (true);
    create policy profiles_update on public.profiles for update using (true) with check (true);

    create policy memos_read   on public.memos for select using (true);
    create policy memos_write  on public.memos for insert with check (true);
    create policy memos_update on public.memos for update using (true) with check (true);
  end if;
end $$;

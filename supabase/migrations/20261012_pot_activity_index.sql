-- Canonical PotManager history, indexed only through finalized blocks.
--
-- These tables are server-only. RLS is enabled with no client policies, and
-- direct anon/authenticated privileges are revoked. Route handlers verify a
-- Privy identity and onchain pot membership before returning event rows.

create table if not exists public.pot_activity_events (
  chain_id          bigint      not null check (chain_id > 0),
  contract_address  text        not null check (contract_address ~ '^0x[0-9a-f]{40}$'),
  pot_id            bigint      not null check (pot_id > 0),
  block_number      bigint      not null check (block_number >= 0),
  block_hash        text        not null check (block_hash ~ '^0x[0-9a-fA-F]{64}$'),
  transaction_hash  text        not null check (transaction_hash ~ '^0x[0-9a-fA-F]{64}$'),
  log_index         integer     not null check (log_index >= 0),
  event_name        text        not null check (event_name in (
    'PotCreated', 'MemberJoined', 'Deposited', 'PotFunded',
    'RefundingStarted', 'SpendRequested', 'SpendApproved',
    'SpendCancelled', 'SpendExecuted', 'PotClosed', 'Refunded'
  )),
  args              jsonb       not null,
  block_timestamp   timestamptz not null,
  indexed_at        timestamptz not null default now(),
  primary key (chain_id, contract_address, transaction_hash, log_index)
);

create index if not exists pot_activity_events_page_idx
  on public.pot_activity_events
  (chain_id, contract_address, pot_id, block_number desc, log_index desc);

create table if not exists public.pot_activity_members (
  chain_id          bigint      not null check (chain_id > 0),
  contract_address  text        not null check (contract_address ~ '^0x[0-9a-f]{40}$'),
  pot_id            bigint      not null check (pot_id > 0),
  member_address    text        not null check (member_address ~ '^0x[0-9a-f]{40}$'),
  joined_block      bigint      not null check (joined_block >= 0),
  joined_log_index  integer     not null check (joined_log_index >= 0),
  indexed_at        timestamptz not null default now(),
  primary key (chain_id, contract_address, pot_id, member_address)
);

create index if not exists pot_activity_members_lookup_idx
  on public.pot_activity_members
  (chain_id, contract_address, member_address, pot_id desc);

create table if not exists public.pot_activity_sync (
  chain_id          bigint      not null check (chain_id > 0),
  contract_address  text        not null check (contract_address ~ '^0x[0-9a-f]{40}$'),
  next_block        bigint      not null check (next_block >= 0),
  last_scanned_block bigint,
  last_scanned_hash text,
  updated_at        timestamptz not null default now(),
  primary key (chain_id, contract_address),
  check ((last_scanned_block is null) = (last_scanned_hash is null)),
  check (last_scanned_hash is null or last_scanned_hash ~ '^0x[0-9a-fA-F]{64}$')
);

create table if not exists public.pot_activity_leases (
  chain_id          bigint      not null check (chain_id > 0),
  contract_address  text        not null check (contract_address ~ '^0x[0-9a-f]{40}$'),
  lease_owner       uuid        not null,
  expires_at        timestamptz not null,
  primary key (chain_id, contract_address)
);

alter table public.pot_activity_events enable row level security;
alter table public.pot_activity_members enable row level security;
alter table public.pot_activity_sync enable row level security;
alter table public.pot_activity_leases enable row level security;

revoke all on public.pot_activity_events, public.pot_activity_members, public.pot_activity_sync,
  public.pot_activity_leases from anon, authenticated;
grant all on public.pot_activity_events, public.pot_activity_members, public.pot_activity_sync,
  public.pot_activity_leases to service_role;

create or replace function public.claim_pot_activity_lease(
  p_chain_id bigint,
  p_contract_address text,
  p_owner uuid,
  p_lease_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  acquired boolean := false;
begin
  if p_lease_seconds < 1 or p_lease_seconds > 120 then
    return false;
  end if;

  insert into public.pot_activity_leases
    (chain_id, contract_address, lease_owner, expires_at)
  values
    (p_chain_id, lower(p_contract_address), p_owner,
     now() + make_interval(secs => p_lease_seconds))
  on conflict (chain_id, contract_address) do update
    set lease_owner = excluded.lease_owner,
        expires_at = excluded.expires_at
    where public.pot_activity_leases.expires_at <= now()
  returning true into acquired;

  return coalesce(acquired, false);
end;
$$;

create or replace function public.release_pot_activity_lease(
  p_chain_id bigint,
  p_contract_address text,
  p_owner uuid
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.pot_activity_leases
   where chain_id = p_chain_id
     and contract_address = lower(p_contract_address)
     and lease_owner = p_owner;
  return found;
end;
$$;

revoke all on function public.claim_pot_activity_lease(bigint, text, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.release_pot_activity_lease(bigint, text, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_pot_activity_lease(bigint, text, uuid, integer)
  to service_role;
grant execute on function public.release_pot_activity_lease(bigint, text, uuid)
  to service_role;
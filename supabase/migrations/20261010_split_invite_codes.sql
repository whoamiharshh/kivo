-- C-1: invite codes were world-readable.
--
-- The hole. `public.pots` carried an `invite_code` column, had
-- `using (true)` for select, and is reached with the publishable anon key that
-- ships inside the browser bundle. So anybody could list every pot and its
-- code. With a code you could join a stranger's funded pot, and from inside it
-- drain money. Fixed here, and in PotManager.join, and in lib/store.ts.
--
-- The split:
--
--   public.pots          display text only. Still world-readable, because a
--                        pot's name and per-person share are exactly what the
--                        group shares in a WhatsApp message.
--   public.pots_private  the invite code. Write-only for the client, readable
--                        only by the creator or the service role.
--
-- Why write-only, rather than creator-only in both directions, which is what
-- you would expect. The browser talks to Supabase with the anon key and NO
-- session, so `current_did()` is null for it and any policy keyed on the
-- caller's identity denies everything. A creator-only SELECT policy is still
-- written below, so it starts working the moment the app issues DID-scoped
-- tokens, but today its practical effect is: only the service role reads this.
--
-- The INSERT policy is deliberately open, and that is a bounded trade-off
-- rather than an oversight. It lets the creator's browser store the code it
-- just generated without waiting for a server route, and nobody can read it
-- back. What it allows: somebody could insert a row for a pot_id that has no
-- code stored yet and squat it. The consequence is an invite link that does
-- not work, because the squatted code will not match the `inviteHash` the real
-- creator put on-chain, so the server refuses to authorize any join. That is
-- denial of an invite, not access to a pot, and not a route to the money.
-- Phase 2 moves this insert behind an authenticated server route, after which
-- the policy becomes service-role only.

-- ───────────── the private half ─────────────

create table if not exists public.pots_private (
  pot_id       bigint      primary key,
  invite_code  text        not null check (invite_code ~ '^0x[0-9a-fA-F]{64}$'),
  creator_did  text        check (char_length(creator_did) between 1 and 200),
  created_at   timestamptz not null default now()
);

comment on table public.pots_private is
  'Invite codes. Write-only for the anon key; readable by the creator or the service role. Never select this from the browser.';

-- Carry across anything already stored, then take the column away.
insert into public.pots_private (pot_id, invite_code)
select pot_id, invite_code
  from public.pots
 where invite_code is not null
    on conflict (pot_id) do nothing;

alter table public.pots drop column if exists invite_code;

-- ───────────── access ─────────────

alter table public.pots_private enable row level security;

-- Readable by its creator, which today means: by nobody holding the anon key.
-- `current_did()` reads the 'did' claim from the request's JWT; it is defined
-- in 20261010_micro_insurance_trust_layer.sql.
drop policy if exists pots_private_read_own on public.pots_private;
create policy pots_private_read_own
  on public.pots_private
  for select
  using (creator_did is not null and creator_did = current_did());

-- Write-only drop box. See the note at the top for what this does and does not
-- allow, and why it is temporary.
drop policy if exists pots_private_insert on public.pots_private;
create policy pots_private_insert
  on public.pots_private
  for insert
  with check (true);

-- No update and no delete policy, on purpose: a stored code is never edited,
-- and letting it be overwritten would turn the squatting nuisance above into a
-- way to break an invite that already works.

-- ───────────── proof the hole is closed ─────────────
--
-- Run as the anon role, which is what the browser is:
--
--   set local role anon;
--   select * from public.pots;            -- no invite_code column at all
--   select * from public.pots_private;    -- 0 rows, every time
--
-- The first cannot find the column; the second returns nothing, because the
-- read policy needs a did claim the anon key does not carry. Both are asserted
-- in the Phase 1 report.

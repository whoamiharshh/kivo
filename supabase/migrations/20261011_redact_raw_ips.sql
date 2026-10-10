-- Redact raw IP addresses from the audit trail, and say in the schema itself
-- that the field is a hash.
--
-- ──────────────── what went wrong ────────────────
--
-- `handle()` in apps/pot/lib/server/trust.ts logged blocked requests with
-- `detail = { reason, path, ip }`, where `ip` was the address as the platform
-- reported it. `audit_log` carries an `audit_read_own` SELECT policy, so a
-- signed-in user could read their own network location back out of the audit
-- trail. It also broke this project's own rule that a raw address is never
-- stored. The application now writes `ip_hash`, a salted SHA-256.
--
-- ──────────────── why these rows are nulled, not hashed ────────────────
--
-- Hashing them now would preserve a value that has already been exposed to
-- whoever could read it, and would let anybody holding the old plaintext
-- confirm a match. There is nothing to gain: these are rows about requests
-- that were already refused. They are cleared.
--
-- The key is set to `null` rather than removed, so a reader sees that the
-- field existed and was redacted instead of wondering why older rows look
-- different from newer ones.
--
-- In the project this was written against, `audit_log` held 0 rows and so
-- nothing was ever actually exposed. This runs anyway, because any other
-- environment that ran the affected build may not be so lucky.

update public.audit_log
set detail = jsonb_set(detail, '{ip}', 'null'::jsonb)
where detail ? 'ip'
  and detail->>'ip' is not null;

-- Any already-null key moves to the new name, so one query reads every row the
-- same way regardless of which build wrote it.
update public.audit_log
set detail = (detail - 'ip') || jsonb_build_object('ip_hash', detail->'ip')
where detail ? 'ip'
  and detail->>'ip' is null
  and not (detail ? 'ip_hash');

comment on table public.audit_log is
  'Append-only from the application''s point of view: no update or delete policy exists for any client role. detail.ip_hash is a SALTED SHA-256 of the caller''s address (salt: IP_HASH_SALT, server-only), never the address itself — an unsalted digest of an IPv4 address is reversible by brute force. Rows predating 2026-10-11 may carry a redacted detail.ip of null; see migration 20261011_redact_raw_ips.';

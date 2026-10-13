# SECURITY

Part of the [PROJECT_DOSSIER](PROJECT_DOSSIER.md). Scope: the repository, the
deployed testnet contracts, and the live Supabase schema as inspected read-only
on 2026-10-12. **No key, secret, token or credential value appears in this
document.** Public addresses (which are not secrets) are listed where needed.

Classification used: **Verified** = confirmed by reading the code/contract or by a
read-only query in this pass; **Potential** = plausible from the design but needs a
test or live access to confirm. This is a code-reading review by the same agent
family that helped write parts of the code; it is not an independent audit. The
project's own earlier audit (`docs/security-audit.md`, 2026-10-10) is explicitly
marked historical and several of its critical findings have since been fixed in
the contracts (e.g. the approver ≠ recipient check now exists as
`CannotApproveOwnPayout`).

## 1. Assets and actors

| Asset | Where | Value today |
|---|---|---|
| Test-money balances held by contracts | 9 testnet contracts | None (no real value; `TestRupee` has a public faucet) |
| Invite codes | `pots_private` (server-readable) and the creator's browser | Gate to pot membership together with a signer signature |
| Trust-signer private key | `apps/pot/.env.local` (ignored) | Admits joiners, attests, settles claims on deployed contracts |
| Deployer private key | `packages/contracts/.env` (ignored) | Holds `SocialPay.arbitrator`, `BehaviourSavings.admin`, `MicroCover.insurer` |
| Supabase service key / Privy app secret | `.env.local` | Full DB access / app administration |
| Users' Google identity ↔ wallet mapping | Privy; `users` table (currently empty) | Pseudonymous |

Actors: pot members; non-members with a pot id; any signed-in user calling trust
routes; anyone with the public anon key; whoever holds the exposed keys.

## 2. Authentication and authorization model (Verified by source)

- Sign-in: Google only, via Privy; an embedded Ethereum wallet is created
  silently. Every state-changing chain action is sent from that wallet with Privy
  fee sponsorship (`lib/tx.ts`).
- Server identity: two Privy tokens verified against the app's verification key,
  cross-checked to the same subject; wallet address comes from the signed
  identity token (`lib/server/privy.ts`). `hasPasskey` reports passkey
  *enrolment*, not a per-action WebAuthn assertion; step-up authentication is not
  implemented (the `send_limits.stepup_threshold_paise` column is never applied).
- Origin and rate limiting: see API_REFERENCE §1. The per-DID limiter (DB-backed)
  is the effective control; the per-IP Map is a courtesy.
- Contract-level authorization is the real money control: members only for pot
  actions; creator-only close; approver ≠ requester ≠ recipient; recipient-signed
  repayments; insurer/arbitrator/admin immutables.
- The browser holds no server secret; `NEXT_PUBLIC_*` values are public by design.
  Server-only modules import `server-only`.

## 3. Compromised credentials

Both local keys are treated as compromised by the project
(`docs/production-readiness.md`, `apps/pot/DEPLOY.md`). The README states the
Supabase service key and Privy app secret were also pasted into a chat transcript;
`HANDOFF.md` records that a broad search once printed the signer value in tool
output. Rotation of any of these has **not** been performed. This pass did not
re-read or print any key.

### 3.1 Which key controls what (read back on-chain 2026-10-12)

| Public address | Role names | Contracts that accept it | What it can do |
|---|---|---|---|
| `0xbe4AD8Cc900e5824440526E7669a82881c661D94` ("trust signer") | `PotManager.trustSigner`; `AccountabilityPool.attester`; `IncomeShare.recorder`; `MicroCover.insurerSigner`; `BehaviourSavings.behaviourVerifier` (assigned verifier for new ExternalSignal goals) | PotManager, AccountabilityPool, IncomeShare, MicroCover, BehaviourSavings | Sign pot-join authorizations (still needs the invite code); sign a pool member's attended days (can pass or fail members); send `recordRepayment` (still needs the recipient's signature); sign any `settleClaim` payout up to the policy coverage; verify any ExternalSignal goal |
| `0xD6A07f0aE71CE9a8f36f0d50Cd907aC652c0EDA7` ("deployer") | `SocialPay.arbitrator`; `BehaviourSavings.admin`; `MicroCover.insurer` | SocialPay, BehaviourSavings, MicroCover | Cast one dispute vote (decides only with one party's agreement); register/revoke verifiers and choose the verifier for **new** goals; bind/decline policies, remit premiums, withdraw **uncommitted** reserve |

### 3.2 What can and cannot be revoked

- **Cannot be revoked on the deployed contracts:** every role above is an
  `immutable` set in the constructor (verified in source). Changing an environment
  variable does **not** revoke a key; it only stops the app from using it, and it
  can break legitimate flows while the old key stays authoritative.
- **Can be changed without redeploying:** `BehaviourSavings.behaviourVerifier`
  (via `admin`, which is itself the deployer key), the app's server configuration,
  the Supabase service key and Privy app secret (dashboard rotations), local files.
- **Requires fresh contracts:** `PotManager` (trustSigner), `SocialPay`
  (arbitrator), `BehaviourSavings` (admin), `AccountabilityPool` (attester),
  `IncomeShare` (recorder), `MicroCover` (insurer, insurerSigner). `TestRupee`,
  `Gift` and `SalaryStream` embed no role and could be kept. Existing balances,
  pots and goals would not migrate. This is the only way to actually contain the
  keys, and it needs the owner's explicit approval (they have so far declined to
  authorize deployment or role changes).

### 3.3 Source-level containment already in the working tree (Verified)

`lib/server/env.ts`: signing is **default-deny** (`TRUST_SIGNER_ENABLED` must be
`"true"`), and the known legacy address is refused even when enabled. Result with
the current configuration: every route that signs returns 503; no server-signed
join can be produced. The user has explicitly decided **not** to add an override
that re-enables the exposed key.

**Consequence (Verified, not a bug in the guard):** with the guard on and the
contracts unchanged, joining a pot, marking pool days, ExternalSignal savings
verification and claim settlement cannot work. The only supported ways forward are
fresh contracts with a new signer (needs approval and a funded deployer) or
deliberately removing the guard (declined).

### 3.4 Realistic attack scenarios for the exposed keys

| # | Scenario | Needs | Impact (testnet) | Severity | Status |
|---|---|---|---|---|---|
| A1 | Join any open pot and use its budget | trust-signer key **and** the invite code (from `pots_private` via the exposed Supabase service key, or from a past join transaction's calldata) | Occupy remaining member slots in a funded pot; each fake member can instantly move up to `approvalLimit` and can approve others' over-limit requests (approver ≠ requester ≠ recipient) | High for any real value; none for test money | Potential (logic traced; not executed) |
| A2 | Rig a pool | trust-signer key | Mark any member's day as attested or withhold it, deciding who wins forfeited stakes | Medium | Potential |
| A3 | Rig savings cohorts | trust-signer key (verifier) | Mark ExternalSignal goals verified, diluting honest winners' share | Medium | Potential |
| A4 | Pay out a claim | trust-signer key **and** an `Active` policy (needs the insurer key to bind) **and** funded reserve | Up to coverage per policy | Low today (0 policies, reserve 0) | Potential |
| A5 | Take part in a dispute | deployer key as arbitrator + collusion with one party | Redirect a disputed payment | Low (0 payments) | Potential |
| A6 | Full DB access | Supabase service key | Read/modify everything incl. `pots_private`, nonces | High | Potential — key must be rotated |
| A7 | Impersonate the app to Privy | Privy app secret | Administer the app | High | Potential — note the secret is **not used by any code** (`PRIVY_APP_SECRET()` is never called) |

## 4. Findings register (security-relevant)

IDs match the dossier's issue register.

| ID | Class | Finding | Evidence | Severity |
|---|---|---|---|---|
| K-03 | Verified policy + circumstantial runtime evidence | The browser inserts the invite code with `insert(...).select().maybeSingle()` using the anon key. `pots_private` has an INSERT policy (`true`) but its only SELECT policy requires `creator_did = current_did()`, which an anon request cannot satisfy. Postgres applies SELECT policies to `INSERT … RETURNING`, so the insert is expected to fail, and the client ignores the error. Live DB: `pots` = 2 rows, `pots_private` = **0**, `users` = 0, `trust_nonces` = 0 — i.e. no join authorization has ever been issued. | `lib/store.ts` (`savePotMeta`), `20261010_split_invite_codes.sql`, live `pg_policies`, row counts | **Critical for the product** (no invite can ever be authorized), a correctness rather than confidentiality flaw. Not proven by executing the insert. |
| K-02 | Verified by code trace | Gift "confirm" is structurally impossible: the create screen sets `attester` to a chosen person's wallet; the confirm hook asks the server to sign with the trust-signer key; `Gift.attestCondition` only accepts a signature from `gift.attester`. Separately, `attest-condition` signs for any signed-in caller without checking attester/recipient. | `lib/features/gift.ts`, `app/api/trust/attest-condition/route.ts`, `Gift.sol:218-220` | High (feature dead); the missing caller check would be exploitable only for a gift whose attester is the trust-signer address (none can be created via the UI) |
| S-1 | Verified by code | `attest-behaviour` does not verify goal ownership (see API_REFERENCE §3.3). | `app/api/trust/attest-behaviour/route.ts` | Medium (prototype self-report by design; broader than intended) |
| S-2 | Verified policy | `pots`, `profiles`, `memos` have public INSERT/UPDATE/SELECT `true` (read live for `pots`; `schema.sql` for the others). Anyone with the anon key can overwrite a pot name, any address's display name, or a memo. Display names label the people shown in the repay picker, so a member can relabel another member. Money is unaffected (contracts decide), but the UI can mislead. | live `pg_policies`; `supabase/schema.sql` | Medium |
| S-3 | Verified by code | Origin check is advisory (missing `Origin` allowed); fine because auth is bearer tokens, not cookies. Per-IP throttle is per-instance. | `lib/server/guards.ts` | Low |
| S-4 | Verified by code | `NEXT_PUBLIC_APP_URL` is blank locally; production value unknown. Behind a rewriting proxy the own-origin comparison could reject legitimate requests. | `.env.local`, `guards.ts` | Low / Unknown |
| S-5 | Verified by code | Failure to write `pots_private`/`pots`/`profiles`/`memos` is silent (no error handling) — users get success while data is missing. | `lib/store.ts` | Medium (correctness) |
| S-6 | Verified by code | `flow-check.mjs` signs real transactions on the live testnet deployment with the deployer key, and mis-computes the new pot id as `potCount − 1`. Running it creates a pot and moves test money. | `apps/pot/scripts/flow-check.mjs` | Medium (operational) — do not run casually |
| S-7 | Verified by code | `attest-income` persists the self-declared income before the recipient signs; the unique key then blocks retries (K-13). | `attest-income/route.ts` | Low |
| S-8 | Verified by code | The invite code is stored in the creator's `localStorage` and travels in a URL (`/join/<potId>/<code>`); the join URL appears in browser history and any chat it is pasted into. Contract notes the code becomes public in calldata once used. | `lib/store.ts`, join page, `PotManager.sol` header | Accepted by design; mitigated by the signer check |
| S-9 | Verified by code | `.remember/`, `.backup/` and `.playwright-mcp/` are not git-ignored; tracked `.playwright-mcp` logs and `.remember` content contain no token-shaped strings (searched), but `git add .` would stage them. | `git check-ignore`, grep | Low |
| S-10 | Verified by code | `PRIVY_APP_SECRET` and `NEXT_PUBLIC_ARBITRATOR_ADDRESS` are configured but unused — harmless, but the Privy secret increases exposure with no benefit. | grep | Low |
| S-11 | Potential | Pot discovery B scans up to 200 pots per refresh per client from the public RPC → rate-limit risk under load; error handling shows an error state only. | `lib/queries.ts` | Low |
| S-12 | Potential | `closePot` sends tokens in a loop of ≤20 transfers; fine for a standard ERC-20, unsafe for hooks/non-standard tokens (authors' own note T-1). | `PotManager.sol` | Low (TestRupee only) |
| S-13 | Potential | Tokens sent directly to a contract are unrecoverable (no sweep). | contracts | Low |

Not found: reentrancy gaps in money paths (all use `nonReentrant` + `SafeERC20`;
state is written before transfers), `tx.origin`, `delegatecall`, assembly,
unchecked arithmetic. Signature replay: every digest binds contract address,
chain id and record id (and an action tag for join/pool), per source review and
the existing digest-equivalence test design.

## 5. Privacy

- Onchain: only hashes of memo text and invite codes; amounts and addresses are
  public by nature of the chain.
- Offchain: pot name, a typed first name (≤24 chars), memo text (≤60 chars) in
  public-readable tables; Privy holds the Google identity. `users.email` exists
  but `ensureUser` does not populate it.
- Logs: `logServerError` records only an error name and a 5-character code;
  `audit_log.detail` stores a salted SHA-256 of the IP (nothing is stored when
  `IP_HASH_SALT` is unset). Migration `20261011_redact_raw_ips.sql` redacted raw
  IPs from older rows.
- No analytics or telemetry is configured anywhere (Verified by absence).

## 6. Missing safeguards (Verified absent)

Monitoring and alerting; analytics; error tracking; uptime checks; backups with a
tested restore; incident-response runbook; separate dev/staging/production
projects and keys; CI; dependency/secret scanning; a global circuit breaker;
KMS/HSM key custody; per-action WebAuthn step-up; an independent audit; load
testing. The project's own disclosures say the same
(`docs/production-readiness.md`).

## 7. Recommended actions (ordered by security → correctness → demo impact)

1. **Decide the key strategy** (owner decision): fresh testnet deployment with a
   new trust signer and deployer (recommended; the only real containment) *or*
   accept the exposure explicitly for a throwaway demo. Do not re-enable the
   exposed key silently.
2. Rotate the Supabase service key and Privy app secret in their dashboards
   (manual); remove the unused Privy secret from local config.
3. Fix K-03 (insert without `.select()` and surface errors, or move the write
   behind an authenticated server route using the service key) and verify with an
   anon-role test; until then no pot created in the UI can be joined.
4. Fix S-2 by moving writes behind authenticated server routes, or at least
   restrict `profiles`/`memos` updates.
5. Add the ownership checks in S-1 and K-02 (or remove those features).
6. Do not run `flow-check.mjs`; replace it with a script that uses a throwaway
   key and a correct id.
7. Add monitoring/backups before any real user.

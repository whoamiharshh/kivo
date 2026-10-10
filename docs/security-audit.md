# Trust layer security audit — pre-mainnet

**Date:** 2026-10-10 · **Scope:** the whole repository · **Pass:** findings only, no fixes applied.
**Commit state:** the repository has **no commits** (`git log` → "does not have any commits yet"), so findings reference the working tree.
**Deployment state:** nothing is deployed to any chain. Every exploit below is reachable in code, not live.

---

## 1. Executive summary

The contracts are in good shape. The trust layer does not exist as a running system.

All eight contracts compile, 334/334 tests pass, every contract uses `ReentrancyGuard` and
`SafeERC20`, there is no `unchecked`, no raw `call`, no assembly, no `delegatecall`, no
`tx.origin`, no `Ownable`/admin backdoor, and the only two loops are bounded by a hard
`MAX_MEMBERS_CAP = 20`. Checks-effects-interactions ordering is correct in every money path I
read. That half of the system would survive an audit.

The off-chain half that is supposed to feed it does not exist. There is **no server signing
key anywhere in the repository**, no Play Integrity call, no App Attest call, no WebAuthn
assertion verification, no Account Aggregator client, and no C2PA verification. `apps/pot/app/api/`
does not exist, so the trust-layer module in `apps/pot/lib/server/` has **zero callers** — it is
dead code. Four contracts (`Gift`, `BehaviourSavings`, `IncomeShare`, `MicroCover`) gate money on
a signature from an off-chain authority that no code in this repository can produce.

Worse, in the two places where off-chain data *is* trusted today, it is world-writable. Pot's
invite codes — the only access control on pot membership — are stored in a Supabase table whose
policy is `using (true)`, readable and enumerable by anyone holding the public anon key that ships
in the browser bundle. Two uninvited joins then drain a funded pot, because a "member" is a fully
trusted role on-chain.

**The single most important finding:** the system's security model assumes a trust layer that has
not been built, and the parts standing in for it are open to the public internet.

---

## 2. Critical findings

### C-1 — Pot invite codes are world-readable; two joins drain a funded pot

**Files:** `supabase/schema.sql:45` · `apps/pot/lib/store.ts:67-72` · `apps/pot/lib/store.ts:109-110`
· `packages/contracts/src/PotManager.sol:217-229` · `:270-302` · `:307-326`

**Confirmed vulnerability.**

`supabase/schema.sql:45` creates `create policy pots_read on public.pots for select using (true)`.
`apps/pot/lib/store.ts:72` writes the pot's `invite_code` into that table. `store.ts:109` already
does an unfiltered `from("pots").select("pot_id,name,per_person_paise,invite_code")`. The Supabase
anon key is public by design and ships to the browser, so **any person on the internet can
enumerate every pot ever created together with its invite code.**

On-chain, the invite code is the *only* gate on membership. `PotManager.sol:226` checks
`keccak256(abi.encodePacked(inviteCode)) == p.inviteHash`; there is no allowlist and no creator
approval. `:222` permits joining a pot in `Funded` state, not only while collecting.

**Exploit:**
1. Read `pots` with the anon key; take `pot_id` and `invite_code` for any funded pot with ≥2 free
   seats (`maxMembers` is 2–20, `PotManager.sol:195`).
2. `join(potId, code)` from attacker address A, then again from attacker address B.
3. A calls `requestSpend(potId, B, amount ≤ approvalLimit, memo)`. `:286` sets
   `needsApproval = to == msg.sender || instantSpent + amount > approvalLimit` — paying B is
   neither, so `:300` executes **instantly with no approval**. Repeat from B to A. Each member has
   an independent cumulative budget, so this alone extracts `2 × approvalLimit`.
4. For the remainder: A calls `requestSpend(potId, A, restOfBalance, memo)` (needs approval), then
   B calls `approveSpend`. `:317` only checks `s.requester != msg.sender`; **it does not check that
   the approver is not the recipient.** The spend executes. Pot fully drained.

**Impact:** total loss of any funded pot's balance, by a stranger, without touching a victim's
device or key. `requestSpend:279` restricts `to` to members, which is no obstacle — the attacker's
own joined address is a member.

**Note on existing documentation.** `README.md` already says the invite code "is not treated as a
secret… it becomes visible onchain once someone joins with it; `maxMembers` is what bounds who gets
in." That reasoning does not cover this: the Supabase leak publishes codes for *every* pot
*before* anyone joins and without any chain access, and `maxMembers` does not bound anything
meaningful once an uninvited joiner can approve spends.

**Mitigation:** (a) stop storing `invite_code` server-side, or store only a salted hash and never
return it in a list query; (b) replace `using (true)` with a policy that cannot return
`invite_code`; (c) in `PotManager.approveSpend`, reject `msg.sender == s.to`; (d) consider
requiring creator admission for joins after `Funded`.

### C-2 — `BehaviourSavings` lets the goal owner choose their own verifier and steal the cohort pool

**Files:** `packages/contracts/src/BehaviourSavings.sol:188-196` · `:198-244` (esp. `:206`, `:218-222`)
· `:270-282` · `:334-370` (esp. `:351`)

**Confirmed vulnerability.**

`createSavingsGoalWithVerifier` is `external` and takes `verifier` straight from the caller.
`_createSavingsGoal:206` enforces `user == msg.sender`, and `:221` enforces
`verifier != address(0)` for an `ExternalSignal` goal — but **nothing constrains who the verifier
is.** The caller may name themselves, or any address they control.

`submitBehaviour:277-278` then accepts any signature recovering to `g.verifier`, setting
`behaviourVerified = true`. At `finalise:304-305` that flag is the entire behaviour test, and at
`claimOutcome:351` a successful goal receives
`bonus = forfeitedPool * g.stake / winningStakeTotal` — **the forfeited stakes of other users in
the same deadline cohort.**

**Exploit:** read victims' `deadline` values from `GoalCreated` events or `getGoal`; create an
`ExternalSignal` goal with the identical `due` timestamp (the cohort key is the exact uint64
deadline, `:239`) and `verifier` = an address you hold; deposit `target` and the 10% stake (both
returned to you); self-sign `behaviourDigest(goalId, anyHash)`; call `submitBehaviour`. You are a
guaranteed winner. At `claimOutcome` you take a pro-rata share of everyone else's forfeited
stakes, sized by your own stake, which you chose.

**Impact:** risk-free theft of other users' money, bounded only by the attacker's working capital.
The honest users' loss is real: `:362` reverts `NothingToClaim` for them.

**Why `verifier != user` is not the fix:** the attacker uses a second address. The contract has no
verifier registry, no allowlist, and — because there is no `Ownable` or admin anywhere — **no way
to add one without redeploying.**

**Mitigation:** constrain verifiers to a platform-controlled set (registry contract, or an
immutable signer set passed at construction), and keep `verifier != user` as a secondary check.
Until then, `ExternalSignal` goals should not be offered with redistribution enabled.

### C-3 — The entire off-chain trust layer is absent or unwired

**Files:** `apps/pot/lib/server/trust.ts` (whole file) · `apps/pot/lib/server/privy.ts:152-161`
· absent: `apps/pot/app/api/` · `apps/pot/.env.example` (no signing-key variable)

**Confirmed, by exhaustive search.**

- A repository-wide search for `signMessage|signTypedData|privateKey|PRIVATE_KEY|SIGNER_KEY|
  playIntegrity|appAttest|DeviceCheck|accountAggregator|setu|finvu|sahamati|c2pa|webauthn|
  assertion|Sablier|Superfluid` returns **no implementation hits** in `apps/pot` — only unrelated
  matches on the word "setup".
- `apps/pot/app/api/` **does not exist**. `trust.ts:236` exports a `handle()` route wrapper; a
  search for `requiresStepUp|assertOwnAddress|verifyCaller|resolveRecipient|assertWithinLimits|
  getLimits` outside `lib/server/**` returns **no matches**. The module is dead code.
- `.env.example` declares `PRIVY_APP_SECRET`, `PRIVY_VERIFICATION_KEY`, `SUPABASE_SECRET_KEY` and
  **no signing key of any kind**.

Consequently every off-chain authority the contracts depend on is a hole:
`Gift.attester`, `BehaviourSavings.verifier`, `IncomeShare.recorder`, `MicroCover.insurerSigner`.
Per the prompt's Ground Rule 6, an integration that is absent on the path that decides truth is a
Critical finding; this is worse than a stub that returns `true`, because there is no path at all.

**Impact:** no behaviour signal, income confirmation, device attestation or insurer decision can be
produced by this system. The on-chain signature checks are sound and verify signatures that nothing
can create.

**Mitigation:** build the signer service before any further contract work; decide custody (KMS or
HSM, not an env var) *before* keys exist; domain-separate per module (the digests already are —
each binds `address(this)`, `block.chainid` and the record id, which is correct).

### C-4 — `Deploy.s.sol` defaults the licensed-partner roles to the deployer

**Files:** `packages/contracts/script/Deploy.s.sol` (the `vm.envOr("INSURER", msg.sender)`,
`vm.envOr("RECORDER", msg.sender)`, `vm.envOr("ARBITRATOR", msg.sender)` lines)

**Confirmed, conditional on a mainnet deploy. Reported Critical per Section 6's rule.**

`MicroCover` is deployed with `insurer` and `insurerSigner` both defaulting to `msg.sender`, and
`IncomeShare` with `recorder` defaulting to `msg.sender`. On testnet that is a documented
placeholder. Run unchanged against mainnet with real money, the deployer becomes the entity
escrowing premiums, binding risk and signing claim settlements — i.e. **conducting insurance
business without an IRDAI licence** — and the entity recording income-share obligations in a role
reserved for a licensed counterparty.

Nothing in code prevents this. There is no network check, no required-env guard, no refusal path.

**Mitigation:** make `INSURER`, `INSURER_SIGNER` and `RECORDER` mandatory (fail the script if
unset) whenever the chain id is not a known testnet; add an explicit mainnet refusal to the script.

---

## 3. High findings

### H-1 — `stream_runway` is a SECURITY DEFINER view that leaks every employer's payroll solvency

**Location:** live Supabase view `public.stream_runway` (created by the `employer_trust_layer`
migration, which exists only in the Supabase project — see §7 item 25).

Confirmed by Supabase's own linter (`security_definer_view`, level **ERROR**) and by the view
definition, which is `SELECT employer_id, funded_paise, committed_rate_paise, paused, … FROM
stream_solvency s` — **no `WHERE` clause**. Because the view is SECURITY DEFINER it enforces the
*creator's* permissions, bypassing `stream_solvency`'s own `SELECT`-own-rows RLS policy.

**Exploit:** `GET /rest/v1/stream_runway` with the public anon key returns every employer's funded
balance, committed payroll rate and runway.

**Impact:** cross-tenant disclosure of commercially sensitive payroll data (how many days until
each employer cannot make payroll).

**Mitigation:** recreate as `security_invoker = true`, or add `where employer_id in (select id from
employers where owner_did = current_did())`.

### H-2 — `pots`, `profiles` and `memos` are world-writable; display names drive the repay flow

**Files:** `supabase/schema.sql:42-57` · `apps/pot/lib/store.ts:143-157` · `:181`

Every policy is `using (true) with check (true)` for `select`, `insert` **and** `update`
(`schema.sql:45-55`). With the public anon key anyone can rewrite any row.

**Exploit:** `update profiles set name = 'Rahul' where address = '0x<attacker>'` — or overwrite a
victim's row. In the repay UI the member list is labelled from `profiles`, so a user choosing whom
to repay is choosing by an attacker-controlled string. Combined with C-1 (the attacker can become a
member, and `requestSpend:279` requires the recipient to be a member) this makes misdirected
repayment a realistic social-engineering path. `pots.name`, `per_person_paise` and all memo text are
tamperable the same way; memos are the activity feed's entire human-readable content.

The schema comments acknowledge the policies are open and say a production build would gate writes
behind an authenticated endpoint. That endpoint is C-3 — it does not exist.

**Mitigation:** move all writes behind the server (the `handle()` wrapper already written), and
restrict `profiles` updates to the caller's own verified address.

### H-3 — The audit log is not append-only and its write failures are silent

**Files:** `apps/pot/lib/server/trust.ts:199-224` (esp. `:221-223`) · live `public.audit_log`

`audit_log` has exactly one policy, a `SELECT` for the row's own parties. There is **no trigger
preventing `UPDATE` or `DELETE`** (confirmed: the only triggers in `public` are
`payments_enforce_limits`, `income_requires_active_consent`, `repayment_guards`,
`claim_matches_policy_trg`, `claim_progress_needs_proof_trg`, `decision_within_coverage_trg`,
`policy_product_is_sellable_trg`). The server uses the service-role key
(`lib/server/db.ts:50-57`), which bypasses RLS entirely.

So the table is append-only "from the application's point of view" — its own comment's words — and
not otherwise. **A compromised server or anyone with the secret key can delete evidence of abuse**,
and there is no hash chain or external anchor to detect it.

Separately, `trust.ts:221-223` logs a failed audit write to `console.error` and continues. The
decision proceeds unlogged; nothing alerts.

**Mitigation:** revoke `UPDATE`/`DELETE` from all roles including the service role (a dedicated
append-only role, or a `BEFORE UPDATE OR DELETE` trigger that always raises); chain each row's hash
to its predecessor; treat an audit-write failure as fatal to the action it describes.

### H-4 — Employer verification is decorative in both layers

**Files:** `packages/contracts/src/SalaryStream.sol:139-196` · live `public.employers`,
`public.employer_checks`

The contract takes the employer to be whoever calls `createStream`/`createAndFundStream` — there is
no verification, allowlist or attestation check on that path. Off-chain, `employers.status` carries
the comment "An employer may only stream while status = verified. Set server-side after all three
checks pass", and `employer_checks` exists to hold those checks — but there is **no server code
that writes either table** (C-3), and no contract call reads them.

**Impact:** "verified employer" is a claim the system cannot make. Any address can open a salary
stream and present as an employer.

**Mitigation:** either gate `createStream` on a signed employer attestation, or remove the
verification language from the schema and docs until the checks exist.

### H-5 — Rate limits are keyed on identity that costs nothing to replace

**Files:** `apps/pot/lib/server/trust.ts:135-188` · live `public.send_limits`,
trigger `payments_enforce_limits`

The DB trigger exists and is the real enforcement point — good. But every limit is scoped to
`sender_did` (and `recipient_did` for the pair limits). A Privy DID is created by signing in with a
fresh Google account, which is free and unlimited, and each new DID gets a fresh embedded wallet
and a fresh daily allowance. There is no per-device key, no per-IP limit, no velocity check across
DIDs, and **no global circuit breaker** anywhere in the codebase.

Also `trust.ts:141-143` computes the day boundary with `new Date(); setHours(0,0,0,0)` — the
*server's* local midnight, which on a UTC host is 05:30 IST. The application's notion of "today"
and the trigger's will not agree, and the reset time moves with deployment region.

**Mitigation:** bind limits to a device attestation (which is C-3) or a funding source; anchor the
day boundary to an explicit `Asia/Kolkata` date in both layers; add a global spend ceiling with an
automatic halt.

---

## 4. Medium findings

### M-1 — Step-up authentication is specified and never enforced; no passkey assertion is ever verified

**Files:** `apps/pot/lib/server/trust.ts:190-196` · `apps/pot/lib/server/privy.ts:77-79`, `:141`

`requiresStepUp()` has no callers. `Caller.hasPasskey` is derived from
`linkedAccounts.some(a => a.type === "passkey")` — that is **passkey *enrolment*, not a fresh
assertion**. Nothing in the repository verifies a WebAuthn assertion, checks its challenge, or
binds one to a payment amount. The `stepup_required` / `stepup_passed` audit events
(`lib/server/db.ts:38-39`) can never be emitted.

Answering §2.1 directly: a new assertion is not required for a transfer over the threshold, and no
assertion is accepted either, cached or otherwise — the mechanism is absent.

### M-2 — Four SECURITY DEFINER trigger functions are callable over the public REST API

**Location:** `public.claim_matches_policy`, `claim_progress_needs_proof`,
`decision_within_coverage`, `policy_product_is_sellable` — all introduced by
`supabase/migrations/20261010_micro_insurance_trust_layer.sql` **in this session**.

Supabase's linter flags all four as executable via `/rest/v1/rpc/<name>` by both `anon` and
`authenticated` (`anon_security_definer_function_executable`,
`authenticated_security_definer_function_executable`, level WARN).

Exploitability is low and I will not inflate it: these are plpgsql trigger functions that
dereference `NEW`/`OLD`, so a direct RPC call raises "trigger functions can only be called as
triggers" rather than doing anything. `search_path` is pinned to `public` in each, which closes the
usual SECURITY DEFINER escalation. It remains unnecessary attack surface that should not be
exposed.

**Mitigation:** `revoke execute on function public.<name>() from anon, authenticated;` for all four.

### M-3 — A stale, drifted duplicate of the contracts sits inside the workspace

**Files:** `packages/contracts-copytest/` (1217 files, its own `.git` and `.gitmodules`,
`foundry.toml`, `src/{PotManager,SocialPay,TestRupee}.sol`, 4 test files) ·
`packages/_probe/x.txt`

`diff -q packages/contracts-copytest/src/PotManager.sol packages/contracts/src/PotManager.sol`
reports the files **differ** — this is the pre-v2 contract code. It is a complete, buildable Foundry
project under `packages/*`, left over from the monorepo move.

**Impact:** running `forge build`/`forge script` from the wrong directory deploys superseded
contracts with known-removed rules. No test or CI run would catch it, because it has its own
project root.

**Mitigation:** delete both directories.

### M-4 — No CI and no application-level tests

**Confirmed:** `.github/` does not exist. A search for `*.test.*`, `*.spec.*`,
`vitest.config*`, `jest.config*`, `playwright.config*` under `apps/` returns nothing.

`forge test` is run by hand. The 334 passing contract tests cover contracts only — `lib/server/*`
(the trust layer), `lib/store.ts`, `lib/queries.ts`, `lib/actions.ts` and `lib/tx.ts` have **no
tests at all**, and nothing prevents a regression from being committed.

### M-5 — `getLimits()` trusts that exactly one limits row exists

**File:** `apps/pot/lib/server/trust.ts:32-42`

`.from("send_limits").select("*").limit(1).single()` takes an arbitrary row. If a second row is
ever inserted, which limits apply depends on Postgres row order. There is no `check` constraint
pinning the table to one row and no ordering.

---

## 5. Low findings

- **L-1 — `.env.example` is itself gitignored.** `apps/pot/.gitignore:34` is `.env*`, which matches
  `.env.example` (confirmed with `git check-ignore -v`). The template new developers need cannot be
  committed. Add `!.env.example`.
- **L-2 — Gift's timeout release converts a conditional gift into an unconditional one.**
  `Gift.sol:263-275`: after `timeoutAt`, the recipient takes the money whether or not the condition
  was ever met. This is deliberate and documented at `:258-262` as anti-hostage protection, and it
  correctly bounds attester/sender collusion (answering §2.5: denial of a legitimate claim is
  temporary). The converse is the cost: a recipient who never fulfils the condition simply waits.
  Senders must understand `timeoutAt` is a deadline for *themselves*.
- **L-3 — Hashed off-chain text is brute-forceable.** `memoHash`, `conditionHash`,
  `policyTermsHash`, `signalHash` are unsalted `keccak256` of short strings. "cab", "rent",
  "groceries" fall to a dictionary in milliseconds, so the hashes are integrity commitments, not
  privacy. No plaintext is on-chain, which is correct; the privacy claim just should not be
  overstated.
- **L-4 — `_now()` narrows `block.timestamp` to `uint64`** in five contracts
  (e.g. `MicroCover.sol:445`, `BehaviourSavings.sol:399-402`). Correct until 2554; noted for
  completeness.
- **L-5 — The regulatory boundary is not in the README.** It is in `docs/limitations.md` and
  `docs/insurer-api.md`, which the README links but does not summarise. See §6.
- **L-6 — `premium_settlements` has RLS on and no policy** (Supabase linter INFO). This is
  **intentional** — deny-all to client roles — and the migration says so. Not a vulnerability;
  recorded so the linter output is not mistaken for one.

---

## 6. Theoretical risks

Labelled as such: these need a condition that does not hold today, or an actor outside the current
threat model.

- **T-1 — Malicious token reordering events.** All contracts are written for `TestRupee`, which has
  no transfer hooks. A token with callbacks could reenter; `nonReentrant` blocks state corruption,
  and after this session's change every money path in `MicroCover` emits before transferring. If the
  token is ever swapped for a non-standard ERC-20, re-review.
- **T-2 — Chain reorganisation on Monad.** Cover windows, claim windows, deadlines and cohort keys
  are wall-clock. A deep reorg could move an event across a boundary. Out of scope for testnet.
- **T-3 — Front-running.** `settleClaim` signatures are public once broadcast and anyone may submit
  them (by design), but the payout address is fixed to `p.insured`, so there is no gain. In
  `PotManager`, a member can front-run `closePot` with an instant `requestSpend` to consume their
  budget before refunds; this is within the rules, not a bypass.
- **T-4 — `uint64` cohort key collision in `BehaviourSavings`.** Cohorts key on the exact deadline
  second (`:239`), so honest users cluster only by coincidence. This is what makes C-2 easy to
  target, and separately means cohort economics are unpredictable in production.

---

## 7. What is not built

The most useful section. Exhaustive, by category.

**Absent entirely (no file, no stub):**
1. `apps/pot/app/api/` — **no API routes exist at all.** Every route in `docs/insurer-api.md` §4 is
   specification only.
2. Server signing key: no key material, no KMS client, no env variable, no signing call anywhere.
3. Play Integrity verification (Prompt 02) — no client, no token verification.
4. App Attest / DeviceCheck (Prompt 02) — same.
5. WebAuthn/passkey assertion verification (Prompt 01) — same.
6. Account Aggregator integration (Prompt 04) — no Setu/Finvu/Sahamati client. Only the
   `aa_consents` table and its `income_requires_active_consent` trigger exist.
7. C2PA provenance verification (Prompt 07) — only a nullable `c2pa_verified` column.
8. Screen-time entitlement provisioning (Prompt 02) — no code path.
9. Step count / physiological bounds checking (Prompt 02) — no code, no documented bounds.
10. Collusion detection (Prompt 03) — **not implemented and not described anywhere.** No signals,
    no thresholds, no false-positive analysis. There is no accountability-pool contract either.
11. Commitment-contract module (Prompt 02) — no contract. `BehaviourSavings` (Prompt 08) is the
    nearest and is a different design.
12. Insurer-side signing service (Prompt 07) — the contract check is real; nothing can produce the
    signature.
13. Global circuit breaker / abuse halt — none in any layer.
14. Verifier allowlist or registry for `BehaviourSavings` — none, and no admin to add one.

**Implemented but not wired to anything:**
15. `apps/pot/lib/server/trust.ts` — `handle`, `getLimits`, `ensureUser`, `resolveRecipient`,
    `assertWithinLimits`, `requiresStepUp`, `audit`: zero callers outside `lib/server/`.
16. `apps/pot/lib/server/privy.ts` — `verifyCaller`, `assertOwnAddress`: zero callers.
17. `apps/pot/lib/server/db.ts` — the service-role client: only used by the above.
18. Supabase tables with no reader or writer in app code: `users`, `payments`, `contacts`,
    `audit_log`, `send_limits`, `employers`, `employer_checks`, `employer_employees`,
    `stream_policy`, `stream_solvency`, `aa_consents`, `isa_agreements`, `isa_signatures`,
    `income_assessments`, `isa_repayments`, `insurers`, `cover_products`, `policies`,
    `exposure_declarations`, `claims`, `claim_evidence`, `claim_decisions`,
    `premium_settlements`. Only `pots`, `profiles` and `memos` are read or written by the app.
19. Seven of eight contracts have no frontend: only `PotManager` and `TestRupee` are used by
    `apps/pot`. `SocialPay`, `Gift`, `BehaviourSavings`, `SalaryStream`, `IncomeShare` and
    `MicroCover` have ABIs generated and no screen.

**Wired but not tested:**
20. The whole `apps/pot` application — no test files, no CI (M-4).

**Documented but not implemented:**
21. `docs/insurer-api.md` §4 endpoints, §5 transport authentication, §6 nonce/idempotency/clock-skew
    handling. The document states this itself.
22. "Set server-side after all three checks pass" (`employers` table comment) — no such code.
23. Step-up policy in `send_limits.stepup_threshold_paise` — threshold stored, never applied (M-1).

**Not deployed:**
24. No contract is deployed to any chain; `README.md` "Deployed addresses" is empty. No Privy App ID
    is configured, so no screen past the login gate has been rendered by a browser.

**Infrastructure gaps:**
25. Four of five Supabase migrations (`socialpay_trust_layer`, `pot_offchain_text`,
    `lock_down_trigger_function`, `employer_trust_layer`, `isa_trust_layer`) exist **only in the
    Supabase project**, not in the repository. The database cannot be rebuilt from source, and
    `stream_runway` (H-1) is only reviewable live.

---

## 8. Modules that passed, and how far I read

| Module | Extent of audit | Result |
|---|---|---|
| `TestRupee.sol` | Read in full | Clean. Faucet cooldown enforced, no owner, no arbitrary mint, no cap games. |
| `PotManager.sol` | Read `join`, `deposit`, `requestSpend`, `approveSpend`, `cancelSpend`, `closePot`, `claimRefund`, `_addMember`, constants | Sound **except** the missing approver≠recipient check (C-1 step 4). Dust goes to the last contributor deterministically; both loops bounded by `MAX_MEMBERS_CAP = 20` (`:195`); pending-request reservation prevents double-spend. |
| `SocialPay.sol` | Read state machine, `sendPayment`, `createClaimablePayment`, `confirmReceipt`, `claimPayment`, `reclaim`, `dispute`, `resolveDispute` | Clean for §2.1. `reclaim:275-279` requires `Held`/`Claimable` + sender + `block.timestamp >= p.deadline`; `confirmReceipt` transitions state and both are `nonReentrant`, so confirm and reclaim cannot both succeed. The confirm window is set once at creation (bounded 1 hour–30 days, `:63-64`) with no reset path. `arbitrator` is `immutable` (`:105`) and cannot decide alone — `resolveDispute` needs two of three (`:311-325`). Claimable payments are gated on a `claimHash` secret, not an email, so §2.1's email-registration hijack does not apply to the contract. |
| `Gift.sol` | Read in full | Clean. `irrevocable` enforced in-contract (`:282`); `cancel` impossible once `Attested` or past `releaseTime` (`:283-288`), so a sender cannot cancel after the condition is met; the condition is stored only as a hash. L-2 is a design trade-off, not a defect. |
| `SalaryStream.sol` | Read accrual, `withdraw`, `topUp`, `pauseStream`, `resumeStream`, `cancelStream` | Accrual is capped at the funded balance, so an employee cannot withdraw more than accrued (`withdraw:220` pays `settled - withdrawn`), and cancelling does not claw back accrued pay (`:50-52`). Sablier/Superfluid are deliberately not imported, with the reason at `:14-17` — so "pinned audited version" is N/A and the custom math carries the risk instead. Employer verification is H-4. |
| `IncomeShare.sol` | Read in full | Clean and well-scoped: no token, no balance, no `transfer`. Each repayment requires the recipient's own signature over that exact figure (`:195-200`), so **the server cannot unilaterally record income**; confirmations cannot be replayed across agreements or indices; terms and the agreement hash are fixed at creation. |
| `MicroCover.sol` | Read in full (written this session) | Payout requires the insurer's signature over contract+chain+policy+evidence+amount. A claim can be submitted only once per policy (`ClaimAlreadyMade`), so §2.7's "twice with different evidence hashes" is **not possible**; activation after the window reverts `AlreadyEnded`, so that state-machine axis is correct. Evidence is hash-committed on-chain, so tampering is detectable — though not prevented (§9). |
| Signature replay, all contracts | Audited every `ECDSA.recover` path | **No replay gaps found.** All four digests (`Gift.attestationDigest`, `BehaviourSavings.behaviourDigest`, `IncomeShare.repaymentDigest`, `MicroCover.settlementDigest`) bind `address(this)` **and** `block.chainid` **and** the record id; `IncomeShare` additionally binds the sequence index. Cross-chain, cross-contract and cross-record replay are closed. These are hand-rolled EIP-191 digests, not EIP-712, so §1.2's "is the domain separator correct" is N/A — the equivalent binding is present and correct. |
| Solidity hygiene (Section 3) | Repo-wide search | No `unchecked`, no `.transfer`/`.send`/`.call{value:}`, no `assembly`, no `delegatecall`, no `selfdestruct`, no `tx.origin`, no `block.number`. All five money-holding contracts use `ReentrancyGuard` + `SafeERC20`. No `Ownable`, no admin, no proxy, no pause authority — nothing to compromise. Zero-address and zero-amount checks present on every entry point read. `forge fmt --check` clean. |
| Frontend trust boundary (Section 4) | Read `tx.ts`, `providers.tsx`, `login-gate.tsx`, all `components/pot/*`; searched every `.tsx` | **Passed.** `lib/tx.ts:57-64` waits for the receipt and throws unless `status === "success"`, so no success toast precedes chain confirmation. No secret, key or signature is stored client-side. The app calls no API route (none exists), so no route trusts client data. A search for `guarantee/guaranteed/insured/yield/secure/risk-free/APY/interest` across all `.tsx` returns **no prohibited guarantee language**. The "test money" tag is present on balance surfaces (`test-money-card.tsx:34`, `pot/[id]/page.tsx:110`, `add-money-dialog.tsx:84`). |
| Test suites | Ran all | `forge test` → **334 passed, 0 failed, 0 skipped** across 9 suites: PotManager 80, PotManagerSecurity 2, SocialPay 46, SocialPaySecurity 4, Gift 38, SalaryStream 37, BehaviourSavings 34, IncomeShare 31, MicroCover 62. `npx tsc --noEmit` → no errors. `npx eslint` → no issues. `next build` → compiled successfully, 7 routes. **No test failures to report.** |

---

## 9. Failure-mode matrix

Per module. "Detected?" means the system notices; "User-visible?" means a person is told.

### Pot (`PotManager`) — the only module with a frontend

| Failure | Detected? | User-visible? | Recoverable? | Notes |
|---|---|---|---|---|
| Server key compromised | N/A | N/A | N/A | No server key exists; Pot's flow is wallet-signed end to end. |
| External service unavailable | Partly | Yes | Yes | Supabase down → `store.ts` falls back to on-device storage; names/memos degrade, money unaffected. Privy down → login gate blocks everything. |
| Signature replay attempted | N/A | — | — | No signatures in Pot's paths. |
| Duplicate submission | Yes | Yes | Yes | State machine rejects; `nonReentrant` on all money paths. |
| Network congestion | Yes | Yes | Yes | `waitForTransactionReceipt` blocks the UI until the receipt lands. |
| Device attestation fails | **No** | No | — | Not implemented (C-3). |
| Consent revoked mid-flow | N/A | — | — | No consent concept in Pot. |
| **Invite code leaked** | **No** | **No** | **No** | C-1. Nothing detects an uninvited join; funds leave irreversibly. |

### SocialPay, Gift, SalaryStream, IncomeShare, BehaviourSavings, MicroCover

| Failure | Detected? | User-visible? | Recoverable? | Notes |
|---|---|---|---|---|
| Server key compromised | **No** | No | — | No key, no monitoring, no revocation. For `Gift`/`BehaviourSavings`/`MicroCover` a compromised signer forges releases, successes and payouts. Blast radius is per-contract because each digest binds `address(this)` — that isolation is real and worth keeping. Roles are `immutable`, so **recovery requires redeployment**. |
| External service unavailable | **No** | No | — | No integrations exist to fail (C-3). |
| Signature replay attempted | **Yes** | Yes (revert) | Yes | Strongest area: all digests bind contract + chain + record. |
| Duplicate submission | Yes | Yes (revert) | Yes | State machines reject; `MicroCover` one claim per policy; `IncomeShare` index-bound. |
| Network congestion | Partly | No | Yes | No frontend for any of these six, so nothing surfaces. |
| Device attestation fails | **No** | No | — | Not implemented. `exposure_declarations.attestation` can record `unavailable`, but nothing writes it. |
| Consent revoked mid-flow | **Yes, immediately** | No | Yes | The `income_requires_active_consent` trigger on `income_assessments` blocks at the database on the next write — **not** a next-pull-cycle delay, answering §2.4. No user-facing surface, and no AA client to revoke from. |
| Evidence deleted after a dispute | Partly | No | **No** | `MicroCover` commits `evidenceHash` on-chain so tampering is *detectable*, but Supabase Storage objects are deletable by the service role and nothing replicates or WORM-locks them. §2.7: evidence does **not** reliably survive a dispute. |

---

## 10. Regulatory boundary verification (modules 04 and 07)

| Check | Result |
|---|---|
| Boundary documented | **Partly.** `docs/limitations.md` has "What requires a licensed partner" (ISA) and "What requires an IRDAI-licensed insurer" + "What the IRDAI sandbox allows"; `docs/insurer-api.md` opens with a status table. **`README.md` itself does not state either boundary** — it only links `docs/limitations.md`. Recorded as L-5, not Critical: the boundary *is* documented, just not in the README. |
| Frontend prevented from implying live | **Yes.** No frontend exists for either module, and no prohibited guarantee language anywhere in the app. |
| Clear placeholder for the licensed partner | **Yes.** `MicroCover.insurer`/`insurerSigner`, `IncomeShare.recorder`, the `insurers` table with `irdai_registration_no`, and `cover_products.sellable` gated on `irdai_filing_reference` by a DB constraint. |
| Code that would constitute unlicensed activity on mainnet with real money | **Yes — C-4.** `Deploy.s.sol` defaults both insurer roles and the ISA recorder to the deployer, with no network guard. Critical per this section's rule. |

---

## 11. Recommended remediation order

Ranked by blast radius and reachability, not by label.

1. **C-1** — world-readable invite codes plus the missing approver≠recipient check. Cheapest fix,
   largest reachable loss, exploitable by anyone with a browser the moment Pot is deployed. Two
   one-line changes (`approveSpend` check; stop returning `invite_code`) plus a policy rewrite.
2. **C-4** — add the mainnet/required-env guard to `Deploy.s.sol`. Minutes of work, and it is the
   difference between a demo and unlicensed insurance.
3. **H-1** — `stream_runway` SECURITY DEFINER. One `alter view … set (security_invoker = true)`;
   currently leaking cross-tenant data on a live project.
4. **C-2** — `BehaviourSavings` verifier constraint. Needs a design decision (registry vs immutable
   signer set), so it is slower than its severity suggests; until then do not ship `ExternalSignal`
   goals with redistribution.
5. **H-2** — close the open Supabase write policies. Blocked on there being a server to move writes
   behind, i.e. on C-3.
6. **C-3** — build the trust layer: key custody first (KMS/HSM, never an env var), then the signer
   service, then routes on top of the already-written `handle()` wrapper. Largest body of work;
   everything in §7 depends on it.
7. **H-3** — make the audit log genuinely append-only before it has anything worth hiding.
8. **M-3** — delete `packages/contracts-copytest/` and `packages/_probe/`. Trivial; prevents
   deploying superseded code.
9. **H-4, H-5, M-1** — employer verification, limit-bypass surface, step-up enforcement. All fold
   into the C-3 work.
10. **M-2, M-4, M-5, L-1 … L-6** — hygiene; do them alongside the above.

---

## 12. Pre-mainnet checklist

Nothing on this list is optional before real money.

- [ ] C-1, C-2 and C-4 fixed, each with a regression test that fails without the fix.
- [ ] A licensed insurer partner contracted, with `INSURER`/`INSURER_SIGNER` set to their addresses,
      and an IRDAI-licensed counterparty for `IncomeShare.recorder`. Deployment refuses otherwise.
- [ ] Signing keys in a KMS or HSM, never in an env var, with a documented rotation procedure. Note
      that `insurerSigner`, `recorder` and `arbitrator` are `immutable`, so **rotation means
      redeployment** — decide now whether that is acceptable or whether a registry indirection is
      needed before launch.
- [ ] An external audit by a firm, covering the contracts **and** the trust layer. This document is
      an internal review written by the author of much of the code under review; it is not an
      independent audit and must not be presented as one.
- [ ] Play Integrity and App Attest verified server-side, with the `unavailable` case given an
      explicit policy rather than a default.
- [ ] Every API route behind `verifyCaller`, with `assertOwnAddress` on any address the client sends.
- [ ] Audit log append-only and hash-chained, with alerting on write failure.
- [ ] Rate limits bound to something that costs money to replace; a global circuit breaker with a
      tested halt.
- [ ] Evidence storage WORM-locked or replicated, with a retention policy agreed with the insurer.
- [ ] All Supabase migrations in the repository; the database rebuildable from source; zero ERROR
      and zero WARN from the Supabase security advisors.
- [ ] CI running `forge test`, `forge fmt --check`, `tsc`, `eslint` and a frontend test suite on
      every push; `packages/contracts-copytest/` deleted.
- [ ] A deployed-addresses section in the README filled in from a real broadcast, and at least one
      full user journey exercised by a person in a browser — which, as of today, has never happened.

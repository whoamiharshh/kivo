# API_REFERENCE

Part of the [PROJECT_DOSSIER](PROJECT_DOSSIER.md). Every route handler under
`apps/pot/app/api` was read in full on 2026-10-12. Nothing here was executed
against a running server in this pass; the only runtime evidence is the prior
report (`docs/production-readiness.md`) that unauthenticated `GET /api/pots` and
`GET /api/pots/activity?potId=1` returned 401 on a local server.

## 1. Conventions

- All routes are Node route handlers; all responses carry `cache-control: no-store`.
- JSON errors have the shape `{ "error": "<sentence for a person>", "reason": "<machine code>" }`.
- Authentication (every route except `/api/internal/pot-index`): **two Privy tokens**
  — header `Authorization: Bearer <access token>` and header
  `x-privy-id-token: <identity token>`. The embedded wallet address is read from
  the signed identity token (never from the body) and lower-cased. Requires the
  Privy dashboard setting "Return user data in an identity token".
- `POST /api/trust/*` routes are wrapped by `handle()` (`lib/server/trust.ts`),
  which in order: origin check → per-IP throttle → `verifyCaller` → `ensureUser`
  (upsert into `users`) → route function. Rejections write `audit_log` rows.
  `GET /api/pots*` call the same guards and `verifyCaller` directly but **not**
  `handle()`/`ensureUser`/audit.
- Origin check: if an `Origin` header is present it must equal the request URL's
  origin, `NEXT_PUBLIC_APP_URL`'s origin, or (non-production only)
  `http://localhost:3000` / `http://127.0.0.1:3000`; otherwise 403
  `cross_origin_blocked`. A missing `Origin` is allowed (curl, server-to-server).
  No CORS headers are ever returned.
- Per-IP throttle: in-memory map, default **240 requests/minute/IP**
  (`TRUST_IP_MAX_PER_MINUTE`), 429 `ip_rate_limited`. Per-instance on serverless;
  `README.md` still says "10 requests a minute" (outdated — Contradiction C-5).
- Per-DID throttle: `assertNotTooFrequent` counts `trust_nonces` rows per
  `(signer_did, action_type)` in the last hour; fails closed with 500
  `rate_check_failed`; 429 `rate_limited` over the limit.
- Body limit: 64 KiB (`413 payload_too_large`), checked on `content-length` and
  on the actual text before JSON parsing. Body must be a JSON object (`bad_json`).
- Field readers (strict, no coercion): `readId` (safe integer ≥ 0), `readHash`
  (`0x`+64 hex), `readSignature` (`0x`+130 hex), `readText(max)`, `readOneOf`,
  `readBool`, `readPaise(max)` (decimal **string** `^[0-9]{1,20}$`, parsed to BigInt),
  `readDay` (`YYYY-MM-DD`, rejects impossible dates).
- Signing gate: any route that needs `TRUST_SIGNER_KEY` fails with **503**
  `signer_unavailable` ("This action is temporarily unavailable. Existing funds
  are unchanged.") unless `TRUST_SIGNER_ENABLED=true`, and also if the configured
  key's address is the compromised legacy signer. With the default configuration
  **every signing route below returns 503**.

Common error responses: 401 `missing_access_token` / `missing_identity_token` /
`bad_access_token` / `bad_identity_token`; 403 `token_subject_mismatch` /
`no_embedded_wallet` / `cross_origin_blocked`; 413; 429; 500 generic
"Something went wrong".

## 2. Endpoint index

| Method & path | Auth | Needs signer key | Writes DB | Chain access | Used by client |
|---|---|---|---|---|---|
| `POST /api/trust/authorize-action` | yes | **yes** | `users`, `trust_nonces` (read `pots_private`) | none | `authorizeJoin` (Join page) |
| `POST /api/trust/authorize-join` | yes | yes | same | none | **nothing** (alias re-export) |
| `POST /api/trust/attest-behaviour` | yes | yes | `behaviour_signals`, `trust_nonces` | none | savings "submit habit" |
| `POST /api/trust/attest-day` | yes | yes | `behaviour_signals`, `trust_nonces` | none | pools "mark today" (raw `fetch` in `pool.ts`) |
| `POST /api/trust/attest-condition` | yes | yes | `gift_conditions`, `trust_nonces` | read `Gift.getGift` | gifts "confirm" |
| `POST /api/trust/attest-oracle` | yes | yes (approve path) | `oracle_events`, `trust_nonces` | read `MicroCover.getClaim/getPolicy` | cover "decide claim" hook (no screen) |
| `POST /api/trust/attest-income` | yes | **no** (digest only) | `income_declarations`, `trust_nonces` | read `IncomeShare.getAgreement` | none (no Agreements UI) |
| `POST /api/trust/record-repayment` | yes | **yes** (server wallet) | `trust_nonces` (consume) | **writes** `IncomeShare.recordRepayment` | none |
| `POST /api/trust/verify-employer` | yes | yes | `employer_attestations`, `trust_nonces` | none | none found in UI |
| `GET /api/pots` | yes | no | none (reads `pot_activity_*`) | `getBlock(finalized)`, multicall `isMember` | **not under the working-tree discovery change** |
| `GET /api/pots/activity` | yes | no | none (reads `pot_activity_*`) | `getBlock(finalized)`, `isMember` | **not under the working-tree discovery change** |
| `POST /api/internal/pot-index` | bearer `POT_INDEXER_SECRET` | no | `pot_activity_*` | log scan of `PotManager` | nothing (manual) |

"Used by client" is from searching `lib/` and `app/`; verification that a
screen actually reaches each call is limited to code reading.

## 3. Trust endpoints

### 3.1 `POST /api/trust/authorize-action` — admit a joiner to a pot
- Body: `{ "action": "join_pot", "potId": <int ≥1>, "inviteCode": "0x<64 hex>" }`.
- Limit: 60 per DID per hour (`join_pot`).
- Flow: read `pots_private.invite_code` for `potId` with the service key;
  "no such pot" and "wrong code" are indistinguishable (403 `invite_rejected`);
  `signJoin` (expiry = now + 600 s, EIP-191 over the `PotManager.joinDigest`
  formula); `reserveNonce` (row written **before** returning); respond.
- Response 200: `{ "nonce": "<32 hex>", "expiry": <unix s>, "signature": "0x…" }`.
- Errors: 400 `bad_action`/`bad_potId`/`bad_inviteCode`; 403 `invite_rejected`;
  500 `lookup_failed`; 503 `signer_unavailable`; 429 `rate_limited`.
- Contract tie-in: `PotManager.join(potId, inviteCode, expiry, signature)`.
- **Dependency:** `pots_private` must contain the code. See dossier issue K-03.

### 3.2 `POST /api/trust/authorize-join`
Re-exports `authorize-action`'s `POST`. Same body (including `action`). Not called
by the app.

### 3.3 `POST /api/trust/attest-behaviour`
- Body: `{ "subject": "commitment_goal"|"accountability_pool"|"savings_goal",
  "subjectId": int, "goalId": int, "metric": "steps"|"screen_time_minutes",
  "value": int, "forDay": "YYYY-MM-DD" }`.
- Bounds: steps ≤ 50,000; screen-time minutes ≤ 1,440 (named error
  `value_out_of_bounds`, not clamped). Future dates → `day_in_future`
  (compared with the **server's UTC date**). 30/hour per DID.
- Signs `BehaviourSavings.behaviourDigest(goalId, signalHash)` where
  `signalHash = keccak256(abi.encode(subject, subjectId, callerDid, metric, value, forDay))`;
  inserts `behaviour_signals` (unique one-per-day → 409 `already_submitted`).
- Response: `{ nonce, expiry, signature, signalHash, bound, prototype: true }`.
- **Authorization gap (code-verified):** the route never checks that `goalId`
  belongs to the caller (it reads nothing from the chain), and
  `BehaviourSavings.submitBehaviour` accepts a relayed signature from anyone. Any
  signed-in user can obtain a verifier signature for any goal id with a number
  they type. This is consistent with the project's own "we take your word for it"
  disclosure but is broader than "the owner reports their own number".

### 3.4 `POST /api/trust/attest-day`
- Body: `{ "poolId": int, "forDay": "YYYY-MM-DD", "metric", "value" }`; same
  bounds and rules; 30/hour. Returns 503 `pool_not_configured` if the pool address
  is unset.
- Signs `AccountabilityPool.attestationDigest(poolId, caller.address, dayNumber)`
  — always for the caller's own address (a member cannot bank a day for a friend).
- Response: `{ nonce, member, day, expiry, signature, signalHash, bound, prototype }`.
- Does not check that the caller is a member of that pool (the contract does,
  `NotMember`).

### 3.5 `POST /api/trust/attest-condition`
- Body: `{ "giftId": int, "evidenceHash": "0x<64 hex>" }`; 30/hour.
- Reads `Gift.getGift(giftId).conditionHash` from chain, signs
  `Gift.attestationDigest`, upserts `gift_conditions` (`condition_text` is the
  literal placeholder "(set when the gift was created)").
- **No check that the caller is the gift's attester or recipient.** And the
  signature only validates on-chain if the gift's `attester` equals the trust
  signer address — which the app's create-gift screen never sets (it sets a chosen
  person's wallet). See dossier issue K-02.

### 3.6 `POST /api/trust/attest-oracle` (prototype claim decision)
- Body: `{ "policyId": int, "eventType": text≤60, "eventOccurred": bool,
  "payoutPaise": "<decimal string>" }` (payout required only when
  `eventOccurred`); 20/hour.
- Checks (code-verified): caller address must equal the policy's `insured`
  (403 `not_your_policy`); payout ≤ coverage (`above_coverage`); `eventOccurred`
  false produces **no** signature and records a declined row. Evidence hash is
  read from the chain claim, not the request.
- Records `oracle_events` (unique per `(policy_id, event_type)` → 409
  `already_decided`) with `source: 'simulated'`.
- Response: `{ nonce, expiry, signature, payoutPaise, prototype: true }` or
  `{ declined: true, prototype: true }`.
- This is the insured pressing a button to authorize their own payout — a
  deliberate simulation (README, `docs/limitations.md`), not an adjudication.

### 3.7 `POST /api/trust/attest-income` (Agreements, step 1)
- Body: `{ "agreementId": int, "forMonth": "YYYY-MM-DD", "incomePaise": "<decimal string ≤ 10,000,000,000>" }`; 12/hour.
- Reads `IncomeShare.getAgreement`; caller must be the agreement's `recipient`
  (403 `not_your_agreement`); `share = income × percent / 100` (integer
  truncation), clipped to the remaining cap; 409 `already_repaid` when the cap is
  consumed. Computes `IncomeShare.repaymentDigest(agreementId, repaymentCount,
  income, repayment)`, reserves a nonce, **inserts `income_declarations` before the
  recipient has signed**, returns the digest for the *recipient's wallet* to sign.
- Response: `{ nonce, digest, index, incomePaise, repaymentPaise, prototype: true }`.
- Observation: `income_declarations` is unique per `(agreement, month)` → a second
  attempt after an abandoned signature returns 409 `already_declared` with no way
  to retry (issue K-13).

### 3.8 `POST /api/trust/record-repayment` (Agreements, step 2)
- Body: `{ "agreementId": int, "nonce": "<32 hex>", "incomePaise", "repaymentPaise"
  (decimal strings), "signature": "0x<130 hex>" }`.
- Consumes the nonce first (409 `nonce_already_used` on reuse/expiry), then the
  **server wallet** (trust signer key) sends `IncomeShare.recordRepayment`. The
  contract independently verifies the *recipient's* signature, so the server
  cannot invent a repayment; it can refuse or carry a stale signed one.
- Response: `{ "txHash": "0x…" }`. Errors: 502 `record_failed`; 503 signer.
- The route does not wait for the receipt and does not re-check that the signed
  figures match a stored declaration.

### 3.9 `POST /api/trust/verify-employer`
- Body: `{ "employerAddress": "0x…", "entityProof": text≤200, "proofKind":
  "self_asserted"|"gst"|"cin" }`; address must equal the caller's wallet; shape
  checks only (GSTIN / CIN regexes); 10/hour.
- Upserts `employer_attestations` with `verified: false` **hardcoded**.
  `SalaryStream` consults none of this. Response `{ nonce, signature, issuedAt,
  verified: false, prototype: true }`.

## 4. Pot discovery/history endpoints (implementation A)

### 4.1 `GET /api/pots`
Auth required. Reads `pot_activity_sync` (503 `pot_index_not_ready` if the row is
missing — the live DB's state), pages `pot_activity_members` for the caller
(500 rows/page), rechecks `isMember` at the finalized block with a multicall in
batches of 100, returns `{ potIds: number[], isCatchingUp: boolean, sync:
{ indexedThrough: string|null, finalizedBlock: string } }`.

### 4.2 `GET /api/pots/activity?potId=<n>&limit=<≤50>&beforeBlock=<n>&beforeLog=<n>`
Auth required; caller must be a member at the finalized block (403 "You are not
in this pot."); returns `{ items: [{ eventName, args, blockNumber, blockTimestamp,
transactionHash, logIndex }], nextCursor|null, sync }`, newest first, default page
30. Cursor parameters must be supplied together. 503 on DB/RPC failure.

### 4.3 `POST /api/internal/pot-index`
Bearer `POT_INDEXER_SECRET` (timing-safe compare; 503 if unset, 401 if wrong).
Runs one indexing pass (see ARCHITECTURE §5) and returns `{ status:
"indexed"|"up-to-date"|"busy", finalizedBlock, scannedFrom?, scannedTo?,
eventCount?, hasMore? }`. No scheduler calls it.

## 5. Supabase direct access from the browser (not an API route, but an interface)

`lib/store.ts` uses the public anon key from the browser:
`pots` upsert/select, `profiles` upsert/select, `memos` upsert/select, and an
INSERT into `pots_private` (immediately followed by `.select()`). See the security
document: the open policies allow anyone with the anon key to overwrite pot names,
display names (which label people in the repay picker) and memos.

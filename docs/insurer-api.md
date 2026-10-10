# The insurer API contract

How this application and a licensed insurer talk to each other, and which side
is allowed to decide what.

**Status, first, so nothing here is mistaken for working software:**

| Part | State |
|---|---|
| Evidence store and insurer rails in Postgres | ✅ applied to Supabase, guards and RLS verified by trying to break them |
| `MicroCover.sol` — escrow, bind, claim, signed settlement | ✅ 62 tests, 100% of lines and functions |
| The HTTP endpoints below | ❌ **specified here, not implemented.** There is no `app/api/` directory. |
| A licensed insurer partner | ❌ none. Both insurer roles default to the deployer on testnet. |
| Anything carrying real money or real cover | ❌ and must not, until the above two exist |

This document is the thing you hand an insurer's integration team. It is not a
description of running code, and the table above is the honest part of it.

---

## 1. The trust boundary

One rule decides every design question below: **the insurer decides, the
application records and moves money.**

| Decision | Who | Enforced where |
|---|---|---|
| Whether to cover this person, at this price | Insurer | Off-chain. The app cannot quote a product that is not `sellable`, and `sellable` requires an IRDAI filing reference (DB constraint). |
| Whether the risk is bound | Insurer | `activatePolicy` — insurer-only, and refuses unless the reserve is funded. |
| Whether a claim is payable, and for how much | Insurer | `settleClaim` — requires the insurer's ECDSA signature over the exact amount. There is no override and no admin path. |
| That a claimant is the insured party, and the event fell in the cover window | Application | Postgres triggers on `claims`. |
| That evidence exists and is unaltered | Application | `claim_evidence` SHA-256 + Storage; `evidenceHash` on-chain. |
| Custody of premiums in transit | Application | Escrowed in `MicroCover`, remittable only after binding. |

The application is therefore a **recording and settlement agent**. It never
underwrites, never adjudicates, and has no code path by which it could.

## 2. Keys

Three distinct secrets, deliberately not interchangeable.

| Key | Held by | Used for | Recorded as |
|---|---|---|---|
| **Claims signing key** (secp256k1) | Insurer | Authorising payouts. The only key that can move a claim payment. | `insurers.signer_address`, and must equal `MicroCover.insurerSigner()` |
| **Insurer treasury key** | Insurer | Funding the reserve, calling `activatePolicy`, pulling premiums | `MicroCover.insurer()` |
| **App request key** (secp256k1) | This application | Signing outbound requests to the insurer, so the insurer can tell a real request from a forgery | Exchanged at onboarding |

**The treasury key cannot authorise a payout.** That separation is tested
(`test_RevertWhen_TheInsurerTreasurySignsInsteadOfTheSigningKey`): the address
that funds the reserve and binds risk is not the address that approves claims,
so an operations key with day-to-day on-chain duties is not also a claims
authority. An insurer may of course use one key for both, and loses that
property if it does.

## 3. The money, end to end

```
buyer pays premium ──▶ MicroCover escrow        (createPolicy)
                            │
          insurer binds ────┤                   (activatePolicy — needs funded reserve)
                            │
              ┌─────────────┴──────────────┐
              ▼                            ▼
    premium becomes remittable      cover is live
    (remitPremiums, insurer pulls)        │
                                          ▼
                              claim ──▶ insurer decides ──▶ settleClaim
                                                             │
                                          ┌──────────────────┴─────────────┐
                                          ▼                                ▼
                                payout to the insured            decline (amount 0)
```

If the insurer never binds, the premium goes back to **whoever paid it** —
`declineToBind` immediately, or `refundUnboundPremium` after `BIND_WINDOW`
(1 day), permissionlessly, so the buyer never depends on the insurer's
cooperation to recover money that bought no cover.

Premium routing is a **pull**, not a push: the app accrues `remittablePremium`
as policies are bound, and the insurer's treasury calls `remitPremiums()` on
whatever schedule the commercial agreement sets. `premium_settlements` is the
off-chain statement for that schedule — period, gross premium, policy count,
reference — and exists so the two sides can reconcile. No client role can read
it.

## 4. Endpoints

Base URL per insurer, from `insurers.api_base_url` (HTTPS enforced by a check
constraint). All bodies are JSON. All timestamps are RFC 3339 with an explicit
offset. All money is **integer paise** — never a float, never a rupee string.

### 4.1 Application → insurer

#### `POST {base}/v1/bind-requests`

Asks the insurer to bind a policy whose premium is already escrowed on-chain.

```json
{
  "request_id": "a3f1…",
  "policy": {
    "onchain_id": 41,
    "contract": "0x0000000000000000000000000000000000000000",
    "chain_id": 10143,
    "product_code": "LAPTOP3H",
    "insured_address": "0x1111111111111111111111111111111111111111",
    "premium_paise": 2000,
    "coverage_paise": 5000000,
    "starts_at": "2026-10-01T10:00:00+05:30",
    "ends_at": "2026-10-01T13:00:00+05:30",
    "terms_sha256": "aaaa…"
  },
  "exposure": {
    "basis": "declaration_plus_device",
    "declaration_sha256": "bbbb…",
    "declaration_signature": "0x…",
    "platform": "play_integrity",
    "attestation": "passed",
    "attestation_payload_sha256": "cccc…"
  },
  "issued_at": "2026-10-01T09:59:12+05:30"
}
```

The insurer's underwriting decides. A `202` means "received"; the actual
decision arrives on the webhook in 4.2. **The app does not treat a `202` as
cover**, and no screen may say cover is live until `activatePolicy` has landed.

#### `POST {base}/v1/claims`

Notifies the insurer of a claim, with the evidence manifest — hashes and
metadata, never bytes.

```json
{
  "request_id": "7c22…",
  "claim": {
    "onchain_policy_id": 41,
    "evidence_bundle_sha256": "dddd…",
    "event_at": "2026-10-01T11:20:00+05:30",
    "reported_at": "2026-10-01T12:05:00+05:30",
    "description": "Screen cracked when the bag was dropped at the metro gate.",
    "policy_was_active_at_event": true
  },
  "evidence": [
    {
      "kind": "repair_invoice",
      "sha256": "eeee…",
      "byte_size": 48210,
      "mime_type": "application/pdf",
      "captured_at": "2026-10-01T18:40:00+05:30",
      "uploaded_at": "2026-10-01T18:41:03+05:30",
      "download_url": "{signed, short-lived Supabase Storage URL}",
      "c2pa_verified": null
    }
  ],
  "issued_at": "2026-10-01T12:05:04+05:30"
}
```

`policy_was_active_at_event` is the app asserting the check its trigger already
enforced. The insurer should re-derive it from `starts_at`/`ends_at` rather than
trusting the boolean — an assertion from a counterparty is not evidence.

`evidence_bundle_sha256` is `sha256` over the evidence `sha256` values in the
order listed. That exact value becomes `evidenceHash` on-chain, which is what
binds the insurer's eventual signature to this specific bundle.

#### `POST {base}/v1/settlement-statements`

The premium statement for a period, matching one `premium_settlements` row.
Reconciliation only; it moves no money.

### 4.2 Insurer → application (webhooks)

#### `POST {app}/api/insurer/bind-decisions`

```json
{
  "decision_id": "bd_8831",
  "onchain_policy_id": 41,
  "bound": true,
  "reason": null,
  "decided_at": "2026-10-01T10:00:41+05:30",
  "nonce": "9f21c4…"
}
```

`bound: true` → the app expects the insurer's treasury to call
`activatePolicy(41)`. The webhook is the notification; **the on-chain call is
the fact.** The app reflects `policies.status = 'active'` from the chain event,
not from this message. `bound: false` → the app expects `declineToBind`, and
falls back to `refundUnboundPremium` after the bind window if the insurer does
nothing.

#### `POST {app}/api/insurer/claim-decisions`

The only message that can cause money to move.

```json
{
  "decision_id": "cd_4412",
  "onchain_policy_id": 41,
  "decision": "approve",
  "payout_paise": 1200000,
  "reason": "Accidental damage, within cover. Assessed against invoice.",
  "decided_at": "2026-10-02T15:04:00+05:30",
  "nonce": "4b77ad…",
  "evidence_bundle_sha256": "dddd…",
  "payout_authorisation": "0x{65-byte signature}"
}
```

- `decision: "reject"` must carry `payout_paise: 0` and a `reason`. A database
  constraint refuses an approval of zero and a rejection above zero.
- `payout_authorisation` is the signature defined in §5. **Without it the app
  cannot settle the claim, and will not pretend to have tried.**
- `reason` is shown to the claimant. RLS lets a claimant read the decision on
  their own claim precisely so a rejection is explainable to them, and so they
  can take it to the insurer's grievance process.

## 5. The payout authorisation

This is the heart of the integration, so it is specified exactly.

The insurer's claims signing key signs this, and nothing else, to authorise a
payout:

```
inner  = keccak256(abi.encode(
             address  microCoverAddress,   // the deployed contract
             uint256  chainId,             // 10143 for Monad Testnet
             uint256  policyId,
             bytes32  evidenceHash,        // the bundle hash committed on-chain
             uint256  payoutAmount         // paise; 0 means decline
         ))

digest = keccak256("\x19Ethereum Signed Message:\n32" || inner)

signature = secp256k1_sign(claimsSigningKey, digest)     // 65 bytes, r ‖ s ‖ v
```

`abi.encode` left-pads each field to 32 bytes, so the preimage is 160 bytes.
The contract exposes `settlementDigest(policyId, payoutAmount)` so an insurer
can read back the exact digest before signing, rather than reconstructing it and
hoping.

**What this binding buys, each one a test in `MicroCover.t.sol`:**

- A signature for ₹10 cannot pay ₹10,000 — the amount is in the preimage.
- A signature for policy 41 cannot settle policy 42.
- A signature cannot be lifted onto different evidence: re-papering a claim
  after approval changes `evidenceHash` and so changes the digest.
- A signature cannot be replayed onto another chain or another deployment —
  both are in the preimage.
- Settling twice is impossible: the claim leaves `Submitted`, and a second
  attempt reverts `NoClaim`.

**Anyone may submit the signature.** `settleClaim` authenticates the signature,
not the caller, so the insured can collect their own payout without waiting for
the insurer to send a transaction or pay gas. This is intentional: a claimant
who has already been approved should not be stallable by inaction.

### Transport authentication

Separately from the payout authorisation, every webhook body is authenticated so
the app can tell a real decision from a forged POST:

```
X-Insurer-Key-Id:    {key id}
X-Insurer-Timestamp: {unix seconds}
X-Insurer-Nonce:     {nonce, also present in the body}
X-Insurer-Signature: {signature over  timestamp ‖ "." ‖ raw request body}
```

The raw body bytes are signed, not a re-serialisation, because JSON key order
and whitespace are not stable across languages.

## 6. Replay, idempotency and clocks

- **Nonce.** `unique (insurer_id, nonce)` on `claim_decisions`. A captured
  decision replayed against a second claim is rejected by Postgres — verified.
- **Idempotency.** `request_id` and `decision_id` are the idempotency keys.
  Re-delivering the same decision must be safe; the app stores the first and
  returns `200` to duplicates.
- **Clock skew.** Reject a webhook whose `X-Insurer-Timestamp` is more than
  300 seconds from the app's clock. `decided_at` and `received_at` are both
  stored, so a slow or back-dated delivery stays visible afterwards.
- **Ordering.** Webhooks may arrive out of order. State transitions are
  validated against the current row, never assumed from arrival order.

## 7. What the application refuses

Not politeness — these are enforced, and each was tested by attempting it:

1. A policy against a product with no IRDAI filing reference (DB trigger).
2. A claim from anyone but the insured party (DB trigger).
3. A claim whose event falls outside the cover window (DB trigger).
4. Moving a claim past `submitted` with no evidence rows (DB trigger).
5. Marking a claim `paid` with no signature-verified approval (DB trigger).
6. A decision from an insurer whose status is not `active` (DB trigger).
7. A payout exceeding the policy's coverage (DB trigger **and** contract).
8. A payout with no valid signature from the claims signing key (contract).
9. An insurer binding cover its reserve does not fully collateralise (contract).
10. A client writing any of these rows directly — no client role has an insert,
    update or delete policy on any table in this schema.

## 8. Key rotation and offboarding

- Rotating the **claims signing key** changes `MicroCover.insurerSigner`, which
  is `immutable`. In practice that means deploying a new `MicroCover` and
  letting existing policies run out under the old one. This is a deliberate
  trade: a mutable signer would be a single mutable authority over every future
  payout. It is a real operational cost, and an insurer should know about it
  before signing anything.
- Setting `insurers.status` to `suspended` stops new decisions being accepted at
  the database layer immediately. It does **not** invalidate a signature already
  issued, because the contract cannot read the database.
- Committed reserve stays committed. An insurer cannot walk away from live cover
  by changing a status field — `withdrawReserve` refuses while cover is
  committed, and capital frees up only as policies close.

## 9. Open questions for an insurer partner

Honest list of what cannot be settled from this side:

1. **Collateral.** This rail demands 100% on-chain collateral per policy. A real
   insurer will not accept that at volume. What replaces it, and what does the
   app verify instead?
2. **Who assesses.** Which licensed assessors are acceptable, and how is an
   assessor's attestation keyed and verified? `assessor_licence_no` is currently
   recorded as given and checked by nobody.
3. **Attestation policy.** What does the insurer want done with
   `attestation = 'unavailable'` — refuse the policy, price it differently, or
   accept it? The schema records the gap rather than deciding for them.
4. **Grievance routing.** The exact process and SLA a rejected claimant is
   pointed at, including Ombudsman escalation.
5. **Data retention.** How long evidence is kept after a claim closes, and who
   deletes it.
6. **Settlement cadence.** The real premium remittance schedule, and the
   reconciliation tolerance.

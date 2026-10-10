# The trust layer

What the server asserts, what the chain enforces, and which of the two you are
actually relying on for each of the eight features.

This document exists because "we verify behaviour" and "a server told us a
number" look identical from outside, and the difference is the whole product.
Every claim below is traceable to a file. Where something is not built, it says
so in those words rather than describing the version that would be.

---

## 1. Architecture

```
  browser                      server (Next.js route handlers)        chain
 ─────────                    ────────────────────────────────      ─────────

 lib/trust/client.ts          app/api/trust/*/route.ts
      │                              │
      │ 1. POST, with BOTH           │
      │    Privy tokens              │
      ├─────────────────────────────►│
      │                              │ 2. verifyCaller()
      │                              │    lib/server/privy.ts
      │                              │    - verify access token
      │                              │    - verify identity token
      │                              │    - cross-check same subject
      │                              │    - address FROM the token
      │                              │
      │                              │ 3. validate the body
      │                              │    lib/server/route-kit.ts
      │                              │    strict; no coercion
      │                              │
      │                              │ 4. read what must come from
      │                              │    the chain, not the body
      │                              │    lib/server/chain.ts
      │                              ├──────────────────────────────► read
      │                              │◄──────────────────────────────
      │                              │
      │                              │ 5. reserve a nonce FIRST
      │                              │    lib/server/nonce.ts
      │                              │    -> public.trust_nonces
      │                              │
      │                              │ 6. sign the exact digest the
      │                              │    contract will recompute
      │                              │    lib/server/trust-signer.ts
      │                              │    EIP-191, TRUST_SIGNER_KEY
      │                              │
      │ 7. { nonce, expiry,          │
      │      signature }             │
      │◄─────────────────────────────┤
      │                              │
      │ 8. the USER's wallet sends the transaction
      ├──────────────────────────────────────────────────────────────► write
      │                                                     ECDSA.recover
      │                                                     == trustSigner ?
```

Two properties of that shape are worth naming.

**The user sends the transaction, not the server.** Step 8 goes from the
browser. The server hands out a signature and has no way to use it; it cannot
move money, and a compromised server cannot drain anything. The two exceptions
are in section 6, and they are exceptions because two contracts make it
impossible to do otherwise.

**The address is never taken from the request.** It comes out of a signed Privy
identity token in step 2. That is the difference between authorising the person
who asked and authorising whoever they named.

---

## 2. What is trusted, and what is verified

| Thing | Verified by | Trusted from |
|---|---|---|
| Who the caller is | Privy access **and** identity token, cross-checked, `lib/server/privy.ts:85` | Privy's key custody |
| The caller's wallet address | the signed identity token | Privy |
| That an invite code is right | compared against `pots_private`, readable only by the server | nothing — a real check |
| A gift's condition hash | read from `Gift.getGift`, `lib/server/chain.ts` | nothing — read from the chain |
| A claim's evidence hash | read from `MicroCover.getClaim` | nothing — read from the chain |
| A policy's coverage ceiling | read from the chain, and re-checked by the contract | nothing |
| An ISA's repayment percentage | read from `IncomeShare.getAgreement` | nothing |
| **That a behaviour happened** | nothing | **the person's own typing** |
| **A monthly income figure** | nothing | **the recipient's own typing** |
| **That an insured event occurred** | nothing | **a button in the demo** |
| **That an employer is a real company** | nothing | **the employer's own typing** |
| A repayment figure | the **recipient's** signature, checked on-chain | nothing — the server cannot forge it |

The four bold rows are the honest centre of this document. Everything else in
the trust layer is machinery arranged around them.

---

## 3. What the trust layer does NOT do

Said plainly, because each of these has a name that sounds like it is present.

**Device attestation is not implemented.** No Play Integrity call, no App
Attest call, no SafetyNet, nothing. Behaviour signals are a number typed into a
text box, bounds-checked and signed. A person can submit any figure inside the
bounds. The UI for features 02, 03 and 08 says "Prototype: we take your word
for it", and it has to keep saying that.

**Account Aggregator is not integrated.** Income for feature 04 is
self-declared. There is no consent artefact, no FIU registration, no bank feed.
`income_declarations.source` exists as a column precisely so a real source
could never be mistaken for this one; today it only ever holds
`'self_declared'`.

**There is no real parametric oracle.** Feature 07's trigger is a button.
`oracle_events.source` only ever holds `'simulated'`. No Chainlink, no weather
feed, no flight API.

**There is no licensed insurer.** `MicroCover`'s insurer and claims-signing
roles are held by this server on testnet. On a real network that would be
unlicensed insurance business, which is why the deploy script refuses to run
off Monad Testnet unless every role is named explicitly and none of them is the
deployer. See `docs/limitations.md`.

**Employer verification does not verify.** `verify-employer` checks the SHAPE of
a GSTIN and nothing else, and returns `verified: false` as a hardcoded literal.
No registry is contacted.

**Passkeys are enrolment, not assertion.** `caller.hasPasskey`
(`lib/server/privy.ts:77`) reports whether the account has a passkey linked. It
is not a fresh WebAuthn assertion for this action. A per-transaction step-up
challenge is not built.

**The server is a trusted party, and the system is not trustless.** One key,
`TRUST_SIGNER_KEY`, can assert a behaviour, a gift condition and an insured
event. It holds no money and is not an admin of any contract, but it is a
single point of trust and should be read as one.

---

## 4. Production replacement for each assumption

| Assumption | What replaces it | Why it is not here |
|---|---|---|
| Behaviour is self-reported | Play Integrity (Android) / App Attest (iOS) attesting a native app, with Health Connect or HealthKit as the signal source | needs a native app; this is a web build |
| Income is self-declared | RBI Account Aggregator: a consent artefact, an FIU, statement parsing | requires FIU registration and a regulated integration |
| The oracle is a button | a decentralised oracle, or the insurer's own signed feed | no feed exists for these events on a testnet |
| The insurer is this server | an IRDAI-registered insurer holding the risk and the claims key | cannot be substituted by code — see `docs/limitations.md` |
| Employers self-assert | a GST / MCA registry lookup, plus a bank penny-drop | needs paid API access and a legal basis |
| Passkey means enrolment | a per-action WebAuthn assertion verified server-side | Privy's embedded-wallet flow does not expose a per-action challenge here |
| One server signing key | a KMS or threshold signer, per-action keys, rotation | an env var is honest for a demo; a KMS is not a demo |

---

## 5. Nonces, expiry, and exactly how much they buy

`public.trust_nonces` gets one row per signature **before** the signature is
returned. Each row records the DID that asked, the action, the digest, and when
it expires. Three things come out of that: replay protection at the API, rate
limits that survive a restart and hold across instances (the audit found the
previous in-memory limiter bypassable — H-5), and an audit trail.

Now the part that is easy to oversell. **Only `join_pot` carries its expiry
on-chain**, because `PotManager.join` is the only function here that takes an
expiry argument. For the others:

| Action | API nonce | On-chain expiry | What actually stops an on-chain replay |
|---|---|---|---|
| `join_pot` | yes | **yes** — `AuthorizationExpired` | the expiry, plus `AlreadyMember` for that (pot, joiner) |
| `attest_behaviour` | yes | no | `AlreadyVerified` — a goal is verified once |
| `attest_condition` | yes | no | a gift leaves `Open` on attestation and cannot return |
| `attest_oracle` | yes | no | the claim leaves `Submitted` and the policy closes |
| `attest_income` | yes | no | the digest names its `index`, so it fits exactly one slot |
| `attest_day` | yes | no | `AlreadyAttested` — one day per member per pool |
| `verify_employer` | yes | n/a | nothing — no contract reads it (section 3) |

So marking a nonce used does **not** make an already-issued signature unusable
on-chain for six of the seven actions. What stops a replay there is each
contract's own one-shot rule for the record the signature names. The nonce
ledger stops the API being used as a signature vending machine; the contract
stops the signature being used twice. Both are needed and neither is
sufficient. Anyone reasoning about this layer should hold both halves at once.

---

## 6. Where the server sends transactions, and why

Almost everywhere, the user's wallet sends the transaction and the server only
signs. Two contracts make that impossible:

```
IncomeShare.recordRepayment   requires msg.sender == recorder
MicroCover.activatePolicy     requires msg.sender == insurer
```

Those roles belong to a licensed counterparty and a licensed insurer, who would
run their own infrastructure. On a testnet no such party exists, so the demo
gives both to this server (`lib/server/chain.ts`) and says so in the deploy
warnings and in the UI.

What a compromised server key could then do: record a repayment against an
agreement, and bind a policy. What it still could **not** do: invent a
repayment — `recordRepayment` separately recovers the **recipient's** signature
over the exact figures and compares it to the agreement. That property survives
a full server compromise, and it is why feature 04 is split into
`attest-income` (digest out) and `record-repayment` (signed confirmation in)
rather than one route that does both.

---

## 7. Deviation from the brief: EIP-191, not EIP-712

The brief specifies an EIP-712 domain of `{name: "Pot", version: "1", chainId,
verifyingContract}`. This implementation uses hand-rolled EIP-191 digests
instead. That is a stated choice, not an oversight.

The five signature-verifying contracts here already standardised on digests
that bind `address(this)` and `block.chainid` — the same cross-contract and
cross-chain separation an EIP-712 domain provides, reached a different way.
`PotManager.join` additionally binds a `JOIN_ACTION` tag and an expiry.
Converting all five contracts and their tests for uniformity alone would be a
large change with no security gain, and a half-converted codebase would be
worse than either option.

The cost is real and worth naming: EIP-712 gives wallets a structured,
human-readable signing prompt; EIP-191 gives an opaque hash. That matters
wherever a **person** signs. There is exactly one such place in this project —
the recipient confirming a repayment in feature 04 — and it is the first thing
to convert if this moves past a prototype.

**Both formulas are cross-checked by a test**, because a drift between two
languages is otherwise invisible until a transaction reverts.
`apps/pot/scripts/check-digests.mjs` prints the digests TypeScript computes for
fixed inputs; `packages/contracts/test/TrustLayerDigests.t.sol` asserts the
Solidity produces exactly those bytes, including the EIP-191 prefix and the
action tag. Seven assertions, run with every `forge test`.

---

## 8. Reading list, in dependency order

| File | What it holds |
|---|---|
| `apps/pot/lib/server/privy.ts` | who the caller is; both tokens, cross-checked |
| `apps/pot/lib/server/trust.ts` | the route wrapper, limits, the audit log |
| `apps/pot/lib/server/route-kit.ts` | strict body validation; no coercion anywhere |
| `apps/pot/lib/server/nonce.ts` | the nonce ledger and the rate limiter |
| `apps/pot/lib/server/trust-signer.ts` | the key, and every digest it will sign |
| `apps/pot/lib/server/chain.ts` | chain reads, and the two server-sent writes |
| `apps/pot/app/api/trust/*/route.ts` | one route per action |
| `apps/pot/lib/trust/client.ts` | the browser side, and all the error handling |
| `supabase/migrations/20261010_trust_layer_core.sql` | the tables, all RLS-denied to clients |
| `packages/contracts/test/TrustLayerDigests.t.sol` | the TypeScript/Solidity tripwire |

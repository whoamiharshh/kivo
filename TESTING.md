# TESTING

Part of the [PROJECT_DOSSIER](PROJECT_DOSSIER.md). Results below are recorded only
where a command was run in this working session (2026-10-12) or where an existing
project document reports them; the source of each number is stated.

## 1. Test categories at a glance

| Category | Framework | Count | Last executed | Evidence |
|---|---|---|---|---|
| Contract tests | Foundry (`forge test`) | 408 test functions across 11 files (static count verified) | **Not run in this pass** (Foundry unavailable). Docs report "408 passed, 0 failed" from an earlier run | `README.md`, `docs/tech.md`, `docs/production-readiness.md` |
| App unit tests | Vitest 5, node env | **77 tests / 11 files** | **Run today 17:22 IST: 77 passed, 0 failed** (`pnpm test`, 38.99 s) | command output in this session |
| Typecheck | `tsc --noEmit` | — | Run after the working-tree discovery change: no errors (once). Not rerun after the last edit batch | session |
| Lint | `eslint` | — | Not run in this pass. A leftover unused `Button` import in `components/pot/activity-feed.tsx` (from the discovery change) will likely warn | code reading |
| Production build | `next build` | — | Not run in this pass. Docs report a passing isolated build (`NEXT_DIST_DIR=.next-validation`) before the discovery change | `docs/production-readiness.md` |
| End-to-end / browser journeys | none automated | 0 | — | no Playwright/Cypress specs exist; ad-hoc Playwright MCP console logs are stored in `.playwright-mcp/` |
| Load / performance | none | 0 | — | withdrawn claim documented in `DEPLOY.md` |
| Live-chain script | `scripts/flow-check.mjs` | 1 script | Not run in this pass (see §5; it **changes testnet state** and has a defect) | code reading |
| Digest cross-check | `scripts/check-digests.mjs` + `TrustLayerDigests.t.sol` | 9 contract tests | Not run in this pass | `docs/trust-layer.md` §7 |

Environment facts: Node v26.1.0, pnpm 12.10.1 installed locally. `forge`, the
Supabase CLI and WSL were unavailable (per `docs/production-readiness.md`); this
pass also found no Docker or local Postgres.

## 2. Commands (exact)

```bash
# App (from apps/pot) — safe, no network, no accounts
pnpm test                 # vitest run     → 77 tests
pnpm test:watch
pnpm typecheck            # tsc --noEmit
pnpm lint                 # eslint
NEXT_DIST_DIR=.next-validation pnpm build   # isolated production build (avoids touching .next)

# Contracts (from packages/contracts) — needs Foundry
forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts
forge build
forge test                # or: forge test --summary
forge test --match-contract TrustLayerDigests
forge coverage --no-match-coverage script
forge fmt --check

# Digest cross-check (both halves must agree)
node apps/pot/scripts/check-digests.mjs
forge test --match-contract TrustLayerDigests   # in packages/contracts

# After contract changes
forge build && (cd ../../apps/pot && pnpm gen:abis)
```

`pnpm install` has been reported to print `ERR_PNPM_IGNORED_BUILDS`; the existing
install still passed tests/build (`docs/production-readiness.md`).

## 3. Vitest inventory (77 tests, run today)

`vitest.config.mts`: `include: ["lib/**/*.test.ts"]`, `server-only` aliased to an
empty module, placeholder env values (the `TRUST_SIGNER_KEY` there is sixty-four
`1` hex digits, not a real key).

| File | Tests | What it actually proves | What it does not |
|---|---|---|---|
| `lib/activity.test.ts` | 3 | `toFeedItem` keeps separate deposits distinct (different keys, amounts, timestamps, hashes), maps `SpendApproved`/`Refunded` events, `memberAddressForEvent` only returns an address for `PotCreated`/`MemberJoined` | Does **not** cover `deriveStateFeed` (the working-tree feed) or the pending-spend id bug |
| `lib/env.test.ts` | 3 | Startup is allowed without a key while signing is disabled; a key is required when enabled; an invalid flag is rejected | Does not exercise a deployed environment |
| `lib/features/gift-state.test.ts` | 22 | Pure UI-state logic: who is offered confirm/cancel/claim/timeout in each state; wording never claims verification | Does not prove the confirm **flow** works on-chain — and the flow cannot (issue K-02) |
| `lib/nav/routes.test.ts` | 4 | `built` flags match files on disk and every real screen is listed | `/agreements` is flagged `built: true` and exists, but is only a stub page — the test cannot tell |
| `lib/server/env.test.ts` | 5 | Signer gate: refuses unless enabled, refuses before reading the key, rejects the legacy address, allows an isolated test signer, maps to 503 | — |
| `lib/server/guards.test.ts` | 13 | Per-IP window math, shared-address headroom, per-address buckets, `x-forwarded-for` parsing, same-origin rules, 64 KiB body limit paths | Not a distributed (multi-instance) test |
| `lib/server/indexer-auth.test.ts` | 2 | Exact bearer secret accepted; malformed/empty rejected | — |
| `lib/server/logging.test.ts` | 2 | Only bounded error names/codes are logged | — |
| `lib/server/nonce.test.ts` | 6 | Nonce single use (409 on replay), unknown/expired rejected, format of reserved nonces, independence of nonces — against a fake DB | Not against Postgres |
| `lib/server/trust-audit.test.ts` | 7 | Audit rows contain a salted hash and no raw IP (IPv4/IPv6), hash stability/rotation, null cases | — |
| `lib/tx.test.ts` | 2 | Sponsorship diagnostics replaced by a safe message; unrelated failures preserved | Does not test `useSponsoredCall` end to end |

Static `it(` lines total 69; the remaining 8 come from parameterised cases
(e.g. one `it` per finished gift state, one per route) — the reported 77 is the
runner's count.

**Not covered by any app test** (Verified by absence): every API route handler;
`verifyCaller`; `trust-signer.ts` digests (only via the Foundry/script pair);
`lib/queries.ts`, `lib/actions.ts`, `lib/features/*` hooks; `lib/store.ts`; all
components and pages; the discovery change; Supabase RLS/policies; the indexer
(`pot-indexer.ts`).

## 4. Contract test inventory (408 functions; not run today)

| File | Functions | Notes |
|---|---|---|
| PotManager.t.sol | 91 | State machine, join authorization, deposits/partial fill, instant vs approved spends, cumulative budget, reservation, cancel, close pro-rata with dust, failed-pot refunds, deadline edges |
| PotManagerSecurity.t.sol | 2 | Targeted security regressions |
| SocialPay.t.sol / SocialPaySecurity.t.sol | 46 / 4 | Held/claimable/reclaim/dispute, 2-of-3 votes |
| Gift.t.sol | 38 | Time/attested/timeout/cancel, irrevocable, replay |
| BehaviourSavings.t.sol | 49 | Registry, cohorts, principal-return fuzz, replay |
| AccountabilityPool.t.sol | 39 | Grace rule, attestation replay, claims |
| SalaryStream.t.sol | 37 | Accrual cap, pause/resume/cancel, top-up |
| IncomeShare.t.sol | 31 | Recipient-signed recording, cap, replay by index, "holds nothing" |
| MicroCover.t.sol | 62 | Escrow, bind window, reserve commitments, signed settlement |
| TrustLayerDigests.t.sol | 9 | Solidity digests equal TypeScript digests for fixed inputs |

Quoted historical results: 334 passed (2026-10-10 audit), 272 (an earlier day),
408 (README/tech.md). Treat as unverified until `forge test` is re-run.
Documented 100 % line coverage for six contracts (`docs/limitations.md`) is also
historical.

## 5. Scripts and whether they are safe to run

| Script | Effect | Network | Safe? |
|---|---|---|---|
| `scripts/check-digests.mjs` | Prints digests computed in TypeScript for fixed inputs | none | Yes |
| `scripts/gen-abis.mjs` | Overwrites `lib/abis.ts` from `packages/contracts/out` (needs `forge build`) | none | Yes, but it rewrites a tracked file |
| `scripts/flow-check.mjs` | Reads `NEXT_PUBLIC_POT_MANAGER_ADDRESS`/`NEXT_PUBLIC_TEST_RUPEE_ADDRESS` from `.env.local` and **`DEPLOYER_KEY` from `packages/contracts/.env`**; on Monad Testnet it (1) calls `faucet()` if the deployer holds no test money, (2) `approve`s the pot, (3) `createPot` (target ₹50, 3-day deadline), (4) `deposit`s, (5) **simulates** `requestSpend`, (6) `closePot`s | live testnet, deployed contracts | **No, not as written.** It signs real transactions with the compromised deployer key, creates a pot on the shared contract and mints test money; and it computes `potId = potCount − 1`, but `createPot` assigns `++potCount`, so it targets the *previous* pot (the deposit would revert `NotMember` unless the deployer happens to be a member of that earlier pot; who created pots 1–5 is Unknown; not run, so this is code-reading only). It never exercises join, approval or refund. |

## 6. What is and is not proven, by feature

| Feature | Contract tests | App tests | Live/browser evidence |
|---|---|---|---|
| Pot create/deposit/repay/approve/cancel/close/refund | extensive (documented) | none | Five pots exist on chain (`potCount = 5`), so `createPot` has been called live; no recorded evidence for deposits/approvals/closes beyond that |
| Pot join (server-authorized) | covered (join digest, expiry, `AlreadyMember`) | none | **No join authorization has ever been issued** (`trust_nonces` and `users` empty; `pots_private` empty) |
| Test-money faucet | indirect | none | `totalSupply` = 2 claims |
| SocialPay | extensive | none | 0 payments |
| Gift | extensive | pure UI-state tests only | 0 gifts; confirm flow cannot work (K-02) |
| Savings, Pools, Streams | extensive | none | 0 goals/pools/streams |
| Agreements (IncomeShare) | extensive | none | no UI; 0 agreements |
| Cover (MicroCover) | extensive | none | list screen only; 0 policies |
| Auth, rate limits, origin, body limit, nonce, audit, signer gate | n/a | unit tests (above) | unauthenticated 401 observed on a local server (prior report) |
| RLS policies | n/a | none | policies read back live; behaviour of anon inserts untested |

## 7. Important financial edge cases lacking tests (recommended)

Contract level (verify they exist in the Solidity suites before adding):
two-member pot with an over-limit payment (cannot be approved), instant spend
budget after many small requests, approve after `cancelSpend`, `closePot` rounding
with unequal contributions and a zero-contribution member, `finalizeFailed`
exactly at the deadline second, a deposit that exactly reaches the target in a
partial fill, direct token transfers to a pot, `claimRefund` ordering with
multiple members, dust on `BehaviourSavings.claimOutcome`.

App level (none exist): the `spendId` indexing (ids start at 1; the pending query
iterates 0…n−1 — K-01), `deriveStateFeed` ordering and missing-field handling,
`useMyPots` with 0, 1 and 200+ pots and RPC failures, `savePotMeta` error paths
(K-03), `readableError` coverage of every user-reachable revert, amounts
(`rupeesToPaise` rejects >2 decimals, negative, empty), API route happy and
failure paths with mocked Privy and Supabase, signer-disabled 503 on every
signing route.

## 8. Validating a complete journey (target process)

1. **Local chain:** `anvil` + `forge script` deploy with throwaway keys; point
   `NEXT_PUBLIC_*` at it. (Not currently supported by the app's wagmi config,
   which is hard-wired to Monad Testnet — `lib/wagmi.ts`; adapting it is needed.)
2. **Auth:** a Privy app configured for localhost with a test Google account;
   confirm `GET /api/pots` → 401 unauthenticated and 200 after login.
3. **Money:** faucet → create pot → copy invite link → second profile joins →
   both deposit to target → instant repay under limit → over-limit request →
   approve from a third member → close → balances equal contributions minus
   payouts. Also: failed pot → `finalizeFailed` → `claimRefund` by each member.
4. **Indexing/state display:** confirm the Home list and pot feed reflect each
   step within one refresh cycle (20–30 s polling).
5. **Verify on chain:** read `getPot`, `contributed`, token balances before/after.

Distinguish evidence types when reporting: *simulated* (fakes in vitest),
*local chain*, *testnet* (public Monad testnet, test money), *production*
(none exists).

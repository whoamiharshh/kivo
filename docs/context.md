# Context — where Pot stands and why

Last verified: **2026-10-10**. Every ✅ below was re-run on that date, not
carried over from notes. `README.md` is the document for a newcomer or a judge;
this one is for whoever picks the work up next.

## The one-line product

A friend group agrees on an amount and a date. Everyone adds money to one pot.
If it fills up, the pot repays whoever paid for group costs under rules set up
front, and the leftover goes back pro-rata. If it doesn't fill up in time,
everyone takes their own money back. No friend holds the group's money.

Audience, per the brief: Delhi college students running a shared kitty — trip,
flat groceries, or a club fund. **Still to confirm with the human: which of the
three we demo**, so the copy and the examples match one of them.

## Build state

| Step (brief §9) | State |
|---|---|
| 1. Contracts compile + tests | ✅ `forge test` → **334 passed, 0 failed** across nine suites. Pot itself is 82 of those (80 behaviour + 2 security); the rest belong to the six other-track contracts listed below |
| 2. Deploy to Monad Testnet | ❌ **blocked on the human** — needs a funded testnet account |
| 3. App scaffold + Privy login + one sponsored call | ⚠️ code complete, **unverifiable** until there is a Privy App ID and a deployment |
| 4. The five screens | ✅ written, typecheck + production build + lint clean |
| 5. Vercel | ❌ not started (follows step 2) |
| 6. User-testing script + feedback log | ✅ written (`docs/user-testing.md`, `docs/feedback-log.md`, both empty of results on purpose) |

Checked on 2026-10-10: `forge test` 334/334 · `forge build` clean ·
`npx tsc --noEmit` clean · `npm run build` passes (7 routes) · `eslint` clean ·
`npm run gen:abis` re-run, so `apps/pot/lib/abis.ts` matches all eight contracts.

## The other six contracts

`packages/contracts/` holds more than Pot. These were written for the other
prompt tracks, share `TestRupee` where they need a token, and are deployed by
the same `script/Deploy.s.sol`:

| Contract | What it is | Tests |
|---|---|---|
| `SocialPay.sol` | Payments held until the recipient confirms, with a dispute path | 50 |
| `Gift.sol` | A gift released on an attested condition, or on timeout | 38 |
| `SalaryStream.sol` | Salary accruing per second, capped at what the employer funded | 37 |
| `BehaviourSavings.sol` | A commitment stake; principal always returned | 34 |
| `IncomeShare.sol` | An income-share agreement's record; holds no money at all | 31 |
| `MicroCover.sol` | A premium/payout rail for a licensed insurer; pays only on the insurer's signature | 62 |

Each one's limits, and the parts that need a real-world data source or a
licensed partner, are in `docs/limitations.md`. None of them has a screen —
`apps/pot/` is still only Pot. None is deployed, for the same reason Pot
isn't: there is no funded Monad Testnet account yet.

`MicroCover` additionally needs a thing no amount of code supplies: an
IRDAI-licensed insurer. Its app ↔ insurer integration is specified in
`docs/insurer-api.md`, and the HTTP endpoints in that document are **not
implemented** — there is no `apps/pot/app/api/` directory. The Postgres side
(evidence store, insurer rails, four guard triggers, RLS) **is** applied and
verified.

## What is blocked, and on exactly what

Nothing in the repo is waiting on more code. Three things need the human:

1. **A funded Monad Testnet account** → then the deploy (README step 2) prints
   the `TestRupee` and `PotManager` addresses and a block number.
2. **A Privy App ID** — Google login on, fee sponsorship covering Monad
   Testnet. Without it `Providers` short-circuits to the setup card, so **no
   screen past the login gate has ever been rendered by a browser.**
3. **Supabase URL + anon key** (optional) — without them names and memo text
   fall back to on-device storage, which is fine for a single-device demo.

All four `NEXT_PUBLIC_*` values are public identifiers, safe to paste in chat.
The deploy key is not: it stays in `cast wallet import` and is never pasted.

## Divergence from the brief — needs the human's confirmation

The contracts in `packages/contracts/src/` are **not** the ones described in
`CLAUDE.md` §4 and §6. The brief describes
`createPot(inviteHash, approvalLimit, maxMembers)` with "amount per person
(display only)" and no deadline. The code now has:

- **A real target and a deadline.** `createPot(inviteHash, approvalLimit,
  maxMembers, targetAmount, deadline)`. Money cannot leave a pot that hasn't
  reached its target. The per-person amount is still display-only and still
  offchain.
- **Refunds when a pot fails.** Deadline passes with the target missed →
  anyone may call `finalizeFailed`, then each contributor calls `claimRefund`
  for their own money. New to the brief.
- **`approvalLimit` is a cumulative per-member budget, not a per-request
  ceiling.** This is what stops one person splitting a big payout into many
  small ones (`test_SplittingCannotBeatTheApprovalLimit`).
- **Pending requests reserve their amount**, and a request can be cancelled by
  the requester or the creator; a pot cannot close while any is pending.
- **Deposits partial-fill**: asking to add more than the pot still needs takes
  only the remainder and leaves the rest with the sender.
- 82 tests across two files, not the 20 the brief mentions.

Everything the brief put out of scope (§5) is still out of scope, and nothing
onchain holds personal data. **Question for the human: should `CLAUDE.md` §4
and §6 be updated to match, or do you want some of this rolled back?** The
brief is your document, so it has been left exactly as you wrote it.

## Decisions taken, and why

- **One contract for all pots.** `potId` keyed storage, so creating a pot is
  one cheap call and the app needs one address.
- **The activity feed is built only from events** — no offchain mirror of the
  money, so the feed can never disagree with the chain.
- **Names and memo text are offchain** (Supabase, else on-device). Only
  `keccak256` hashes reach the chain, per brief §7.
- **`finalizeFailed` is permissionless.** A contract cannot wake itself up at
  its deadline. Rather than pretend otherwise, anyone may tip a failed pot into
  refunding, so nobody depends on the creator. The app does it quietly when it
  notices, and no copy claims money "comes back by itself".
- **The invite code is not treated as a secret.** It becomes visible onchain
  once someone joins with it; `maxMembers` is what bounds who gets in. Said
  plainly in the README rather than papered over.
- **Privy's native sponsorship** (`sponsor: true` on `useSendTransaction`),
  not a separate smart account, with `showWalletUIs: false` so actions feel
  like taps. Verified against the installed `@privy-io/react-auth` 3.48.
- **Light theme only**, so the toasts are pinned to light too rather than
  following the phone.

## Known gaps, stated honestly

- **Nothing has been exercised by a person in a browser.** Every ✅ above is a
  compiler, a test suite, or a build — not a tap.
- The contracts are **unaudited**. `forge lint` leaves 63 warnings across all
  eight, each class reviewed and accepted — but reviewed by the author of the
  code, which is not an audit:
  - **40 × `block-timestamp`** — inherent to products with deadlines and
    per-second accrual. A validator's few seconds cannot matter to a date days
    away; `SalaryStream` (9) deliberately pays by wall-clock time and
    `MicroCover` (8) is built out of cover windows and claim windows.
  - **8 × `reentrancy-events`** — false positives. The "external call" the
    linter sees before each event is `ECDSA.recover`, which reaches the
    `ecrecover` precompile and cannot call back into anything. In
    `MicroCover.settleClaim` the token transfer is the last statement in the
    function, after every event and every state write.
  - **5 × `uninitialized-local`** — locals declared before the branch or loop
    that sets them, read only afterwards, and zero-initialised by Solidity
    regardless.
  - **5 × `unsafe-typecast`** — four are narrowing casts immediately followed
    by a round-trip equality check that reverts if anything truncated; the
    fifth is `uint64(block.timestamp)` in `MicroCover._now()`, the same
    pattern the other time-based contracts use, which overflows in the year
    2554.
  - **5 × `environment-read-across-mutation`** — in test files, not in the
    contracts.
- The Supabase policies are **open** — the app has no server session and talks
  to it with the anon key. Acceptable only because every row is group-visible
  text nobody is hiding and nothing there can move money; said so in
  `supabase/schema.sql` too.
- `docs/feedback-log.md` holds no results because no session has happened.
  There are no user numbers anywhere in this repo on purpose.

## Session log

- **2026-10-10 (micro-insurance)** — Added `MicroCover.sol` (62 tests, 100% of
  lines and functions) plus the micro-insurance trust layer in Supabase:
  8 tables, 4 guard triggers and read-your-own-rows RLS, all verified by
  attempting to violate them (9 guard cases blocked, a client cannot forge its
  own insurer approval) and then cleared of seed data. Wrote
  `docs/insurer-api.md` and the `## Micro-insurance` section of
  `docs/limitations.md`. **Three of the four IRDAI sandbox figures the brief
  supplied did not check out** (Form RG-1 unfound, ₹10,000 is the 2019 fee, the
  36-month term is from the 2022 amendment to the 2019 regime, not the 2025
  regulations); the correction is tabled in `limitations.md` rather than the
  figures being repeated. No frontend was built, deliberately.

- **2026-10-10 (later, this session)** — Re-ran the whole suite after the five
  other-track contracts landed: **272/272**, with `tsc`, `eslint` and the
  production build clean and `lib/abis.ts` regenerated. Fixed two stale
  numbers that still said 82 tests (the `README.md` status table and this
  file) and the "8 accepted lint warnings" note, which is now 45 across seven
  contracts with each class reviewed. Ran `forge fmt` — twelve files were
  unformatted, so `pnpm lint` on the contracts had been failing; it passes now
  and the suite still does. **Finished the monorepo move**: confirmed the
  leftover root `contracts/` and `app/` were strictly older snapshots (old
  deploy script knew 3 contracts, not 7), archived their 80 source files to
  `pre-monorepo-snapshot.zip` (gitignored), then deleted both. Removed the
  nested `apps/pot/.git` left by create-next-app, so the outer repo now sees
  all 64 of the app's files instead of one opaque entry. **Nothing has been
  committed** — the human holds that call.
- **2026-10-10 (earlier)** — Re-verified everything from scratch. Found
  and fixed one real product bug: the create screen described the repayment
  limit as a per-repayment cap when the contract enforces a cumulative
  per-person budget (`apps/pot/app/create/page.tsx`). Brought `README.md`,
  `docs/user-testing.md` and `docs/feedback-log.md` up to the v2 rules (they
  still described the v1 contract and 19 tests). Removed `maximum-scale` from
  the viewport so people can pinch-zoom, pinned the toast theme, documented
  why the one `uint32` cast in `getPot` is safe (clearing that lint warning),
  and wrote this file plus `docs/tech.md`.
- **Earlier sessions** — Contracts v1 → v2 hardening (target, deadline,
  partial fill, cumulative budget, reservation, cancel, claim refunds); the
  five screens and the whole `apps/pot/lib` layer; Supabase schema; testing docs.

# Tech reference

How Pot is actually put together. Versions and behaviour here were read off the
code and the installed packages on **2026-10-10**, not from memory. For where
the project stands and what is blocked, see `context.md`.

## Stack, as installed

**Contracts** — Foundry 1.8.5 · solc 0.8.24 · optimizer on, 200 runs ·
OpenZeppelin Contracts 5.7.0 (`IERC20`, `SafeERC20`, `ReentrancyGuard`, `ERC20`)
· forge-std. RPC alias `monad_testnet` → `https://testnet-rpc.monad.xyz`.

**App** — Next.js 16.4.0 (App Router, Cache Components + Partial Prefetching
on) · React 19.3 · TypeScript 5 · Tailwind 4 · shadcn/ui on Base UI 1.9 ·
`@privy-io/react-auth` 3.48 · `@privy-io/wagmi` 4.0 · wagmi 3.7 · viem 2.56 ·
TanStack Query 5 · sonner · `@supabase/supabase-js` 2.117.

Chain is `monadTestnet` from `viem/chains`, read through `lib/contracts.ts` so
nothing else hardcodes it.

## Contracts

This section covers the two contracts Pot itself uses. `packages/contracts/`
also holds seven written for the other prompt tracks — `SocialPay.sol`,
`Gift.sol`, `BehaviourSavings.sol`, `SalaryStream.sol`, `IncomeShare.sol`,
`MicroCover.sol`, and `AccountabilityPool.sol` — which share `TestRupee` and
the same deploy script.
`context.md` lists them; `limitations.md` covers what each cannot do.

### `TestRupee.sol` — the play money

ERC-20, symbol **tINR**, **2 decimals** so 1 unit = 1 paisa. `faucet()` mints
₹5,000 once per 24h per address; a second call in the window reverts
`FaucetCooldown(nextClaimAt)`. `lastClaim(address)` is public, which is how the
app shows "come back tomorrow". No owner, no cap, no value.

### `PotManager.sol` — every pot, in one contract

Storage is keyed by `potId` (`potCount` is the next id). Constructor takes the
token once: `PotManager(IERC20)`.

**The state machine** — app wording in brackets:

```
Collecting [Collecting] --target reached--> Funded [Ready to spend]
     |                                        |
     |                                 creator closes
     |                                        v
     |                                   Closed [Finished]
     |                                        ^
     +-- deadline passed, target missed --> Refunding [Didn't fill up]
                                   (last refund claimed)
```

**Constants** — `MAX_MEMBERS_CAP = 20`, `MAX_DEADLINE_HORIZON = 365 days`.

**Writes**

| Function | Who | What it does |
|---|---|---|
| `createPot(inviteHash, approvalLimit, maxMembers, targetAmount, deadline)` | anyone | Makes a pot, adds the creator as its first member. `deadline` must be in the future and within a year. |
| `join(potId, inviteCode)` | anyone with the code | Allowed while Collecting **or** Funded — a friend who paid can be added so they can be repaid. Rejected once Refunding. |
| `deposit(potId, amount) → accepted` | members | **Partial-fills**: takes only `targetAmount - totalContributed` and leaves the rest with the sender. Reaching the target flips the pot to Funded and emits `PotFunded`. |
| `requestSpend(potId, to, amount, memoHash)` | members, Funded only | Pays out at once if the requester has unapproved budget left **and** isn't paying themselves; otherwise reserves the amount and waits. |
| `approveSpend(potId, spendId)` | any **other** member | Executes the payout. `CannotApproveOwnSpend` guards self-approval. |
| `cancelSpend(potId, spendId)` | requester or creator | Releases the reservation, so a stale request can't freeze the pot. |
| `closePot(potId)` | creator only, Funded only | Reverts with `PendingRequests` if anything is still waiting. Pays the leftover pro-rata; the **last contributor absorbs the rounding dust** so the pot empties exactly. |
| `finalizeFailed(potId)` | **anyone**, after the deadline | Collecting + target missed → Refunding. A pot with no contributions goes straight to Closed. |
| `claimRefund(potId)` | each contributor | Takes back exactly their own contribution, once. The last claim closes the pot. No expiry, and nobody — creator included — can sweep an unclaimed share. |

**Views** — `getPot` → `PotInfo` (everything except the invite hash),
`getMembers`, `getSpend`, `remainingToTarget`, `availableBalance`
(`balance - reserved`), `instantRemaining(potId, member)`,
`refundableOf(potId, member)`; public mappings `isMember`, `contributed`,
`refundClaimed`, `instantSpent`, `potCount`.

**Events** — `PotCreated`, `MemberJoined`, `Deposited`, `PotFunded`,
`RefundingStarted`, `SpendRequested`, `SpendApproved`, `SpendCancelled`,
`SpendExecuted`, `PotClosed`, `Refunded`. Local source now indexes these events
through finalized blocks. The schema is not applied and the worker has not run,
so indexed activity is not yet available in a deployed environment.

### The rules the tests defend

- Money can only leave a pot that reached its target.
- Contributions never exceed the target.
- Payouts go only to members.
- `approvalLimit` is a **cumulative budget per member**, not a per-request
  ceiling — which is what makes splitting a big payout into small ones
  pointless (`test_SplittingCannotBeatTheApprovalLimit`).
- Any payout to yourself needs someone else's approval, whatever the amount.
- A pending request reserves its amount, so two can't both be approved for
  money the pot doesn't have.
- Closing refunds strictly pro-rata, so it can't be used to take the money.
- A failed pot refunds by claim: no double claims, no claiming someone else's,
  no dependence on the creator.

`deadline` is **exclusive** — money goes in while `block.timestamp < deadline`;
at equality collection is over and `finalizeFailed` may be called. The same
rule is applied in the contract, the app, the tests and the docs.

### Tests

The last recorded `forge test --summary` reported **408 passed** across eleven
suites: PotManager 91, PotManager security 2, MicroCover 62, SocialPay 50,
BehaviourSavings 49, AccountabilityPool 39, Gift 38, SalaryStream 37,
IncomeShare 31, and trust-layer digests 9. Foundry was unavailable during the
2026-10-12 continuation, so this result was not rerun then.

`forge lint` leaves 63 accepted warnings; `context.md` says which and why.

## App

### Routes

Paths in this section are relative to `apps/pot/`.

| Route | File | What it is |
|---|---|---|
| `/` | `app/(app)/page.tsx` | Home behind the sign-in gate |
| `/create` | `app/(app)/create/page.tsx` | Create a pot |
| `/join/[potId]/[code]` | `app/(app)/join/[potId]/[code]/page.tsx` | Invite and join |
| `/pot/[id]` | `app/(app)/pot/[id]/page.tsx` | Pot details and actions |
| `/agreements` | `app/(app)/agreements/page.tsx` | Explicit unavailable state; not an Agreements workflow |
| `/cover` | `app/(app)/cover/page.tsx` | Existing cover list; creating policies is unavailable |

Repay, approve, add money, close and claim are dialogs on the pot screen, not
separate routes.

### Files that matter

`lib/`

| File | Job |
|---|---|
| `contracts.ts` | Addresses from env, `chain`, `contractsConfigured`, `DEPLOY_BLOCK`; re-exports the ABIs |
| `abis.ts` | **Generated** by `scripts/gen-abis.mjs` from Foundry artifacts — never hand-edit |
| `env.ts` | Privy and Supabase config flags, so screens show a setup card instead of crashing |
| `wagmi.ts` | `createConfig` from **`@privy-io/wagmi`** (not `wagmi`) — the embedded wallet needs it |
| `tx.ts` | `useAppWallet`, `useSponsoredCall`, and `readableError` — the revert-name → plain-English map |
| `actions.ts` | One hook per action; invite-code generation and the `keccak256` hashing |
| `queries.ts` | `useTestMoney`, `useMyPots`, `usePot`, `usePotActivity` |
| `store.ts` | Offchain text: Supabase when configured, on-device storage otherwise |
| `money.ts` | Rupees ↔ paise, `₹1,200.50` formatting (en-IN grouping) |
| `time.ts` | Deadline labels, `datetime-local` ↔ unix seconds |

`components/` — `app-shell.tsx` (the `max-w-md` frame + `StickyBar`),
`login-gate.tsx`, `setup-notice.tsx`, `test-money-card.tsx`, `money-input.tsx`,
`name-row.tsx`, `person.tsx`, and under `components/pot/`: `pot-status.tsx`
(state badge + target progress), `members-list.tsx`, `invite-card.tsx`,
`activity-feed.tsx`, `pending-list.tsx`, `add-money-dialog.tsx`,
`repay-dialog.tsx`, `close-dialog.tsx`, `refund-card.tsx`.

### How a write happens

`useSponsoredCall` (`lib/tx.ts`) encodes the call with viem, sends it through
Privy's `useSendTransaction` with `{ sponsor: true, address }` — Privy's native
gas sponsorship, no separate smart account — then waits on
`publicClient.waitForTransactionReceipt` (90s) and throws unless the receipt
says success. Hooks return only after the chain has settled, so the UI never
shows a result that hasn't happened. On failure, `readableError` turns the
contract's named error into a sentence a person can act on. A sponsored-send
refusal is not retried without sponsorship. Server trust signing is disabled
by default in source until an approved replacement deployment is verified;
the local guard rejects the known compromised legacy signer address.

`useAddMoney` is the one two-call action: if the allowance is short it sends
`approve(PotManager, maxUint256)` first, then `deposit`. The person sees one
"Add money" step, per brief §7.

### How a read happens

TanStack Query, `staleTime` 4s, polling every 8–10s. Balances and pot state
come from contract reads and multicalls. `useMyPots` currently reads `potCount`
and checks membership for each id, so its cost grows with the entire deployment.
The activity feed now requests pages from `/api/pots/activity`; that endpoint
verifies both Privy tokens and confirms membership at a finalized block before
reading service-role indexed rows. `apps/pot/lib/server/pot-indexer.ts` scans
at most 100 blocks per RPC request and indexes only through Monad's `finalized`
tag, with idempotent event identities and a lease/checkpoint. The accompanying
Supabase migration is local source only and has not been applied; therefore no
deployed activity history is available or independently verified yet.

### Offchain text

Pot names, display names and memo text never go onchain — only `keccak256`
hashes do. The base `supabase/schema.sql` is not the complete production
schema: migrations split invite codes into `pots_private` and add the server-
only trust and activity tables. Review and apply migrations in the intended
environment before relying on those paths. `store.ts` keeps browser-local
fallbacks for offchain text; those fallbacks do not synchronize between
devices.

### Env vars

| Var | Needed for | Blank means |
|---|---|---|
| `NEXT_PUBLIC_PRIVY_APP_ID` | Google sign-in, sponsored actions | Setup card instead of the app |
| `NEXT_PUBLIC_POT_MANAGER_ADDRESS` | everything | Setup card |
| `NEXT_PUBLIC_TEST_RUPEE_ADDRESS` | test money | Setup card |
| `NEXT_PUBLIC_DEPLOY_BLOCK` | indexer start block | Indexer starts at block 0 if blank; configure the actual deployment block before enabling indexing |
| `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` | names across devices | On-device storage |
| `NEXT_PUBLIC_APP_URL` | canonical origin for API same-origin checks | Request origin is checked against its own host; production proxy origin remains unverified |
| `NEXT_PUBLIC_RPC_URL` | server chain reads and event indexing | Public RPC fallback |

Server-only signing and indexer variables are not public identifiers:
`TRUST_SIGNER_ENABLED` defaults to `false`; `TRUST_SIGNER_KEY` is required only
when signing is explicitly enabled and the known compromised legacy signer is
rejected; `POT_INDEXER_SECRET` protects the manual indexing route. Do not enable
signing until an approved replacement deployment is independently verified,
and do not provision the indexer secret before the migration and scheduler are
reviewed for that environment.

### UI language rule (brief §8)

The interface never says wallet, gas, transaction, blockchain, web3, crypto,
token, connect, seed phrase, signature, onchain, contract, mint or faucet. It
says add money, repay, approve, close pot, refund, test money. Those words do
appear in code identifiers and comments — `faucet()`, `walletClientType` — but
not in anything a person reads. Checked on 2026-10-10 by grepping the rendered
copy in `apps/pot/`, `components/` and `lib/`.

## Commands

```bash
# contracts
cd packages/contracts
forge test                 # last recorded result: 408 pass; rerun locally
forge build
forge lint                 # 63 accepted warnings, see context.md
forge script script/Deploy.s.sol --rpc-url monad_testnet --account pot-dev --broadcast

# app
cd apps/pot
pnpm install
pnpm dev                   # localhost:3000
pnpm build                 # production build
pnpm typecheck             # typecheck
pnpm lint                  # lint
pnpm gen:abis              # after contract changes — regenerates lib/abis.ts
```

**After changing a contract, always** `forge build` then `npm run gen:abis`,
or the app's ABIs drift from the chain.

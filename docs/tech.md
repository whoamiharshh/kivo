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
also holds six written for the other prompt tracks — `SocialPay.sol`,
`Gift.sol`, `BehaviourSavings.sol`, `SalaryStream.sol`, `IncomeShare.sol`,
`MicroCover.sol` — which share `TestRupee` and the same deploy script but have
no screens.
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
`SpendExecuted`, `PotClosed`, `Refunded`. The activity feed is built from these
and nothing else.

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

`forge test` → **334 pass** across nine suites. Pot's own 82 are 80 in
`test/PotManager.t.sol` (lifecycle, rules, and a `test_RevertWhen_*` per named
error) and 2 in `test/PotManagerSecurity.t.sol` — a reentrancy attempt on
`claimRefund`, and a fuzz test that total claims never exceed total
contributions. The other 252 cover the six other-track contracts: MicroCover
62, SocialPay 50, Gift 38, SalaryStream 37, BehaviourSavings 34, IncomeShare 31.

`forge lint` leaves 63 accepted warnings; `context.md` says which and why.

## App

### Routes

Paths in this section are relative to `apps/pot/`.

| Route | File | What it is |
|---|---|---|
| `/` | `app/page.tsx` | Home: test-money card, your pots, "Create a pot" |
| `/create` | `app/create/page.tsx` | Name, target, deadline, member cap, repayment limit, your name |
| `/join/[potId]/[code]` | `app/join/[potId]/[code]/page.tsx` | What the invite link opens: sign in, then join |
| `/pot/[id]` | `app/pot/[id]/page.tsx` | The pot: progress, members, feed, and every action |

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
contract's named error into a sentence a person can act on.

`useAddMoney` is the one two-call action: if the allowance is short it sends
`approve(PotManager, maxUint256)` first, then `deposit`. The person sees one
"Add money" step, per brief §7.

### How a read happens

TanStack Query, `staleTime` 4s, polling every 8–10s. Balances and pot state
come from **one `multicall` per query**; pot discovery and the feed come from
`getLogs` scoped `fromBlock: DEPLOY_BLOCK` — which is why that env var exists.
`useMyPots` finds pots from `MemberJoined` filtered on the viewer's address
(the creator is a member, so created pots show up too).

### Offchain text

Pot names, display names and memo text never go onchain — only `keccak256`
hashes do. `supabase/schema.sql` defines three tables: `pots` (`pot_id`,
`name`, `per_person_paise`, `invite_code`, `created_at`), `profiles`
(`address`, `name`, `updated_at`) and `memos` (`hash`, `text`, `created_at`).
With no Supabase credentials, `store.ts` writes the same shapes to the
browser's own storage, which is fine for a single-device demo. The policies are
open and the schema says why.

### Env vars (all public, all `NEXT_PUBLIC_*`)

| Var | Needed for | Blank means |
|---|---|---|
| `NEXT_PUBLIC_PRIVY_APP_ID` | Google sign-in, sponsored actions | Setup card instead of the app |
| `NEXT_PUBLIC_POT_MANAGER_ADDRESS` | everything | Setup card |
| `NEXT_PUBLIC_TEST_RUPEE_ADDRESS` | test money | Setup card |
| `NEXT_PUBLIC_DEPLOY_BLOCK` | feed + pot discovery | Scans from block 0 — slow but correct |
| `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` | names across devices | On-device storage |

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
forge test                 # 334 pass
forge build
forge lint                 # 63 accepted warnings, see context.md
forge script script/Deploy.s.sol --rpc-url monad_testnet --account pot-dev --broadcast

# app
cd apps/pot
npm install
npm run dev                # localhost:3000
npm run build              # production build
npx tsc --noEmit           # typecheck
npx eslint app components lib
npm run gen:abis           # after any contract change — regenerates lib/abis.ts
```

**After changing a contract, always** `forge build` then `npm run gen:abis`,
or the app's ABIs drift from the chain.

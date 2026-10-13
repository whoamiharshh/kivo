# Antigravity handoff — what to change, what to leave alone

Written 2026-10-13 for the 14 Oct 2026, 09:30 IST submission. You own the
**look**. Everything below marks what is behaviour and must keep working.
Facts here come from the code and from checks run on 2026-10-13; anything not
checked is marked *unverified*.

Read this with `docs/antigravity-brief.md` (rules and work zones) and
`docs/frontend-workspace.md` (how to run the app safely). This file adds the
route map, the state inventory and the do-not-rewrite list.

Work in `apps/pot/`. Package manager: `pnpm` (v12). Chain: Monad Testnet (10143).

## 1. Ground rules

1. Change styling, layout, spacing, type, colour and motion freely. Do not
   change what a button does, what it calls, or which states exist.
2. Never show: wallet, gas, transaction, blockchain, web3, crypto, token,
   connect, seed phrase, signature, onchain, contract, mint, faucet. Use: add
   money, repay, approve, close pot, refund, test money. Amounts are in ₹ with
   a small "test money" tag.
3. No mock data, no fake success, no hardcoded balances or pots in real screens.
   The app ships with no sample data of any kind; the old `app/design-preview/`
   pages were deleted on 2026-10-13.
4. Do not add a button for something the app cannot do (see section 6).
5. Do not touch `.env*`, secrets, or contract addresses.
6. Mobile first: the layout is a single column around `max-w-md`.
7. `NEXT_PUBLIC_DESIGN_PREVIEW` no longer exists. Leave it unset.

## 2. Routes

All user pages live under `app/(app)/` and are wrapped by `Providers`
(`app/providers.tsx`: Privy, wagmi, React Query). The route group does not
change URLs. `lib/nav/routes.ts` is the **only** list of home-screen features;
its `built` flags are checked by `lib/nav/routes.test.ts` against the real
files, so adding or removing a page means editing both.

| Route | Purpose |
|---|---|
| `/` | Home: greeting, test-money card, my pots (`useMyPots`), feature nav |
| `/create` | Create a pot (name, per-person amount shown only, approval limit, max members) |
| `/join/[potId]/[code]` | Open an invite link, sign in, join |
| `/pot/[id]` | Pot view: balance, members, pending approvals, activity feed, add money, repay, close, refund |
| `/pay`, `/pay/new`, `/pay/[id]` | Send money to a person (SocialPay) |
| `/gifts`, `/gifts/new`, `/gifts/[id]` | Conditional gifts |
| `/savings`, `/savings/new`, `/savings/[id]` | Behaviour savings goals |
| `/pools`, `/pools/new`, `/pools/[id]` | Accountability pools |
| `/streams`, `/streams/new`, `/streams/[id]` | Salary streams |
| `/agreements`, `/agreements/new`, `/agreements/[id]` | Income-share agreements (some actions unavailable, section 6) |
| `/cover`, `/cover/new`, `/cover/[id]` | Micro cover (insurer-dependent actions unavailable, section 6) |
| `/[...slug]` | Catch-all for unknown paths |

API routes (server only, do not restyle, do not rename):
`/api/trust/*` (nine signing routes; the UI calls only `authorize-join`),
`/api/pots`, `/api/pots/activity`, `/api/internal/pot-index` (see section 7).

## 3. Layout and component structure

- `app/layout.tsx` — root HTML, fonts, global CSS, toaster.
- `app/(app)/layout.tsx` — wraps pages in `Providers`.
- `components/app-shell.tsx` — page frame (header, back link, width).
- `components/login-gate.tsx` — Google sign-in gate. Pages that need a person
  render inside it. Keep it the single entry to sign-in.
- `components/setup-notice.tsx` — shown when sign-in is not configured.
- `components/home-nav.tsx`, `balance-row.tsx`, `test-money-card.tsx`,
  `money-input.tsx`, `name-row.tsx`, `person.tsx` — shared pieces.
- `components/pot/*` — pot screen: `add-money-dialog`, `repay-dialog`,
  `close-dialog`, `invite-card`, `members-list`, `pending-list`, `pot-card`,
  `pot-status`, `refund-card`, `activity-feed`.
- `components/feature/*` — shared library for Pay, Gifts, Savings, Pools,
  Streams, Cover: `primitives`, `feature-card`, `fields`, `action-button`,
  `progress-bar`, plus one folder per feature with its list and notices.
- `components/ui/*` — shadcn primitives (button, card, dialog, input, badge,
  avatar, skeleton, sonner…). Safe to restyle; keep props and exports.

## 4. Logic and contract interactions (do not rewrite)

| File | Why it matters |
|---|---|
| `lib/tx.ts` | `useSponsoredCall`: sends with Privy gas sponsorship, waits for the receipt, throws on a reverted receipt. `readableError` maps contract errors to plain sentences. Never retry a money action behind the user's back. |
| `lib/actions.ts` | Every write: `useCollectTestMoney` (`faucet`), `useCreatePot`, `useJoinPot` (calls the server for a signature, then `join`), `useAddMoney` (`approve` once, then `deposit`, shown as one step), `useRepay` (`requestSpend`), `useApproveRepayment`, `useCancelRepayment`, `useFinalizeFailed`, `useClaimRefund`, `useClosePot`. |
| `lib/queries.ts` | Reads: `useTestMoney`, `useMyPots`, `usePot`, `usePotActivity`. Pots and the feed are read straight from the PotManager contract. |
| `lib/contracts.ts`, `lib/abis.ts`, `lib/wagmi.ts` | Addresses, ABIs (generated by `pnpm gen:abis`), chain config. |
| `lib/trust/client.ts` | Browser client for signing routes. `authorizeJoin` is the only one the UI uses. |
| `lib/features/*-state.ts` | Pure functions that turn contract data into screen states (with tests). Screens must render these states, not re-derive them. |
| `lib/money.ts`, `lib/time.ts`, `lib/now.ts`, `lib/token.ts` | Amount (paise, 2 decimals) and date handling. A wrong unit moves the wrong amount. |
| `lib/store.ts`, `lib/people.ts` | Off-chain names and memos (Supabase, with on-device fallback). Only hashes go on-chain. |
| `lib/server/*`, `app/api/**` | Auth, origin check, rate limit, signer. Not UI. |
| `lib/nav/routes.ts` | Feature list, see section 2. |

The exact contract function names each screen calls are in `lib/actions.ts`
and `lib/features/*.ts`; read them there rather than from this summary.

Rules the contract enforces (the UI must reflect them, not bypass them):
- Repay to another member and under the limit: instant. Over the limit, or to
  yourself: needs one approval from a different member.
- Closing is the creator's action; leftovers return in proportion to what each
  person put in.
- Joining needs a server signature. If the server signer is off, join says
  "temporarily unavailable" (this is expected, see section 7).

## 5. States every screen must keep

For each data-driven screen, all of these exist today and must still be reachable:

- **Loading:** skeletons (`components/ui/skeleton.tsx`), e.g. Home pots.
- **Empty:** Home with no pots, a pot with no activity, no pending approvals,
  an empty list on each feature index.
- **Error with retry:** Home pots (`isError` → retry button), and the pot and
  feature screens. Do not replace with a blank area.
- **Not signed in:** `LoginGate`. **Sign-in not configured:** `SetupNotice`.
- **In progress:** buttons disabled with a working label while a transaction is
  pending; a transaction can take up to ~90 s to settle.
- **Success:** toast and refreshed data after the receipt, never before.
- **Failure:** the `readableError` sentence in a toast or inline.
- **Not a member / not found / wrong state:** e.g. "Only people in this pot can
  do that", closed pot, refunding pot (`pot-status`, `refund-card`).
- **Unavailable by design:** Agreements and Cover (next section).
- **Feature not deployed:** a nav row is pressable only when its contract is
  configured *and* its screens are built.

## 6. Unavailable features (must stay honest)

- **Cover:** the insurer key is not held by this app. Starting cover and
  deciding or paying a claim cannot happen. `lib/features/cover-state.ts`
  holds the exact notices (`INSURER_UNAVAILABLE`, the "this is not insurance"
  banner). Keep the notices visible and **do not add** a working-looking
  "Activate", "Pay claim" or "Approve claim" button.
- **Agreements:** recording a repayment needs the recorder and the recipient's
  signature; this app cannot do it. Create and view work. The unavailable
  action is labelled, with no button.
- **Gifts with attester conditions, oracle events, employer verification,
  income attestation:** resolve through signed messages from a named attester;
  nothing real feeds them. See `docs/limitations.md`.
- No screen may claim device verification, insurance cover, or a verified employer.

## 7. Known bugs, limits, unfinished

- **Joining a pot is blocked in production** unless `TRUST_SIGNER_ENABLED=true`
  and `TRUST_SIGNER_KEY` are set on the server; without them the join route
  answers 503 and the screen shows "temporarily unavailable". The signer in the
  local env matches the on-chain `trustSigner` (preflight, 2026-10-13).
- The pot-index API routes need Supabase migration
  `20261012_pot_activity_index.sql`, which is **not applied**. No screen calls
  them; they would fail, and nothing in the UI depends on them.
- Pot discovery scans the newest 200 pots only (`docs/pot-discovery.md`).
- Names and memos fall back to on-device storage if Supabase is unreachable.
- `lib/env.test.ts` timed out once under heavy parallel load and passed alone.
- Never run `scripts/flow-check.mjs` (disabled, old compromised key). Use
  `scripts/flow-check-safe.mjs` (dry run by default).
- Fee sponsorship, Google sign-in on the deployed domain, and every money flow
  in a real browser are **unverified** until the manual pass in
  `docs/manual-verification.md`.

## 8. Commands

Run from `apps/pot/` unless noted.

```bash
pnpm typecheck
pnpm lint
pnpm test                 # vitest, 127 tests
pnpm build                # production build
node --env-file=.env.local scripts/preflight.mjs    # read-only deployment check

# contracts, from packages/contracts/
forge test                # expects 408 passed
```

Baseline on 2026-10-13 before your changes: typecheck pass, lint pass, 126/127
app tests on the first run (one load-related timeout, passes alone), 408/408
contract tests, build pass.

## 9. Before you hand back

1. Run the four app checks above.
2. List every file outside `components/ui/`, `app/globals.css`, and page markup
   that you edited, and say why.
3. Confirm nothing in section 4 changed behaviour.
4. Tell the engineer; they will diff for accidental functional changes.

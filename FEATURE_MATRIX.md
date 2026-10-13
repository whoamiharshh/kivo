# FEATURE_MATRIX

Part of the [PROJECT_DOSSIER](PROJECT_DOSSIER.md). Describes what is implemented in
the **working tree** on 2026-10-12. Status words: **Implemented, unverified** (code
exists and typechecks; never exercised end to end by a person or a test),
**Incomplete**, **Missing**, **Broken (by code trace)**. "Verified" is used only
where a command or read-only query in this pass backs it. Nothing in the app has a
recorded authenticated end-to-end run, and no non-Pot contract has ever been used
on chain (counters all 0, see CONTRACTS.md §2).

## 1. Feature matrix

| # | Feature | User-facing name | Routes | Contract | Main source files | Server/API | Offchain data | Tests | Status | Key blockers |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Shared pot (core) | "Pot" | `/`, `/create`, `/join/[potId]/[code]`, `/pot/[id]` | PotManager | `app/(app)/page.tsx`, `create/page.tsx`, `join/…`, `pot/[id]/page.tsx`, `components/pot/*`, `lib/actions.ts`, `lib/queries.ts` | `authorize-action` (join) | `pots`, `pots_private`, `profiles`, `memos` | Contracts (documented); app: only `activity.test.ts` partial | **Implemented, unverified; join Broken** | K-03 (invite code never stored), K-04 (signer disabled/compromised), K-01 (pending-id bug) |
| 2 | Pay a person | "Pay a person" | `/pay`, `/pay/new`, `/pay/[id]` | SocialPay | `lib/features/pay.ts`, `pay-state.ts`, `components/feature/pay/*` | none | memo via `store.ts` | contracts only | Implemented, unverified (send/confirm/reclaim/dispute only) | claimable payments & dispute resolution have no UI |
| 3 | Gifts | "Give a gift" | `/gifts`, `/gifts/new`, `/gifts/[id]` | Gift | `lib/features/gift.ts`, `gift-state.ts`, `components/feature/gifts/*` | `attest-condition` | memo (message) | `gift-state.test.ts` (22, UI logic) | Date gifts: implemented, unverified. **Condition gifts: Broken (K-02)** | confirm path cannot succeed |
| 4 | Savings goals | "Save towards something" | `/savings`, `/savings/new`, `/savings/[id]` | BehaviourSavings | `lib/features/savings.ts`, `savings-state.ts`, `components/feature/savings/*` | `attest-behaviour` | none | contracts only | Implemented, unverified | ExternalSignal needs the (disabled) signer; self-reported steps |
| 5 | Group streaks | "Keep each other to it" | `/pools`, `/pools/new`, `/pools/[id]` | AccountabilityPool | `lib/features/pool.ts`, `pool-state.ts`, `components/feature/pools/*` | `attest-day` | none | contracts only | Implemented, unverified | "mark today" needs the (disabled) signer |
| 6 | Pay streams | "Pay as it earns" | `/streams`, `/streams/new`, `/streams/[id]` | SalaryStream | `lib/features/stream.ts`, `stream-state.ts`, `components/feature/streams/*` | none (`verify-employer` exists, unused) | none | contracts only | Implemented, unverified | none code-level; recipient picker needs shared pot membership |
| 7 | Cover | "Cover a small risk" | `/cover` (list only) | MicroCover | `lib/features/cover.ts` (837 lines of hooks), `cover-state.ts`, `components/feature/cover/*` | `attest-oracle` | memo | contracts only | **Incomplete**: list + disclosures; **no create or detail screen** | insurer role is the deployer EOA; no `activatePolicy` server write |
| 8 | Agreements | "Share what you earn" | `/agreements` (stub) | IncomeShare | `lib/features/agreement-state.ts` (types only); `app/(app)/agreements/page.tsx` | `attest-income`, `record-repayment` | `income_declarations` | contracts only | **Missing UI** (stub page that says "isn't ready yet") | recorder is the compromised signer; no hooks file |
| 9 | Activity feed (Pot) | Activity | inside `/pot/[id]` | PotManager views | `components/pot/activity-feed.tsx`, `lib/activity.ts`, `lib/queries.ts` | (none under B) | memos, names | `activity.test.ts` (3, event mapper only) | Implemented (state-derived), unverified | no timestamps; K-01 |
| 10 | Pot edit / leave | — | — | — | — | — | — | — | **Does not exist** (contract has no such action) | needs contract change |
| 11 | Employer verification | — | none (route exists) | none | `verify-employer/route.ts` | yes | `employer_attestations` | — | Incomplete (advisory, `verified:false` hardcoded) | |

## 2. Screen inventory (every route)

| Route | File | Purpose | Notes |
|---|---|---|---|
| `/` | `app/(app)/page.tsx` | Home: signed-out pitch + Google button; signed-in: greeting, balance row with faucet button, pot cards, feature nav, "Create a pot" sticky button | Shows `Skeleton` ×2 while loading, `ErrorState` with retry, `EmptyState` (empty pot illustration) |
| `/create` | `create/page.tsx` | New pot form | See §3.1 |
| `/join/[potId]/[code]` | `join/[potId]/[code]/page.tsx` | Invite landing + join | Reads pot via `usePot`; validates code shape |
| `/pot/[id]` | `pot/[id]/page.tsx` | Pot detail | See §3.1 |
| `/pay`, `/pay/new`, `/pay/[id]` | `pay/…` | SocialPay list/create/detail | People picker = people you share a pot with |
| `/gifts`, `/gifts/new`, `/gifts/[id]` | `gifts/…` | Gift list/create/detail | |
| `/savings`, `/savings/new`, `/savings/[id]` | `savings/…` | Goals | |
| `/pools`, `/pools/new`, `/pools/[id]` | `pools/…` | Group streaks | |
| `/streams`, `/streams/new`, `/streams/[id]` | `streams/…` | Pay streams | Live ticking (1 s `useNowSeconds`) |
| `/cover` | `cover/page.tsx` | Policy list + "not insurance" notice | Footer text: "New policies cannot be created in this demo." |
| `/agreements` | `agreements/page.tsx` | Stub | Flagged `built: true` in `lib/nav/routes.ts`, so Home nav links to it |
| `/[...slug]` | `[...slug]/page.tsx` | Catch-all "not ready / nothing here" | |
| `/api/**` | `app/api/**` | See [API_REFERENCE.md](API_REFERENCE.md) | |

Dead components/files (defined, never imported): `components/test-money-card.tsx`
(superseded by `balance-row.tsx`), `lib/server/signer.ts` shim,
`authorize-join` route alias.

## 3. Feature detail

### 3.1 Shared pot (core flow)

**Purpose/target user.** A group (project brief: Delhi college students running a
trip, flat-groceries or club kitty) agrees an amount and a date; everyone adds
money; the pot repays whoever paid under rules set up front; leftovers return
pro-rata; a pot that does not fill refunds each person. Nobody holds the money.

**Entry points.** Home → "Create a pot" or an invite link `/join/<potId>/<code>`.

**Journey (as coded) and state changes**

1. *Sign in* — `LoginGate`: skeleton while Privy loads; signed-out pitch with
   "Continue with Google"; "Setting up your account…" until the embedded wallet
   exists. If `ready.pots` is false (pot or token address blank) a setup notice
   appears instead.
2. *Get test money* — Home `BalanceRow`: shows the token balance; button "Get
   ₹5,000" calls `TestRupee.faucet()` (sponsored); disabled with "More tomorrow"
   when `canCollect` is false (24 h cooldown read from `lastClaim`). Toast
   "₹5,000 added". (README says the button reads "Get ₹5,000 test money" — the
   current label is shorter.)
3. *Create* (`/create`) — inputs and validation (client): name ≤40 chars required;
   target amount > 0 (`rupeesToPaise`: ≤2 decimals); deadline via
   `datetime-local` (default +7 days at the hour) must be in the future;
   max members integer 2–20 (default 6); "each person can repay, in total, up to"
   (approval limit, default ₹1,000; contract requires ≤ target); optional own
   name ≤24 chars. A per-person suggestion = target ÷ members (display only,
   stored offchain). Submit → `createPot(hash(inviteCode), limit, maxMembers,
   target, deadline)`; the receipt's `PotCreated` event gives the id; then
   `savePotMeta` (name, per-person share, invite code → Supabase + localStorage)
   and `saveDisplayName`. Navigates to `/pot/<id>?invite=1`.
   *Failure modes:* any revert → `readableError` toast; metadata write failures
   are silent (S-5/K-03).
4. *Invite* — `InviteCard` (creator only, Collecting, before deadline, spots left
   or just created): builds the join link from the invite code held in the
   creator's `localStorage` (null on other devices — the card then says the link
   "isn't saved here"); actions: a WhatsApp share button (`https://wa.me/?text=…`)
   and "copy link" (`navigator.clipboard`).
5. *Join* (`/join/<potId>/<code>`) — shows pot summary (members, collected vs
   target, deadline text, explicit refund promise), members list, name field.
   Branches: bad code shape; loading; "already in"; Refunding/Closed; deadline
   passed; full; else "Join this pot" → `authorizeJoin` (POST `authorize-action`)
   then `PotManager.join(potId, code, expiry, signature)`; saves display name;
   navigates to the pot. **Currently cannot complete** (K-03, K-04).
6. *Add money* — `AddMoneyDialog` (Collecting, before deadline, members only):
   balance and "still needs" shown; "Put in ₹X" shortcut (suggested share,
   capped by remaining); validation: positive, ≤ balance; sends `approve(max)`
   if allowance short then `deposit`. The contract takes only what the pot still
   needs; the UI says so. Reaching the target flips the pot to Funded.
7. *Repay* — `RepayDialog` (Funded): pick a member ("needs approval" tag on
   yourself), amount, memo ≤60 chars. Client checks: amount ≤ available
   (`balance − reserved`). Message mirrors the contract: instant if recipient ≠
   you and amount ≤ your remaining budget; otherwise "Ask for approval".
   `requestSpend(potId, to, amount, memoHash)`; memo text saved offchain first.
8. *Approve / Withdraw* — `PendingList` ("Waiting for approval", total set
   aside): non-requesters see **Approve** (`approveSpend`); requester or creator
   see **Withdraw** (`cancelSpend`; "Withdraw it for them" for the creator). When
   the pot is not Funded the card says it can no longer be paid. *The list is fed
   by `usePotActivity().pending`, which iterates spend ids 0…n−1 although the
   contract's ids are 1…n (K-01): a phantom id-0 entry appears and the latest
   request is hidden — Approve would revert `SpendNotFound`.*
9. *Close* — `ClosePotDialog` (creator, Funded): previews each person's refund
   (same pro-rata/last-contributor-dust rule as the contract) and disables when
   `pendingSpendCount > 0`; `closePot`.
10. *Didn't fill up* — `RefundCard`: when Collecting and the deadline has passed
    a member's browser quietly calls `finalizeFailed` once (and a manual "Open
    refunds now" button exists); in Refunding it shows "Claim your ₹X back"
    (`claimRefund`) or the waiting-on-others text.
11. *Activity* — `ActivityFeed`: plain-language rows (created, joined, added,
    requested/needs approval, funded, refunding, approved, withdrawn, paid,
    closed, refunded). Under implementation B rows have no time/ref and amounts
    are per-person totals.

**Permissions (enforced on-chain):** members only for deposit/repay/approve;
creator-only close; requester-or-creator cancel; anyone may `finalizeFailed`.

**Loading/empty/error states.** Pot detail: skeleton while loading; "We couldn't
find that pot" with retry on error; non-member banner "You're not in this pot";
feed: skeleton, error card with retry, or "Nothing has happened yet." Home: see
§2. Network/receipt wait: buttons show pending text; toasts on success/failure.

**Confirmations.** There are no wallet confirmation dialogs
(`showWalletUIs: false`); success toasts fire only after the receipt reports
success.

**Files/tests.** Above; app tests do not cover these screens.

### 3.2 Other features — journeys as coded

*Pay a person.* `/pay/new`: pick a known person (pot-mates), amount, "what is it
for?" (hashed; text offchain), acceptance window (choices from `WINDOWS`, 1 hour–30
days by the contract). Sends `approve` (if needed) + `sendPayment`. Detail page:
recipient sees accept (`confirmReceipt`); sender sees reclaim once the window
passes (`reclaim`); either party can dispute (`dispute`). Resolution voting and
claim-by-link are contract-only.

*Gifts.* `/gifts/new`: recipient, amount, message, "unlock on a date" (≥ tomorrow
in the form; contract min +1 h) or "when somebody confirms" (confirmer chosen from
people), irrevocable switch. `/gifts/[id]`: recipient claims (`claim`); giver
cancels if revocable (`cancel`); confirmer confirms (`attestCondition` via the
server); recipient may release after the 2-year wait (`requestTimeoutRelease`).

*Savings.* `/savings/new`: name, target, optional "steps a day" (a note, not
checked by software), finish date (+7 to +365 days); shows the stake (10 %).
Detail: top up (`deposit`), "Steps today" → server signature → `submitBehaviour`,
close (`finalise`), claim (`claimOutcome`). Copy states the money returns whatever
happens and that bonuses come only from others' missed goals.

*Pools.* `/pools/new`: description, daily metric, stake each, last day, days to
mark, days allowed to miss, people (2–20), own name. Detail: join (`joinPool`),
"mark today" (server `attest-day` → `attestDay`), settle (`finalise`), claim
(`claim`).

*Streams.* `/streams/new`: payee, amount per day, number of days (1–365), amount
to put in now (defaults shown; summary shows full-term cost and runway). Detail:
employee withdraws (`withdraw`); employer adds funds (`topUp`), pauses/resumes,
cancels (`cancelStream`).

*Cover.* `/cover` lists policies with disclosure that this is not insurance and
that a bought-but-unbound policy is not cover. Hooks exist for taking cover,
raising a claim, deciding a claim (via `attest-oracle`), taking back a premium,
closing ended cover, and insurer actions (bind/refuse/fund reserve), but no screen
calls the create/claim/insurer hooks.

*Agreements.* Nothing user-facing. Backend path exists (create on-chain by anyone,
`attest-income` → recipient signs → `record-repayment`).

## 4. Action and button inventory (Pot)

| Control | Where | Calls | Enabled when |
|---|---|---|---|
| Continue with Google | signed-out Home | Privy `login()` | not authenticated |
| Get ₹5,000 | Home | `faucet()` | `canCollect` |
| Your name (NameRow) | Home | `saveDisplayName` | always |
| Create pot | `/create` | `createPot` | form valid |
| Share/Copy invite | pot detail (creator) | clipboard/share | invite code present on device |
| Join this pot | join page | `authorizeJoin` + `join` | not member, not full, not past/failed |
| Add money | pot detail | `approve` + `deposit` | member, Collecting, before deadline |
| Repay | pot detail | `requestSpend` | member, Funded |
| Approve | pending list | `approveSpend` | not requester (and not recipient — **UI only checks requester**; contract also forbids recipient → `CannotApproveOwnPayout`, which `readableError` does not map) |
| Withdraw (it for them) | pending list | `cancelSpend` | requester or creator, Funded |
| Close pot | pot detail (creator) | `closePot` | Funded, no pending |
| Open refunds now | refund card | `finalizeFailed` | Collecting past deadline |
| Claim your ₹X back | refund card | `claimRefund` | Refunding, share > 0 |
| Sign out | header | Privy `logout()` | authenticated |

## 5. Dead ends and placeholders (Verified in source)

- Home nav → `/agreements` → "isn't ready yet" (flagged built).
- `/cover` → no way to create a policy ("cannot be created in this demo").
- Gift confirm cannot succeed (K-02); join cannot be authorized (K-03/K-04); pending
  approvals mis-indexed (K-01).
- Edit/leave pot absent; two-member pots cannot approve over-limit payments between
  the two members (contract rule); SocialPay claimable payments and dispute
  resolution absent from UI.
- Savings "ExternalSignal"/steps goals and pool days depend on a signature the
  server currently refuses to produce (503).
- People pickers only offer pot-mates (documented design limit).
- Many controls have never been clicked by a person; the test log files in
  `.playwright-mcp/` are the only browser artifacts (not reviewed in this pass).

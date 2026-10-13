# What is verified, and what still needs a human

Three words, used strictly:

- **Tested** — an automated test or script passed.
- **Seen live** — read from, or done on, the real Monad Testnet.
- **Not verified** — nobody has done it. Treat as unknown, not as working.

---

## A. Already done (don't redo)

| What | Result | Kind |
|---|---|---|
| Contract suite (`forge test`) | 408 passed, 0 failed, 0 skipped | Tested |
| App tests (`vitest`) | 119 passed across 13 files | Tested |
| Typecheck, lint, production build | all clean; build includes the new Cover and Agreements routes | Tested |
| The five existing pots read from the chain | 5 pots, states and balances as expected | Seen live (read-only) |
| `flow-check-safe` refusals (compromised address ×2, missing key, malformed key, missing contract) and its dry run | behaved as designed; nothing sent | Seen live (read-only) |
| `preflight` against the old deployment | correctly **NOT READY**: all 7 roles flagged as compromised | Seen live (read-only) |
| Pot repayment numbering (1-based) and the state-derived activity feed | 9 regression tests | Tested |
| Error handler passes our server's own message through | 4 tests | Tested |
| Cover and Agreements state logic ("never say covered unless it is", take-back timing, the share arithmetic, the wording) | 33 tests | Tested |
| Cover policy numbering (1-based). **A real bug**: the Cover list read policy 0, which does not exist, so it would have failed as soon as one policy was created. Found by an independent review, confirmed against the contract, fixed, tested. Every other list was checked against its contract and is correct. | 4 tests | Tested |
| Independent review of the new code and scripts by three separate models | findings fixed (see the report) | Reviewed |

**Nothing has been sent to the chain this session. Nothing has been deployed.**

---

## B. Testnet transactions still to be done

Tick each only when you have *seen the result*, not when you sent it.

**Deployment (needs your explicit go-ahead — see `docs/fresh-deployment-plan.md`)**
- [ ] `forge script … Deploy.s.sol` as a **simulation** (no `--broadcast`); read the gas and role output
- [ ] Same with `--broadcast`; record all nine addresses and the deploy block
- [ ] Role read-back, all seven getters match what you meant (plan §4)
- [ ] Contracts verified on Sourcify
- [ ] `preflight` prints **READY**

**Contract lifecycle (`docs/flow-check.md`)**
- [ ] `flow-check-safe` dry run reviewed
- [ ] `flow-check-safe --send --yes`: pot that fills → closes; pot that misses → refunds (9 transactions)

**Through the app, with real accounts**
- [ ] Get test money (faucet) — then again the same day (must refuse)
- [ ] Add money (approval + deposit as one step)
- [ ] **Join a pot** — the only flow that needs the server signer
- [ ] Repay within the personal budget → instant
- [ ] Repay past the budget → waits; a different member approves → paid
- [ ] Withdraw a waiting repayment; confirm closing is refused while one is waiting
- [ ] Close a funded pot; each member's share matches the preview
- [ ] A pot that misses its deadline: refunds opened (by the app, and by hand), each member claims, last claim finishes it
- [ ] Try to claim twice / claim without having paid (must refuse)

**Optional features (not on the demo path)**
- [ ] Cover: put a premium in holding (needs approval + create)
- [ ] Cover: take the premium back — earliest is **after the cover period ends**; the shortest period offered is 3 hours, so start early if you want to see this
- [ ] Agreements: record one, open it, check the wording matches its fingerprint
- [ ] Agreements: close one out — needs the end date to pass (earliest is the day after you create it)

---

## C. Browser flows (do on a phone, in Chrome)

- [ ] Sign in with Google; first-time account setup completes
- [ ] Sign out and back in; the same account and balance come back
- [ ] Fee sponsorship actually covers actions (no "Fees aren't being covered")
- [ ] Home · Create a pot · Pot page · Invite card (WhatsApp + Copy) · Join page
- [ ] Add money · Repay · Approve · Withdraw · Close · Refund card
- [ ] Join page states: invalid link, pot full, already joined, closed, deadline passed
- [ ] Screens at 360, 390 and 412 px wide; no sideways scrolling
- [ ] Slow network and airplane-mode-mid-action: never shows a success it didn't get
- [ ] Words: no "wallet", "gas", "crypto", "token", "blockchain" anywhere a person can read
- [ ] A "test money" label wherever an amount appears

---

## D. Cannot work on this setup (by design) — must be labelled, never faked

- Anything needing the **old** compromised signer or deployer.
- Cover: **binding** a policy and **paying or declining** a claim (insurer-only).
- Agreements: **recording a repayment** (recorder-only).
- Check that each of these says so on screen and offers no button that pretends.

---

## E. Unverified assumptions and risks

1. **Wording storage.** Cover and Agreement wording is stored offchain by its
   fingerprint. If the real Supabase `memos` table limits text length (the
   schema in this repo limits it to 60 characters), long wording will only
   survive on the device that wrote it. *Check:* create an Agreement on one
   phone, open it on another.
2. **Fee sponsorship policy.** If Privy restricts sponsorship to listed contract
   addresses, the new addresses must be added or every action fails.
3. **Five phones at once.** The public RPC may rate-limit (429). No concurrent
   benchmark exists. A dedicated `NEXT_PUBLIC_RPC_URL` is the fix.
4. **Old database rows.** Old `pots` / `pots_private` rows for pots 1–5 will
   attach to the wrong new pots unless cleared (plan §7) — needs your approval.
5. **Uncommitted work.** About 170 files are uncommitted (nothing has been
   committed this session). The **latest** backup (all screens, scripts and
   docs, plus the git history) is
   `C:\Users\Sir\AppData\Local\PotBackups\pot-uncommitted-20261013-003512`.
   An earlier one, from before the Cover and Agreements screens, is
   `…\pot-uncommitted-20261012-233753`.
6. **Generated edit.** `next build` adds two `.next-validation` globs to
   `apps/pot/tsconfig.json`. Harmless; revert if you want a clean diff.
7. **Unused code.** `/api/pots*`, `lib/server/pot-indexer.ts` and the activity
   migration are not used by the app and have not been applied or run.

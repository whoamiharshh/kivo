# Fresh deployment plan — for review

**Status: a plan only.** Nothing in this document has been run. No contract has
been deployed, no transaction broadcast, no role changed, no key created.
Every step marked **(you)** needs you at your own terminal, and the deploy
itself needs your explicit go-ahead.

## 1. Why this is needed

The roles below were fixed at deployment as `immutable`, so they cannot be
rotated, only replaced by deploying new contracts. Two of the keys behind them
were exposed and are treated as compromised.

| Contract | Role (immutable) | Held by today | Needs redeploying? |
|---|---|---|---|
| PotManager | `trustSigner` — authorises who may **join** a pot | compromised trust signer | **Yes** |
| AccountabilityPool | `attester` | compromised trust signer | **Yes** |
| IncomeShare | `recorder` — may record a repayment | compromised trust signer | **Yes** |
| MicroCover | `insurerSigner` — signs payouts | compromised trust signer | **Yes** |
| MicroCover | `insurer` — binds cover, withdraws reserve | compromised deployer | **Yes** (same contract) |
| SocialPay | `arbitrator` | compromised deployer | **Yes** |
| BehaviourSavings | `admin` | compromised deployer | **Yes** |
| TestRupee, Gift, SalaryStream | none | — | No (but see §6) |

**What is blocked today because of this:** with the trust signer switched off,
no new person can join any pot. That is the reason a test with 5 real people
cannot happen until this is done.

## 2. Decisions for you before anything runs

| # | Decision | Recommendation | Why |
|---|---|---|---|
| D1 | How much power does the **server-held** signer get? | `trustSigner` and `poolAttester` only. Point `RECORDER`, `INSURER`, `INSURER_SIGNER` at the **offline deployer** instead. | The server key is a hot key in a hosting dashboard — the thing that leaked last time. Giving it only the powers the demo needs (admit joiners, attest pools) limits what a second leak could do. It also means no server code can authorise a Cover payout, which matches "do not simulate payouts". |
| D2 | Reuse the old TestRupee? | **No — deploy a fresh one.** | `Deploy.s.sol` always creates a new token and has no option to reuse one. Reusing means editing the script. For a demo, testers just tap the faucet; old balances don't matter. |
| D3 | What happens to the old `pots` / `pots_private` rows in Supabase? | Export them, then clear just those two tables. | A new PotManager numbers pots from 1 again, so old names would attach to the wrong new pots (see §7). Clearing needs your approval. |
| D4 | Dual deployment (old and new side by side)? | **No, for the hackathon.** Clean cutover. | The data-model work for dual deployment is days, not hours. The old pots hold test data only (§8). |

## 3. Keys and roles

Create **two** fresh keys, on your machine, **never in chat, a file in the repo,
or a screenshot**. Neither may be either compromised address.

| Key | Where it lives | Roles (with D1 as recommended) | MON needed |
|---|---|---|---|
| **Deployer** | A Foundry keystore on your machine; **offline after the deploy** | Deploys everything. Becomes `arbitrator`, `savingsAdmin`, `insurer`, and (D1) `recorder` and `insurerSigner`. On testnet those fall back to the deployer automatically, with printed warnings. | about 3–4 MON (see §4) |
| **Trust signer** | Vercel environment variable `TRUST_SIGNER_KEY` (a hot key) | `PotManager.trustSigner`, `AccountabilityPool.attester` | about 0.1 MON (only if the server ever sends a transaction) |

(you) Create them:

```
cast wallet new                                # twice; keep each key in its own window only
cast wallet import pot-deployer --interactive  # imports the DEPLOYER key into a keystore
```

The trust signer's key goes only into Vercel's environment settings (§5) — never
into a file in this repo.

## 4. Deployment order and commands

`script/Deploy.s.sol` deploys everything in one run, in this order:

1. TestRupee
2. PotManager(token, **trustSigner**)
3. SocialPay(token, **arbitrator**)
4. Gift(token)
5. BehaviourSavings(token, **admin**)
6. AccountabilityPool(token, **attester**)
7. SalaryStream(token)
8. IncomeShare(**recorder**)
9. MicroCover(token, **insurer**, **insurerSigner**)

On Monad Testnet any role you don't set falls back to the deployer, with a loud
warning. With D1, you set only the two hot-key roles. PowerShell, from
`packages\contracts`:

```powershell
$env:TRUST_SIGNER  = "0x<fresh trust signer ADDRESS>"
$env:POOL_ATTESTER = $env:TRUST_SIGNER
# ARBITRATOR, SAVINGS_ADMIN, RECORDER, INSURER, INSURER_SIGNER are left unset
# on purpose: on testnet they become the (offline) deployer, with warnings.

# 1. SIMULATE first — no --broadcast. Sends nothing; prints gas and addresses.
forge script script/Deploy.s.sol --rpc-url monad_testnet --account pot-deployer --sender 0x<deployer ADDRESS>

# 2. Only after you have read that and said go:
forge script script/Deploy.s.sol --rpc-url monad_testnet --account pot-deployer --sender 0x<deployer ADDRESS> --broadcast
```

**Funds:** the simulation prints the total gas. Gas price measured on the chain
is 102 gwei. The earlier deploy was estimated at about 4 MON; take the figure
from the simulation, not from this document.

**After the deploy,** read every role back and confirm it matches what you meant:

```
cast call <PotManager>         "trustSigner()(address)"   --rpc-url monad_testnet
cast call <AccountabilityPool> "attester()(address)"      --rpc-url monad_testnet
cast call <SocialPay>          "arbitrator()(address)"    --rpc-url monad_testnet
cast call <BehaviourSavings>   "admin()(address)"         --rpc-url monad_testnet
cast call <IncomeShare>        "recorder()(address)"      --rpc-url monad_testnet
cast call <MicroCover>         "insurer()(address)"       --rpc-url monad_testnet
cast call <MicroCover>         "insurerSigner()(address)" --rpc-url monad_testnet
```

Also record the **block number** of the deploy (`NEXT_PUBLIC_DEPLOY_BLOCK`), and
verify the contracts on Sourcify as before.

Not done by the script, and not needed for the demo: BehaviourSavings has no
approved verifier, so "external signal" savings goals can't be created until its
admin runs `registerVerifier` then `setBehaviourVerifier`. Habit goals work.

## 5. Environment variables

Names only. Values go into Vercel's settings and your local `.env.local`
(which is git-ignored) — never into a committed file.

**Public, set from the deploy output** (these are visible to anyone anyway):

```
NEXT_PUBLIC_TEST_RUPEE_ADDRESS        NEXT_PUBLIC_SALARY_STREAM_ADDRESS
NEXT_PUBLIC_POT_MANAGER_ADDRESS       NEXT_PUBLIC_INCOME_SHARE_ADDRESS
NEXT_PUBLIC_SOCIAL_PAY_ADDRESS        NEXT_PUBLIC_MICRO_COVER_ADDRESS
NEXT_PUBLIC_GIFT_ADDRESS              NEXT_PUBLIC_ACCOUNTABILITY_POOL_ADDRESS
NEXT_PUBLIC_BEHAVIOUR_SAVINGS_ADDRESS NEXT_PUBLIC_ARBITRATOR_ADDRESS   (the deployer address)
NEXT_PUBLIC_DEPLOY_BLOCK
```

**Server-only secrets:**

```
TRUST_SIGNER_KEY        the FRESH trust signer key
TRUST_SIGNER_ENABLED    set to true ONLY after the role read-back in §4 confirms
                        PotManager.trustSigner() equals the fresh signer's address
SUPABASE_SECRET_KEY     the ROTATED one
PRIVY_APP_SECRET        the ROTATED one
PRIVY_VERIFICATION_KEY, IP_HASH_SALT   unchanged
```

**Also needed for a live site:**

```
NEXT_PUBLIC_APP_URL         the deployed origin
NEXT_PUBLIC_RPC_URL         a dedicated Monad testnet endpoint, if you have one
TRUST_IP_MAX_PER_MINUTE     raise it if all 5 testers share one wifi address
                            and start seeing 429s (default 240)
```

Next.js bakes `NEXT_PUBLIC_*` values in at **build** time, so after changing any
of them, Vercel must rebuild — changing the value alone does nothing.

## 6. Frontend configuration

- Point the app at the new addresses only through the variables above; no code
  change is needed for that.
- The "unavailable on this setup" wording on Cover and Agreements was written for
  *this* deployment's role configuration. After a fresh deploy with D1, it stays
  true (the insurer and recorder are offline), so it should be **left as is**.
  If you later give those roles to something real, revisit it.
- The legacy-signer refusal in the server stays in place; a fresh signer passes it.
- Privy: allow only the exact production origin (not `*.vercel.app`), configure
  the OAuth redirect separately, and confirm fee sponsorship for Monad Testnet.
  Check whether the sponsorship policy restricts contract addresses — if it does,
  the new addresses must be added or every sponsored action will fail.

## 7. Old state in the database

Supabase `pots` and `pots_private` are keyed by `pot_id` alone. A new PotManager
starts at pot 1 again, so the old rows for pots 1–5 would attach their **names
and invite codes to the wrong new pots**. The browser's local storage uses the
same key (`pot:meta:<id>`), but only your own development browser has old values.

Cleanest for a clean cutover (**D3, needs your approval**): export both tables,
then clear them. `profiles` (keyed by address) and `memos` (keyed by hash) don't
collide and can stay.

## 8. Old on-chain state

Read from the chain at block 70463074 (not assumed):

| Pot | State | Held | Deadline |
|---|---|---|---|
| 1, 2 | Closed | nothing | — |
| 3 | Collecting | nothing | 2026-10-14 15:36 UTC |
| 4 | Collecting | nothing | 2026-10-18 19:30 UTC |
| 5 | Collecting | **₹2,000 (200,000 paise)** | 2026-10-18 19:30 UTC |

Pot 5's money is **recoverable without any key**: after its deadline, anyone can
call `finalizeFailed(5)`, then its one contributor calls `claimRefund(5)`. Or its
creator can fill the pot to its target and close it. The old contracts stay on
chain, unused. The leaked key keeps its power *over the old contracts only*,
which the new app no longer points at.

## 9. Rollback — what it cannot do

- **A deploy cannot be undone.** Contracts are permanent.
- Pointing the app back at the old addresses is possible, but the old signer is
  compromised, so joins would stay off. There is **no safe way back for joining**.
- A previous Vercel build restores the screens, not the contracts.
- Money put into the new pots comes back only by the contracts' own rules
  (closing, or refunds after a missed deadline). Nobody, including you, can pull
  it out otherwise.
- If the new deploy has a mistake in a role, it is a second redeploy.

## 10. After the deploy: proving it works

1. Role read-back (§4) — every address is what you intended.
2. `flow-check-safe` dry run, then `--send --yes` against the **new** addresses
   (see `docs/flow-check.md`). This proves both endings of a pot on the real chain.
3. In a browser, with two different Google accounts: create a pot, join it from
   the invite link, add money, repay, close — and a second pot that misses its
   deadline and refunds. Step 3 is the only thing that tests joining.
4. Only then give the link to testers.

## 11. What this plan does not cover

- Production hardening, monitoring, load testing.
- Making Cover payouts or Agreement repayments work: those need a real insurer
  and recorder, which this plan deliberately leaves offline.
- Any real-money path. This is test money only.

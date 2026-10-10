# Pot — shared money for friend groups (Monad Metropolis, Track 2)

A group agrees on an amount to collect and a date to collect it by. Everyone
adds money to one pot. If the pot fills up, it repays whoever paid for group
costs, under rules the group set up front, and the leftover goes back to each
person in proportion to what they put in. If it doesn't fill up by the date,
everybody takes their own money back. Nobody has to hold the group's money.

> **This runs on Monad Testnet with test money only.** "Test Rupee" is a play
> token with no value. There is no real-money top-up and nothing here touches
> mainnet.

## Where things stand

| Part | Status |
|---|---|
| Contracts written | ✅ Pot itself: `TestRupee.sol`, `PotManager.sol`. Six more for the other tracks: `SocialPay.sol`, `Gift.sol`, `BehaviourSavings.sol`, `SalaryStream.sol`, `IncomeShare.sol`, `MicroCover.sol` |
| Contracts compile | ✅ Solc 0.8.24, OpenZeppelin v5.7.0 |
| Tests | ✅ **334 of 334 pass** (`forge test`, nine suites) — Pot 82, MicroCover 62, SocialPay 50, Gift 38, SalaryStream 37, BehaviourSavings 34, IncomeShare 31 |
| App built | ✅ 5 screens, typechecks clean, production build passes |
| Deployed to Monad Testnet | ❌ **not done** — needs a funded testnet account (step 2) |
| App running against a live deployment | ❌ not done — blocked on the deploy above |
| Deployed to Vercel | ❌ not done (step 6) |
| User testing with real people | ❌ not done (step 7) |

Note on the test count: the original brief mentioned 20 tests for Pot. Pot's
rules grew (a target, a deadline, refunds on failure, a cumulative spending
budget) and its suite grew with them to 82. No rule was weakened to make a
test pass. The other 252 tests cover the six contracts written for the other
tracks, which are listed in the table above and in `docs/limitations.md`; the
rest of this README is about Pot only.

## What actually works today

Everything below is implemented and covered by the contract test suite — but it
has not yet been exercised by a person tapping through a live app:

- **Create a pot** with a name, the amount the group is collecting, the date it
  must be collected by, a no-questions repayment limit, and a cap on how many
  people can join (at most 20).
- **Share an invite link** (WhatsApp or copy). Friends sign in with Google and
  join. They can still join after the pot has filled up, so a friend who paid
  for something can be added and then repaid.
- **Collect ₹5,000 of test money** once a day, then add any amount to a pot.
  Adding more than the pot still needs takes only what's needed and leaves the
  rest with you — the pot never overshoots its target.
- **The pot fills up**, and only then can money leave it.
- **Repay a member.** Under the limit and to someone else, it lands
  immediately. Over the limit, or repaying yourself, it waits for one other
  member to approve. A waiting request holds its amount aside, so two requests
  can't both be approved for money the pot doesn't have. Whoever asked, or the
  creator, can cancel a waiting request.
- **Close the pot** (creator only, and not while a request is still waiting).
  Leftover is returned pro-rata to what each person put in, with the rounding
  remainder going to the last contributor so not a single paisa is stranded.
- **The pot doesn't fill up in time** → everyone takes their own money back.
  Each person claims their own share, so nobody has to wait on the creator, and
  an unclaimed share stays claimable indefinitely.
- **An activity feed** built entirely from contract events.

## What is deliberately not built

Scheduled or automatic pulls, recurring rent, landlord and utility payouts,
penalties, moving money between members, real-money top-up, mainnet, and any
personal data onchain. Only hashes of names and memo text ever reach the chain.

## Structure

A pnpm workspace. `pnpm-workspace.yaml` takes in `apps/*` and `packages/*`.

- `packages/contracts/` — Solidity (Foundry): `TestRupee.sol`, `PotManager.sol`,
  `SocialPay.sol`, `Gift.sol`, `BehaviourSavings.sol`,
  `SalaryStream.sol`, `IncomeShare.sol`, `MicroCover.sol`, **334 tests**
  across nine suites, deploy script
- `apps/pot/` — Next.js 16 app (Privy + wagmi/viem + Tailwind + shadcn/ui on Base UI)
- `apps/trust/` — Expo Router app for iOS, Android and web. **Not built yet.**
- `packages/verification/` — the native trust layer. **Not built yet.**
- `packages/shared-ui/` — design tokens shared by both apps. **Not built yet.**
- `supabase/schema.sql` — offchain store for names and memo text
- `supabase/migrations/` — the trust-layer schemas (micro-insurance evidence
  store is here; the earlier ones currently live only in the Supabase project)
- `docs/limitations.md` — what this cannot do, cannot verify, or does not do yet
- `docs/insurer-api.md` — the app ↔ licensed-insurer contract for `MicroCover`
- `docs/context.md` — where the build stands, what's blocked, decisions taken
- `docs/tech.md` — the technical reference: contract surface, app file map, data flow
- `docs/user-testing.md`, `docs/feedback-log.md` — session script and results template
- `docs/questionnaire.md` — the pre-build research questions

## How the money rules work

All pots live in one contract, and a pot moves through four states — in the
app's words: **Collecting → Ready to spend → Finished**, or
**Collecting → Didn't fill up → Finished**.

**While collecting**

- Contributions never exceed the target; the excess simply isn't taken.
- The deadline is exclusive: money goes in strictly before it.
- Money cannot leave a pot that hasn't reached its target.

**Once it's ready to spend**

- Payouts only ever go to members. The pot reimburses the friend who paid.
- The limit is a **cumulative budget per person**, not a per-request ceiling.
  Each member may move up to that much in total without anyone else agreeing;
  past that, every further request needs one approval. That is what stops one
  person splitting a big payout into many small ones.
- A payout **to yourself** needs an approval, whatever the amount. You cannot
  approve your own request.
- A waiting request **reserves** its amount, so the pot can never promise the
  same money twice.
- A pot cannot close while requests are still waiting — and the requester or
  the creator can cancel one, so a stale request can't freeze the pot.
- Only the creator can close it, and closing refunds strictly in proportion to
  contributions, so closing cannot be used to take the money.

**If the deadline passes without the target being met**

- Anyone can tip the pot into refunding — a contract can't wake itself up, so
  this is deliberately permissionless and nobody depends on the creator.
- Each contributor claims their own money back, exactly once, never someone
  else's, and never dependent on anyone else claiming first.

Known limitation, inherited from keeping invites simple: the invite code
becomes visible onchain once someone joins with it. The cap on members bounds
the damage, and a pot is a friend group, not a public pool.

---

# Running it yourself

Each step says exactly what to type and what you should see. If a step prints
something unexpected, stop there rather than carrying on.

## Step 1 — the contracts (done, repeatable)

Foundry is the toolkit that compiles and tests Solidity. If `forge --version`
prints nothing, install it from <https://getfoundry.sh>. On Windows, the
simplest route is to download `foundry_*_win32_amd64.zip` from the
[Foundry releases page](https://github.com/foundry-rs/foundry/releases/latest)
and unzip it into a folder that is on your PATH.

```bash
cd packages/contracts
forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts
forge test
```

You should see `334 tests passed, 0 failed` — Pot's own 82 plus the six
other-track contracts' 252.

## Step 2 — put the contracts on Monad Testnet  ⟵ **needs you**

This is the one step that spends something: a tiny amount of testnet MON to
pay for publishing. It is free to obtain and worthless outside the testnet.

**2a. Make a key that exists only for this.** Never reuse a key that holds
anything real, and never paste a key into a chat window.

```bash
cast wallet new
```

This prints an address and a private key. Copy the private key, then import it
under a name so you never have to paste it again:

```bash
cast wallet import pot-dev --interactive
```

It asks for the private key (paste it here — this is your own terminal, and it
is not echoed) and then a password you choose. From now on you refer to it as
`pot-dev`.

**2a-bis. Make the server's signing key.** The app's server holds one key,
separate from the one above. Its only power is to admit somebody to a pot once
it has checked their invite code; it cannot spend, approve, close or refund
anything. Make it, keep the private half in `.env.local`, and give the deploy
its address:

```bash
openssl rand -hex 32
```

Prefix the output with `0x`, put that in `apps/pot/.env.local` as
`TRUST_SIGNER_KEY`, and read off its address:

```bash
cast wallet address --private-key 0x<that-hex>
```

That address is `TRUST_SIGNER` in step 2c. Skip this and the deploy still works
on Monad Testnet, but the trust signer falls back to your deploy key — which
the script warns about, and which means your deploy key can admit joiners.

**2b. Get testnet MON.** Open the Monad testnet faucet, paste the **address**
from `cast wallet new`, and request funds. Confirm it arrived:

```bash
cast balance <your-address> --rpc-url https://testnet-rpc.monad.xyz
```

A number greater than 0 means you are ready.

**2c. Publish the contracts.**

```bash
cd packages/contracts
TRUST_SIGNER=0x<the address from 2a-bis> \
  forge script script/Deploy.s.sol --rpc-url monad_testnet --account pot-dev --broadcast
```

It prints every address, then the roles it used. **Read the role list.** Any
line saying `WARNING: placeholder role held by the deployer` means that power
is held by your deploy key because you did not set it. On Monad Testnet with
test money that is fine, and the script says so out loud. It is not fine
anywhere else — see "Running this anywhere but Monad Testnet" below, where the
script refuses rather than warns.

One thing the deploy does NOT finish: `BehaviourSavings` starts with no
approved verifier, so goals that depend on an off-chain signal cannot be
created until the savings admin calls `registerVerifier` and then
`setBehaviourVerifier`. Goals verified from the contract's own deposit records
("save consistently") work immediately. That default is deliberate: an empty
registry means nothing can assert an off-chain fact until somebody has decided
who is allowed to.

**2d. Note the block number**, so the activity feed does not have to scan the
whole chain:

```bash
cast block-number --rpc-url https://testnet-rpc.monad.xyz
```

**2e. Write all three into `apps/pot/.env.local`** and into the table at the bottom
of this README.

## Running this anywhere but Monad Testnet

Short version: **do not**, and the deploy script will not let you do it by
accident.

`script/Deploy.s.sol` refuses to run unless `block.chainid` is 10143. To run it
anywhere else you have to set `ALLOW_OTHER_CHAIN=true`, and once you do, two
rules replace the testnet's friendly defaults:

- **every role must be named explicitly.** A missing one stops the deploy with
  `RoleNotSet("…")` before a single transaction is sent.
- **no role may be the deploying address.** `RoleIsDeployer("…")`. This is the
  one that matters: on a real network, letting the insurer default to whoever
  ran the script makes that person the insurer.

The six roles, what each actually holds, and what would make it legitimate:

| Role | Power it holds | What makes it legitimate |
|---|---|---|
| `TRUST_SIGNER` | Admits joiners to pots whose invite code the server checked. Moves no money. | A key held by the app's server, in a KMS or signing service rather than an env var. |
| `ARBITRATOR` | One seat of three in a `SocialPay` dispute. | A named third party who agreed to the role, or a decentralised arbitration layer. Not the operator. |
| `SAVINGS_ADMIN` | Approves who may attest a behaviour signal in `BehaviourSavings`, and which approved address new goals are given. Cannot touch the money. | Whoever is accountable for the attestation source. Today nothing in this repo produces an attested signal at all. |
| `RECORDER` | Records income attestations in `IncomeShare`. | A licensed counterparty's signer, or an Account Aggregator integration. Neither exists here. |
| `INSURER` | Receives premiums and funds the reserve in `MicroCover`. | **A company holding an IRDAI certificate of registration.** Nothing else. See `docs/limitations.md`. |
| `INSURER_SIGNER` | Authorises an insurance payout. Deliberately a different key from the treasury. | That insurer's claims-signing key, held by them and not by this app. |

And the things no deploy flag can fix, one line each: the money is test money
and `TestRupee` has a public faucet; the contracts are unaudited; every
off-chain attestation is signed by a server you have to trust rather than by an
attested device; there is no licensed insurer, no Account Aggregator consent
flow and no real parametric oracle. `docs/limitations.md` is the long version,
`docs/security-audit.md` the findings list.

## Step 3 — Privy, so people can sign in with Google  ⟵ **needs you**

Privy handles the Google sign-in, quietly makes an account for each person, and
pays the network fees for them so the app never mentions fees at all.

1. Make an app at <https://dashboard.privy.io>.
2. **Login methods** → turn on **Google**, turn everything else off.
3. **Fee sponsorship** → enable it and cover **Monad Testnet**. Privy has been
   subsidising Monad Testnet usage; if the chain is not offered on your plan,
   email `monad@privy.io`. Without this step, actions will fail with a
   "fees aren't being covered" message.
4. Copy the **App ID** into `apps/pot/.env.local`.

## Step 4 — the offchain text store (optional)

Pot names, people's names and memo text are not onchain. With Supabase they
follow a person across devices; without it they are remembered on the device
only, which is fine for a single-device demo.

To switch it on: make a free project at <https://supabase.com>, open
**SQL Editor**, paste all of `supabase/schema.sql`, run it, **then run every
file in `supabase/migrations/` in filename order**, then copy the project URL
and the anon key into `apps/pot/.env.local`.

The migrations are not optional extras. `20261010_split_invite_codes.sql` is
what moves invite codes out of the world-readable table they used to sit in, so
a database with `schema.sql` alone has no `pots_private` table and no join can
be authorised at all. You also need the **secret (service-role) key** in
`apps/pot/.env.local` as `SUPABASE_SECRET_KEY`, because reading a stored invite
code is precisely the thing the browser's key must not be able to do.

## Step 5 — run the app

```bash
cd apps/pot
pnpm install
pnpm dev
```

Open <http://localhost:3000>. If a value in `.env.local` is missing or
malformed the app **refuses to start** and prints one message listing every
problem at once, rather than failing later on the screen that needed it. The
check lives in `apps/pot/lib/env.ts` and covers the Privy app ID, both
Supabase values and `TRUST_SIGNER_KEY`.

To check it builds the way it will in production:

```bash
pnpm build
```

To run the tests:

```bash
pnpm test        # app: nonce replay, request guards       (18 tests)
cd ../../packages/contracts && forge test   # contracts    (408 tests)
```

## What protects the API

Every route under `apps/pot/app/api/trust/` goes through one wrapper,
`handle()` in `lib/server/trust.ts`, so these apply to all of them and cannot
be forgotten on a new route.

| Guard | Where | What it does |
|---|---|---|
| Two Privy tokens, cross-checked | `lib/server/privy.ts` | the caller is who they say; the wallet address comes from the signed token, never the body |
| Origin check | `lib/server/guards.ts` | a request another site's page sent is refused with 403 |
| Per-IP throttle | `lib/server/guards.ts` | 10 requests a minute, then 429 |
| Per-DID rate limit | `lib/server/nonce.ts` | 30 of one action an hour, counted in the database |
| Body size limit | `lib/server/route-kit.ts` | over 64 KiB is refused with 413, before the JSON is parsed |
| Strict body validation | `lib/server/route-kit.ts` | every field is checked, nothing is coerced |
| Nonce ledger | `lib/server/nonce.ts` | one row per signature issued; reusing one is a 409 |

### Rate limiting: which of the two is the real one

**The per-DID limit is the control. The per-IP throttle is a courtesy.** That
distinction is not decoration:

- The per-IP counter is an in-memory `Map` inside one server process. On Vercel
  every serverless instance keeps **its own**, so requests spread across
  instances each get a fresh allowance. Anybody who knows it is there can walk
  around it.
- Many people share one address behind a phone network or a college wifi, so a
  per-IP count can throttle a group of friends using the app together — which
  is exactly the demo. Another reason it is not allowed to be the real control.
- The per-DID limit counts rows in `trust_nonces`, so it survives a restart and
  holds across every instance. An earlier in-memory limiter was found
  bypassable in the audit for the reasons above (H-5 in
  `docs/security-audit.md`), which is why that one was replaced rather than
  tuned.

**In production both become Redis** (or any shared store with atomic counters
and TTLs): one `INCR` with an expiry per key, keyed by DID and by IP, read by
every instance. The in-memory Map is a prototype stand-in and is labelled as
one in the code.

## Step 6 — publish it  ⟵ **needs you**

```bash
cd apps/pot
npx vercel         # first run links the project and asks a few questions
npx vercel --prod
```

Then add the same `NEXT_PUBLIC_*` values in the Vercel project's
**Environment Variables** and redeploy, otherwise the published site shows the
setup card. `npx vercel env add NEXT_PUBLIC_PRIVY_APP_ID production` does it
from the terminal.

One thing to set in Privy afterwards: add your Vercel URL to the app's allowed
domains, or Google sign-in will refuse to open on the published site.

## Step 7 — test it with real people

`docs/user-testing.md` is the script to run a session with; record what
actually happened in `docs/feedback-log.md`.

## For judges

- **Live app:** _add the Vercel URL here after step 6_
- **Sign in** with any Google account. An account is made for you in the
  background; there is nothing to install and no fees to pay.
- **Tap "Get ₹5,000 test money"**, then create a pot.
- To see the approval rule, set the limit to ₹500 and then try to repay someone
  ₹1,000 — it will wait for a second person. Open the invite link in a second
  browser profile with a different Google account to play that second person.
- To see the refund path, create a pot with a target nobody fills and a
  deadline a few minutes out. Once it passes, the pot shows "Didn't fill up"
  and each person can take their own money back.
- **Contracts:** addresses in the table below, viewable on
  <https://testnet.monadexplorer.com>.

## Deployed addresses

Monad Testnet (chain id 10143), deployed at block **69937293**. Every contract
is source-verified on Sourcify — each one returned `exact_match`, checked
against the API rather than trusted from the CLI's exit code.

| Contract | Address | Explorer |
|---|---|---|
| TestRupee | `0xCc29aA71B0f98c90AF219c2CdC9cBAd68B86BdaA` | [view](https://testnet.monadexplorer.com/address/0xCc29aA71B0f98c90AF219c2CdC9cBAd68B86BdaA) |
| PotManager | `0x2818b52178840Ef546fc728c12daec39Be235968` | [view](https://testnet.monadexplorer.com/address/0x2818b52178840Ef546fc728c12daec39Be235968) |
| SocialPay | `0x4f407850A04286c6D2362C311E70586cc73e1133` | [view](https://testnet.monadexplorer.com/address/0x4f407850A04286c6D2362C311E70586cc73e1133) |
| Gift | `0xeB89662b92C881ADeF9F5c410f357Fc1dc3b0d5d` | [view](https://testnet.monadexplorer.com/address/0xeB89662b92C881ADeF9F5c410f357Fc1dc3b0d5d) |
| BehaviourSavings | `0x008A65Aa1dE78Fe2551427f17e63D2881AF29930` | [view](https://testnet.monadexplorer.com/address/0x008A65Aa1dE78Fe2551427f17e63D2881AF29930) |
| AccountabilityPool | `0x14cD8532b4aA4eF5E583CEb82db7Ec29e5517994` | [view](https://testnet.monadexplorer.com/address/0x14cD8532b4aA4eF5E583CEb82db7Ec29e5517994) |
| SalaryStream | `0x208fdB568CF949Fb7Fdc02d74Ed9811249e73974` | [view](https://testnet.monadexplorer.com/address/0x208fdB568CF949Fb7Fdc02d74Ed9811249e73974) |
| IncomeShare | `0x80340B46Ab439C722E0C990F532f94C90A7cF2eF` | [view](https://testnet.monadexplorer.com/address/0x80340B46Ab439C722E0C990F532f94C90A7cF2eF) |
| MicroCover | `0x380491FfD851602100aDBBf855ff403623db5816` | [view](https://testnet.monadexplorer.com/address/0x380491FfD851602100aDBBf855ff403623db5816) |

### Who holds which role, and why it matters

Four of these contracts bake an address into an `immutable` at deployment. The
split below keeps the server's signing key able to *authorise* things while
owning nothing and holding no money — which is the claim `docs/trust-layer.md`
makes, so it has to be true on chain and not just in prose.

| Role | Held by | Why |
|---|---|---|
| `TRUST_SIGNER` (PotManager) | `0xbe4A…1D94` | admits a joiner once the server has checked their invite code |
| `POOL_ATTESTER` (AccountabilityPool) | `0xbe4A…1D94` | signs a day as kept |
| `RECORDER` (IncomeShare) | `0xbe4A…1D94` | the server itself sends `recordRepayment` |
| `INSURER_SIGNER` (MicroCover) | `0xbe4A…1D94` | signs a claim settlement |
| `ARBITRATOR` (SocialPay) | deployer | a human resolves disputes |
| `SAVINGS_ADMIN` (BehaviourSavings) | deployer | a human approves behaviour verifiers |
| `INSURER` (MicroCover) | deployer | holds the tINR reserve; a human binds policies |

The deploy script printed a loud warning for the three deployer-held roles,
which is correct: on a testnet they are placeholders for parties that do not
exist, and on any other chain the script refuses to run unless each one is
named explicitly and none of them is the deployer.

**BehaviourSavings has no approved verifier yet.** `SaveConsistently` goals
work immediately; `ExternalSignal` goals cannot be created until the savings
admin calls `registerVerifier` then `setBehaviourVerifier`, pointing at
`0xbe4A…1D94`.

## Honesty

There are no user numbers, adoption figures or performance claims in this
README, because no one outside the build has used it yet. Test Rupee is play
money. The contracts are unaudited. `docs/feedback-log.md` is empty on purpose
and will only ever hold results from sessions that actually happened.

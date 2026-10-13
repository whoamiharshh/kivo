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
| Contracts written | ✅ Pot itself: `TestRupee.sol`, `PotManager.sol`. Seven more for the other tracks: `SocialPay.sol`, `Gift.sol`, `BehaviourSavings.sol`, `SalaryStream.sol`, `IncomeShare.sol`, `MicroCover.sol`, `AccountabilityPool.sol` |
| Contracts compile | ✅ Solc 0.8.24, OpenZeppelin v5.7.0 |
| Tests | ✅ **408 contract tests passed, 0 failed** and **127 app tests passed**, re-run on 2026-10-13. Typecheck and lint are clean and the production build passes — including from a clean checkout with no environment set. |
| App state | ⚠️ Every screen is built. Pots, Pay, Gifts, Savings, Pools and Streams run end to end in code. **Agreements** (record, view, close out) and **Cover** (hold a premium, take it back) work; recording an Agreement repayment, binding a Cover policy and deciding a claim are **labelled unavailable** — they need a licensed partner's key, and nothing pretends otherwise. Authenticated browser journeys have **not yet been verified end to end**. |
| Deployed to Monad Testnet | ✅ A **fresh deployment of all nine contracts is live** and source-verified (Sourcify `exact_match`); roles read back from the chain. Addresses below. The earlier deployment is retired. |
| App deployed to Vercel | ❌ not yet — see `docs/launch-checklist.md` |
| User testing with real people | ❌ not done yet — script and questionnaire are ready (`docs/five-phone-test.md`) |

Note on the test count: the original brief mentioned 20 tests for Pot. Pot's
rules grew (a target, a deadline, refunds on failure, a cumulative spending
budget) and its suite grew with them to 91, plus 2 dedicated security tests.
No rule was weakened to make a test pass. The remaining 315 tests cover the six
contracts written for the other tracks and the trust layer's digests, which are
listed in the table above and in `docs/limitations.md`.

Both test counts above were produced by running the suites on 2026-10-13, not
carried over from earlier notes. No contract source or deployed state changed
in that run.

## Implemented contract behavior

The following rules are implemented in the contracts and have contract-test
coverage. The live user journey has not been exercised end to end:

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
- **Pot event indexing** now has local source for finalized logs, real block
  timestamps, transaction hashes, pagination, deduplication, and separate
  deposits. Its Supabase migration has not been applied, its worker has not run,
  and no deployed app serves the indexed feed; treat this as implemented code,
  not a working deployed feature.

## What is deliberately not built

Scheduled or automatic pulls, recurring rent, landlord and utility payouts,
penalties, moving money between members, real-money top-up, mainnet, and any
personal data onchain. Only hashes of names and memo text ever reach the chain.

## What is not finished — future work

Said plainly, so nothing here reads as a promise:

- **A licensed partner.** Cover needs an insurer to take on risk and decide
  claims; Agreements needs a lending partner to record repayments. None exists
  here, so those two actions are unavailable and labelled so. Real money in India
  would also need professional legal, tax and licensing advice (see
  `docs/limitations.md`) — nothing here claims compliance.
- **Finding your pots at scale.** Home scans the 200 newest pots on-chain. A
  production version needs an indexer or a per-member list in the contract.
  See `docs/pot-discovery.md`.
- **Activity history.** The feed is rebuilt from contract state, so it has no
  timestamps and shows one total per contributor. An indexer would restore both.
- **Dual deployment.** Moving to new contracts is a clean cutover; running old and
  new side by side (and carrying names across) is not built.
- **Evidence for claims.** Cover claims record only a typed description — there is
  no file upload.
- **Monitoring, load testing, analytics, a staging environment.** None exist.
- **Real users.** No one outside the build has used it yet; the questionnaire and
  test script are ready, and `docs/feedback-log.md` records only real sessions.

## Structure

A pnpm workspace. `pnpm-workspace.yaml` takes in `apps/*` and `packages/*`.

- `packages/contracts/` — Solidity (Foundry): `TestRupee.sol`, `PotManager.sol`,
  `SocialPay.sol`, `Gift.sol`, `BehaviourSavings.sol`,
  `SalaryStream.sol`, `IncomeShare.sol`, `MicroCover.sol`,
  `AccountabilityPool.sol`, **408 tests** across eleven suites, deploy script
- `apps/pot/` — Next.js 16 app (Privy + wagmi/viem + Tailwind + shadcn/ui on Base UI)
- `apps/trust/` — Expo Router app for iOS, Android and web. **Not built yet.**
- `packages/verification/` — the native trust layer. **Not built yet.**
- `packages/shared-ui/` — design tokens shared by both apps. **Not built yet.**
- `supabase/schema.sql` — offchain store for names and memo text
- `supabase/migrations/` — versioned trust-layer and local Pot activity-index
  migrations. The new activity migration is not applied to Supabase.
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

The last recorded Foundry run reported `408 tests passed, 0 failed` across eleven
suites. Foundry was unavailable during the 2026-10-12 continuation, so rerun
this command after installing Foundry in your environment before relying on
that result.

## Step 2 — put the contracts on Monad Testnet  ✅ **done**

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

## Step 3 — Privy, so people can sign in with Google  ⟵ **two dashboard toggles left**

Privy handles the Google sign-in, quietly makes an account for each person, and
pays the network fees for them so the app never mentions fees at all.

The three values are already in `apps/pot/.env.local`: `NEXT_PUBLIC_PRIVY_APP_ID`,
`PRIVY_APP_SECRET`, and `PRIVY_VERIFICATION_KEY` (the app's **public** key, read
from Privy's own API — it is not a secret and is safe in the file).

What still needs a human in <https://dashboard.privy.io>:

1. **Login methods** → turn on **Google**, turn everything else off.
2. **User management → Authentication → Advanced** → turn on
   **"Return user data in an identity token"**. This one is not optional and it
   is easy to miss. The API verifies two tokens, and the person's account is
   read from the identity token; without it every call to the trust layer
   answers `401 missing_identity_token`, which in practice means **nobody can
   join a pot**. See `apps/pot/lib/server/privy.ts`.
3. **Fee sponsorship** → enable it and cover **Monad Testnet**. Privy has been
   subsidising Monad Testnet usage; if the chain is not offered on your plan,
   email `monad@privy.io`. Without this step, actions will fail with a
   "fees aren't being covered" message.

> **Rotate the Supabase service key and the Privy app secret before this is
> public.** Both were pasted into a chat transcript during development, so they
> must be treated as known. Rotating them is a dashboard action in each
> service, then update `apps/pot/.env.local` and the Vercel environment.

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

Open <http://localhost:3000>. In development, missing public integration values
are reported and affected screens remain gated; production validates required
public configuration at startup. `TRUST_SIGNER_KEY` is optional while
`TRUST_SIGNER_ENABLED=false` (the default). Server signing must remain disabled
until an approved replacement signer is deployed and verified. The known
compromised legacy signer address is refused by the server guard regardless of
that flag. This source change does not revoke any deployed contract role.

To check it builds the way it will in production:

```bash
pnpm build
```

To run the tests:

```bash
pnpm test        # app: 76 tests in the current source tree
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

Monad Testnet (chain id 10143), deployed at block **70499937** on 2026-10-13. Every
contract is source-verified on Sourcify — each returned `exact_match` for both
creation and runtime code, checked through the Sourcify API rather than trusted
from the CLI's exit code. All seven role addresses below were read back from the
chain after deployment.

| Contract | Address | Explorer |
|---|---|---|
| TestRupee | `0xD5ce29B7a36C721ba686032B627c9bF5B30981c0` | [view](https://testnet.monadexplorer.com/address/0xD5ce29B7a36C721ba686032B627c9bF5B30981c0) |
| PotManager | `0x26C9BC9DE890e78a125657f921a14Fa62d44De65` | [view](https://testnet.monadexplorer.com/address/0x26C9BC9DE890e78a125657f921a14Fa62d44De65) |
| SocialPay | `0xB6588749C62d1F533017E844A1F497FE20eB62fB` | [view](https://testnet.monadexplorer.com/address/0xB6588749C62d1F533017E844A1F497FE20eB62fB) |
| Gift | `0xD0Abf14302A68E48E9A553c0cCDEE399C50Fb4d7` | [view](https://testnet.monadexplorer.com/address/0xD0Abf14302A68E48E9A553c0cCDEE399C50Fb4d7) |
| BehaviourSavings | `0xb19bc9eb11188611fe0DB519C3edD8909fc722cd` | [view](https://testnet.monadexplorer.com/address/0xb19bc9eb11188611fe0DB519C3edD8909fc722cd) |
| AccountabilityPool | `0x0E6400a5D4766Cc71D71Aa5690C4C8DE76DF2F11` | [view](https://testnet.monadexplorer.com/address/0x0E6400a5D4766Cc71D71Aa5690C4C8DE76DF2F11) |
| SalaryStream | `0xEAcBd5B5808B79A835B7C6d020f7672B8017E9dC` | [view](https://testnet.monadexplorer.com/address/0xEAcBd5B5808B79A835B7C6d020f7672B8017E9dC) |
| IncomeShare | `0x2a61d3c3D4Ea54a3533b1CD586DAC6FEe0129783` | [view](https://testnet.monadexplorer.com/address/0x2a61d3c3D4Ea54a3533b1CD586DAC6FEe0129783) |
| MicroCover | `0x329Ae1ea1C05274eC4284CEb361b6CeD9b6821F2` | [view](https://testnet.monadexplorer.com/address/0x329Ae1ea1C05274eC4284CEb361b6CeD9b6821F2) |

> **Replaced deployment.** An earlier deployment (block 69937293) is retired: the
> keys behind its immutable roles were exposed, so the app no longer uses it and it
> should not be trusted with anything. Its addresses are not listed here. One pot
> on it still holds ₹2,000 of test money, which its contributor can reclaim after
> its deadline without any key.

### Who holds which role, and why it matters

Four of these contracts bake an address into an `immutable` at deployment. The
server-held signing key was given only the two roles the app needs, so that if
it ever leaks again it can admit joiners and attest pools — and nothing else.

| Role | Held by | Why |
|---|---|---|
| `TRUST_SIGNER` (PotManager) | server signer `0x5aC6…a342` | admits a joiner once the server has checked their invite code |
| `POOL_ATTESTER` (AccountabilityPool) | server signer `0x5aC6…a342` | signs a day as kept |
| `RECORDER` (IncomeShare) | offline deployer `0x74e0…93c2` | a lending partner would record repayments |
| `INSURER_SIGNER` (MicroCover) | offline deployer | a licensed insurer would settle claims |
| `INSURER` (MicroCover) | offline deployer | holds the test-money reserve; a human binds policies |
| `ARBITRATOR` (SocialPay) | offline deployer | a human resolves disputes |
| `SAVINGS_ADMIN` (BehaviourSavings) | offline deployer | a human approves behaviour verifiers |

The five deployer-held roles are **placeholders** for parties that do not exist
on a testnet, and the deploy script said so loudly. No server code can authorise
a Cover payout or record an Agreement repayment, which is why those actions are
labelled unavailable in the app instead of faked.

**BehaviourSavings has no approved verifier yet.** `SaveConsistently` goals work
immediately; `ExternalSignal` goals cannot be created until the savings admin
calls `registerVerifier` then `setBehaviourVerifier`.

## Honesty

There are no user numbers, adoption figures or performance claims in this
README, because no one outside the build has used it yet. Test Rupee is play
money. The contracts are unaudited. `docs/feedback-log.md` is empty on purpose
and will only ever hold results from sessions that actually happened.

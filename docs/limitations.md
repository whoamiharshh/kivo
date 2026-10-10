# Limitations

What this codebase does not do, cannot do, or does not do yet. Kept in one
place so no screen, pitch or README has to carry a claim the code cannot back.

Last updated: **2026-10-10**.

---

## Device integrity and goal verification

**Goal verification is self-reported in v1.**

Nothing in this repository verifies a step count, a screen-time figure, or any
other device signal. There is no attestation module. `packages/verification/`
is named in the plan and does not exist yet.

**Device-attested verification (Play Integrity, App Attest, Health Connect,
CMPedometer) is a next-release dependency requiring a native mobile build.**
None of those APIs is reachable from a web page:

| API | Platform | Why the web cannot reach it |
|---|---|---|
| Play Integrity | Android | Native, via Google Play Services |
| App Attest | iOS | `DeviceCheck` framework; no browser equivalent |
| Health Connect (`StepsRecord`, `DataOrigin`) | Android | SDK reading an on-device provider |
| `CMPedometer` | iOS | CoreMotion, hardware-sourced |
| `DeviceActivity` / `FamilyControls` | iOS | Needs an Apple entitlement, applied for separately |

WebAuthn exists in the browser and is used here for passkeys, but it attests
**a credential**, not device integrity and not a sensor reading.

**Do not claim device integrity until the native module is built.** Until then:

- No screen may show "Verified on your device" or similar.
- Screen-time goals stay behind a feature flag, marked "iOS: coming soon"
  until the Family Controls entitlement is approved.
- The web target of any app must say that verification needs the mobile app,
  and must not offer a self-report path dressed up as verification.

When the native module does land, it must fail closed: no attestation means no
verification, with no silent fallback to self-reporting.

---

## What the contract cannot verify

`Gift.sol` enforces the rules of a conditional gift. It does not verify
reality. Specifically, it cannot know:

- **Whether a graduation actually happened.** Only that the named attester
  signed a message saying so.
- **Whether a project milestone is meaningful.** Only that whoever holds the
  attester key — a backend watching an API, say — signed for it. A GitHub
  release tag can be pushed by anyone with write access, including to an empty
  repository.
- **Whether the sender's intent was genuine.** A condition can be written to be
  impossible, or humiliating, or absurd. The contract will hold the money
  exactly as instructed.

The contract's honest guarantees are narrower, and they are real: the condition
is fixed at creation and cannot be rewritten (`conditionHash` is immutable);
only the recipient can ever be paid, except on a cancellation that is impossible
once the condition is met; an irrevocable gift can never be cancelled; and a
signature cannot be replayed onto another gift, deployment or chain.

### Condition types, their sources and their fallbacks

| Condition | Verification source | Trust assumption | Fallback if the source fails |
|---|---|---|---|
| **Time** | The chain's own `block.timestamp` | None beyond the chain itself. Validators can nudge a timestamp by seconds, which cannot matter to a date months away. | Not applicable — a date always arrives. |
| **Event: graduation** | A university registrar API where one exists; otherwise a signed attestation from the institution | That the registrar's data is correct and the signing key is held by the institution. Few Indian universities expose such an API, so in practice this degrades to an attestation. | The recipient's timeout release after `TIMEOUT_PERIOD` (2 years). |
| **Event: project milestone** | A GitHub release tag, a signed commit, or a delivery confirmation | That the backend holding the attester key read the API correctly, and that the tag means what the parties intended. It proves a tag exists, not that work was done. | Timeout release. |
| **Event: company exit** | A funding-announcement API (Crunchbase, Tracxn) or a signed attestation from the company | That the announcement is accurate and timely. These sources lag, and private rounds often never appear. | Timeout release. |
| **Attestation: anything else** | A person the sender names at creation | **The attester can lie.** They can also lose their key, refuse, or die. | Timeout release — the only protection that does not depend on anyone's goodwill. |

None of the APIs in that table is integrated. Every non-time condition
currently resolves through a signature from the named attester address, which is
why the attester's identity is the whole trust model and why the timeout exists.

In production the attester should be a decentralised attestation network —
EAS, Reclaim Protocol — rather than one address.

---

## Where the money comes from

`BehaviourSavings.sol` is **Model A: redistribution**, and the honest sentence
is the one your spec asked for:

> **From savers who did not meet their goal.**

Nothing else funds the bonus. There is no sponsor, no fund, no venture subsidy
and no interest anywhere in the system. Three consequences the UI must carry
rather than hide:

- **If everyone succeeds, nobody gets a bonus.** Nothing was forfeited, so
  there is nothing to share. The results screen has to say that plainly instead
  of implying a return failed to arrive.
- **If nobody succeeds, the stakes go home.** There is no one to redistribute
  to, and the contract will not keep money it has no rule for.
- **Your gain is someone else's loss.** Not a market's, not a sponsor's —
  another saver in your cohort missed their goal. Anyone uncomfortable with
  that should not be nudged past it.

### Why it is not called yield

It is not yield. There is no yield source. The word used in code, copy and
these docs is **bonus**. `Gift.sol` and `SocialPay.sol` use **payout**. The
word "interest" appears nowhere, because none is earned.

### What is actually at risk

**Principal is always returned in full, success or failure.** This is a tested
invariant, not an intention:

- `test_PrincipalComesBackEvenWhenTheGoalIsMissed` — a saver who misses the
  cadence still gets every paisa of savings back at `finalise`, before any
  redistribution is computed.
- `testFuzz_NobodyEverLosesPrincipal` — across random targets and outcomes, no
  saver ends below their starting balance minus the stake, and the contract
  ends holding nothing.

The only money at risk is a separate commitment stake, fixed at **10% of the
target** (`STAKE_BPS = 1000`) and taken when the goal is created. A savings
product that can hand back less principal than was deposited is not a savings
product, whatever it redistributes.

### Two constants the spec did not provide

`createSavingsGoal`'s signature carries no stake and no cadence, so both are
documented constants rather than per-call magic numbers: the stake is 10% of
target, and "saving consistently" means reaching the target across at least
`MIN_DEPOSITS = 4` separate deposits. Changing either changes the product, so
they are named constants, not literals buried in a function.

### Cohorts, and why redistribution is bounded by date

Goals sharing an identical deadline form a cohort, and a forfeited stake can
only reach someone who committed to the same date
(`test_CohortsDoNotLeakIntoEachOther`). Settling takes two steps — `finalise`
then `claimOutcome` — because a pro-rata share cannot be computed until every
goal in the cohort is finalised, and paying an unbounded number of savers in
one transaction is exactly the loop this codebase forbids.

### Behaviour verification, and the part that is not built

v1's behaviour is **`SaveConsistently`**, which needs no trusted party at all:
the deposit history is already in contract storage. That is the only behaviour
type that is honestly verifiable here today.

`ExternalSignal` exists because Part 4's `submitBehaviour` requires it. The
signature check is real and replay-bound to contract, chain and goal
(`test_RevertWhen_SignalReplayedOnAnotherGoal`), but **the contract cannot know
whether the signal was true** — only that the named verifier signed it. There
is no attested signal source in this repository, so it must not be used to
claim device integrity. A `SaveConsistently` goal rejects signatures outright,
so no trusted party can be introduced where none is needed.

### Social-graph verification: not built

Part 2.2's friends-confirm-the-behaviour model is **not implemented**, and the
trade-offs are why it was not chosen for v1:

- **Collusion is the default, not the exception.** Friends asked to confirm a
  friend's behaviour, with that friend's money at stake, have every incentive
  to confirm and none to refuse. A social graph is the wrong instrument for
  adversarial verification.
- **Privacy pulls the other way.** Hiding raw health or financial data from the
  confirmers is correct, but a confirmer shown only a yes/no has nothing to
  confirm *from* — they are rubber-stamping.
- **Changing verifiers when a relationship breaks down** is necessary and
  abusable: whoever can swap verifiers can swap in a compliant one.

`Gift.sol`'s named attester is the nearest thing in the codebase, and its
honest protection is not the attester's goodwill — it is the recipient's
unilateral timeout release.

---

## Salary streaming

### Why the audited library was not imported

PROMPT 06 says to use the Sablier or Superfluid pattern and import the audited
library. Checked on 2026-10-10, neither is usable on the target chain:

| Library | Evidence | Monad Testnet (chainId 10143) |
|---|---|---|
| Superfluid | Its own `superfluid-finance/metadata` npm package: `networks.json` names 16 chains — `43113, 11155111, 11155420, 84532, 5042002, 100, 137, 10, 42161, 43114, 56, 1, 42220, 8453, 534352, 5042` | **Absent.** No 10143, no "monad" string in the file |
| Sablier Lockup v4.0 | Its deployments page: 25 mainnets, 5 testnets (Arbitrum Sepolia, Base Sepolia, BattleChain, OP Sepolia, Sepolia) | **Monad mainnet yes, Monad Testnet no** |

This project is testnet-only, so neither is reachable. Separately, the required
interface does not fit either library: a Sablier Lockup stream is created with a
*total amount*, a cliff and a duration — not a rate per second — and has no
pause and no top-up once it exists. `createStream(employee, ratePerSecond,
startTime, endTime)`, `pauseStream` and `topUp` would need a wrapper doing its
own rate accounting either way.

What remains of "streaming math" in `SalaryStream.sol` is one multiplication,
`ratePerSecond × secondsElapsed`, with no division anywhere in the accrual
path — so there is no rounding and no dust, proven by
`testFuzz_AccrualIsExactForAnyRate` across random rates and durations.

### Employees cannot accrue what is not funded

The brief leaves solvency to an off-chain monitor that pauses the stream below
seven days of runway. A monitor can be late or down, so the contract makes it
structural instead: **accrual is capped at the funded balance.** Every paisa the
contract says an employee is owed is a paisa it is holding
(`test_AccrualNeverExceedsWhatWasFunded`). A top-up cannot back-pay a stretch
the stream was dry for (`test_ToppingUpExtendsTheRunwayWithoutBackPaying`).

The seven-day rule still exists, as a *permissionless* pause: once runway is
under `LOW_RUNWAY`, anyone may stop the clock, because an employee being shown a
rising figure their employer has not funded should not have to wait on the
employer noticing.

Paused time is never paid for, in either direction. Cancelling never takes back
earned salary — only the unaccrued remainder returns to the employer.

### What this does not replace

- **Streaming salary needs the employer to adopt it.** An employee cannot opt in
  alone, and nothing here changes that. The whole product is gated on an
  employer funding escrow.
- **It is not payroll.** No tax withholding, no TDS, no PF or ESI, no Form 16,
  no statutory benefits, no payslips. An employer using this still owes every
  one of those obligations through their actual payroll system.
- **Idle-balance yield is not implemented**, and must not be promised. Money
  sitting in the escrow earns nothing. Paying a return on it would need a
  licensed fund manager and a real fund; anything else is a subsidy dressed up
  as interest. The word "yield" appears nowhere in the contract or the copy.

### Employer verification is built, but its data sources are not

The schema, state machine, RLS and audit trail for employer onboarding exist and
are verified against the live database: an employer sees only their own checks,
an employee sees only their own row and their own rate (not a colleague's), a
rival employer sees neither, and an employer cannot mark itself verified from
the browser — the attempt changes zero rows.

What is **not** built is the part that talks to the outside world:

- **GST / CIN lookup** needs a GSTN or MCA API credential, which this project
  does not have. The `registry` check exists as a row with a result and an
  evidence hash; nothing populates it automatically.
- **Penny-drop** needs a payment provider (Razorpay, Cashfree). Same position:
  the check row exists, the verification does not run. By design no raw bank
  details are stored — only a hash of account-plus-IFSC and the last four
  digits, so the table stays useless to anyone who steals it.
- **Escrow runway** is the one check that could be computed today, from the
  contract's own funded balance.

Until those are wired, `employers.status` is set by a human operator, and the
honest reading of "verified" is "an operator said so".

---

## Income share agreements

### What requires a licensed partner

**The smart contract is not the product. The signed legal agreement is.**
`IncomeShare.sol` holds no token, has no balance and contains no `transfer`.
It keeps an account neither side can quietly edit; it does not lend, collect or
settle anything.

Nothing in this repository can be offered to a real person until all of the
following exist, and none of them is something code can supply:

- **An RBI-registered NBFC or licensed lending partner as the counterparty.**
  They hold the legal obligation. The contract's `recorder` address is a
  stand-in for their signer and currently defaults to whoever deploys it.
- **Compliance with RBI's digital lending guidelines.** Lender disclosure, the
  Key Fact Statement, cooling-off period, grievance redressal, and the rules on
  what a lending service provider may and may not do. None of that is
  implemented, and most of it is not implementable in a contract.
- **Tax treatment confirmed by a qualified CA.** Whether a repayment is
  interest, a capital receipt or business income changes what both parties owe,
  and changes TDS obligations. This repository takes no position and should not
  be read as implying one.
- **An agreement enforceable in an Indian court.** Which means a real document,
  really signed, with a dispute-resolution clause a court will honour — and it
  must survive the blockchain layer failing entirely. If the chain is gone, the
  agreement still binds; the reverse is not true.

**If the contract and the signed agreement ever disagree, the agreement
governs.** The on-chain `agreementHash` identifies which document was signed so
a later edit to the PDF is detectable. It does not make the on-chain copy
authoritative.

### What is not yet built

- **No real money movement.** Not in the contract, not in the app. Funding and
  repayment would both happen on the counterparty's rails.
- **No signed legal agreements with an NBFC.** No counterparty has been
  approached. There is no lending partner.
- **No Account Aggregator integration.** The consent *schema* is built and
  verified — purpose, data types, validity window, frequency, revocation — but
  no licensed AA (Setu, Finvu) is connected, because that needs a commercial
  relationship and credentials this project does not have. Nothing pulls
  anybody's bank data today.
- **No bank-statement analytics.** Perfios or equivalent would parse salary
  credits, UPI inflows and GST-linked income into a monthly figure. That
  parsing does not exist; `income_assessments.verified_income_paise` is written
  by hand in testing.
- **No tax integration.** No TDS computation, no Form 16A, no reporting.
- **No dispute resolution with a real arbitrator.** A dispute freezes
  repayments and is meant to escalate to the counterparty. There is no
  counterparty to escalate to.
- **No frontend.** Deliberately. Building a browse-and-fund screen would imply
  a live product, which this is not.

**This is a testnet prototype of the technical layer. It is not a shippable ISA
product and must not be presented as one.**

### What the recipient is actually protected by

Three rules are enforced by database triggers rather than application code,
because each protects a person and a route handler can be wrong. All three were
verified against the live database on 2026-10-10:

| Rule | Proof |
|---|---|
| A revoked consent cannot produce another income figure — this is how "honor revocation immediately" is kept | `ERROR 23514: consent_not_active: consent 1 is revoked` |
| No repayment may be recorded while a dispute is open — the brief's "do not auto-deduct", made impossible rather than discouraged | `ERROR 23514: dispute_open: 1 disputed repayment(s) must be resolved first` |
| Recorded repayments can never exceed the cap | `ERROR 23514: cap_exceeded: 400000 of 1000000 paise already repaid` |

And on-chain, a repayment cannot be recorded at all without the **recipient's
own signature** over that exact income figure and amount, bound to the
agreement and its position in the sequence so no confirmation can be replayed
onto another month. The brief asked for a server-signed call whose signature
confirms the recipient agreed; a server's own signature cannot evidence that,
so the contract checks the recipient's and restricts the *caller* to the
counterparty. Both parties are accounted for and neither can act alone.

### On storing bank data

There is **no table for raw bank transactions** anywhere in this schema, and
that absence is deliberate: the AA framework makes consent purpose-bound and
revocable, and the brief says to keep the computed result rather than the
statement. Only `verified_income_paise` and the method used to derive it are
stored, so there is nowhere for statement data to be put even by mistake.

The funder sees the computed income figure — their repayment depends on it —
but **not the consent record**: verified, a funder reads 0 consent rows while
reading the agreement, the assessment and the repayment.

---

## Micro-insurance

`MicroCover.sol` is a premium and payout rail. **It is not insurance and this
application is not an insurer.** The risk-bearing entity is a licensed insurer,
and everything below is about where that boundary actually falls.

### How exposure is measured, and what each measure cannot stop

Every product has to answer one question before a premium is worth taking: what
is being covered, and how do we know. The `exposure_basis` enum in
`supabase/migrations/20261010_micro_insurance_trust_layer.sql` names the three
answers this layer supports. None of them is fraud-proof, and none is described
as such anywhere in this repo.

**Laptop cover, three hours — `declaration_plus_device`.** A signed declaration
from the user ("this is my laptop, cover it for the next three hours") plus a
device attestation that the app is running on a genuine, unmodified device.

- *What this catches.* Repudiation. The declaration is hashed and signed, so the
  user cannot later claim they never asked for cover on that device, and the
  text cannot be edited after the fact without the hash changing. Attestation
  catches a tampered app build or an emulator farm making bulk policies.
- *What it cannot catch.* **Device attestation says the phone is genuine. It
  says nothing about the laptop.** Play Integrity and App Attest attest the
  mobile device the app runs on, not a second piece of hardware sitting next to
  it. Somebody can honestly attest their phone and insure a laptop that is not
  theirs, is already broken, or does not exist. There is no serial number check,
  because there is no trustworthy way to read one; a photographed sticker is
  just a photograph. A rooted or unsupported device returns `unavailable`, which
  the schema records honestly rather than treating as a pass.

**Journey cover — `gps_trace`.** A GPS trace from the phone, with the platform
attestation alongside it.

- *What this catches.* Casual back-dating. The trace arrives with a hash and a
  `collected_at`, so a journey cannot be invented after the event and presented
  as contemporaneous without the timestamps disagreeing.
- *What it cannot catch.* **Mock locations.** Android's developer options can
  feed a fabricated location to any app, and attestation does not stop it — the
  device really is genuine, it is merely lying about where it is. Play Integrity
  can report that developer options are on, which is a signal and not a proof.
  A fabricated trace that is internally plausible (speeds, road geometry) is not
  detectable here at all. Treating a GPS trace as evidence of a journey is a
  commercial decision for the insurer's underwriters, not a technical guarantee
  from this code.

**Equipment cover — `photo_provenance`.** A photo carrying C2PA provenance, or a
signed attestation from the equipment's own management software.

- *What this catches.* Re-use and editing of images. C2PA binds a capture to a
  device and a time with a cryptographic manifest, so a stock photo or an edited
  one fails verification, and `c2pa_verified = false` is stored rather than
  hidden.
- *What it cannot catch.* **A genuine photo of the wrong thing.** C2PA proves an
  image was captured by a particular device at a particular time; it says
  nothing about whether the equipment in frame belongs to the claimant, or
  whether the damage shown is the damage claimed. Provenance is also uneven:
  most phones do not emit C2PA at all, so `null` is the common case and the
  insurer has to decide what to do with its absence. A signed attestation from
  management software is only as good as that vendor's key custody.

A thing worth saying plainly across all three: **the person declaring the
exposure is the person who benefits from the claim.** These measures raise the
cost of fraud and create an attributable record. They do not remove fraud, and
underwriting has to be priced on the assumption that some of it gets through.

### Claim verification, and what the chain does not see

A claim needs three things, and only the first is genuinely hard:

1. **That the event happened.** A photo, a police report, a repair invoice, or a
   signed attestation from a licensed assessor. Stored in Supabase Storage;
   `claim_evidence` holds the path, the SHA-256, the byte size, the MIME type,
   `captured_at` and `uploaded_at`. The bytes are never on-chain and never in a
   database column.
2. **That the policy was active at the time of the event.** Answered from
   `policies.starts_at` / `ends_at` against `claims.event_at`, and *enforced* by
   a database trigger rather than left to application code.
3. **That the claimant is the insured party.** Same trigger: a claim whose
   `claimant_did` is not the policy's `insured_did` is rejected by Postgres.

**What the contract sees is one hash.** `submitClaim` takes an `evidenceHash`
committing to the whole bundle, and that is the entire on-chain representation
of a claim. The contract cannot tell whether a photo shows a cracked screen, nor
when the event occurred — it has no access to `event_at` at all. Its only notion
of "this claim is good" is a signature from the insurer. That is a deliberate
division: adjudication is the insurer's licensed function, and pretending a
contract could do it would be the central dishonesty of a product like this.

Two guards exist because the obvious failure modes are expensive: a claim cannot
leave `submitted` with zero evidence rows behind it, and cannot be marked `paid`
without a signature-verified approval on record. Both were tested by trying to
violate them.

### What the contract does guarantee

Worth separating from what it cannot do, because the guarantees are real:

- **No payout without the insurer's signature**, over this contract, this chain,
  this policy, the claim's evidence hash and that exact amount. A signature for
  ₹10 cannot pay ₹10,000; a signature for one policy cannot settle another; a
  signature from the insurer's *treasury* address cannot stand in for its
  claims-signing key. Each of those is a test.
- **A premium cannot be earned until the risk is bound.** Premiums sit in escrow
  and become remittable only on `activatePolicy`. If the insurer never binds,
  the payer takes the premium back without needing the insurer's cooperation.
- **Cover is fully collateralised on-chain**, and committed reserve cannot be
  withdrawn while cover is live.

### Why cover is fully collateralised, and why that is not how insurance works

`activatePolicy` refuses to bind a policy unless the insurer's reserve already
holds the full coverage amount, uncommitted. A real insurer does not work this
way: it holds capital against a whole portfolio under IRDAI solvency rules,
because not every policy claims at once, and one-for-one collateral would make
most products uneconomic.

The contract cannot read a solvency margin, audit a balance sheet, or ask a
regulator anything. So the only promise it can actually keep is the one it can
hold in its own hands: the tokens are here. The result is a rail that is safe
for the buyer and capital-inefficient for the insurer. **This is a demo-scale
choice, not a model of insurance.** A production arrangement would replace it
with a partially funded reserve plus the insurer's audited solvency position,
which is a commercial and regulatory negotiation rather than a Solidity change.

### What requires an IRDAI-licensed insurer

None of the following can be done by this application, by a smart contract, or
by any amount of further engineering. Each requires a company holding a
certificate of registration from the Insurance Regulatory and Development
Authority of India.

- **Underwriting and risk-bearing.** Deciding who to cover, at what price, and
  carrying the loss when a claim lands. Accepting a premium in exchange for a
  promise to pay is the regulated act itself — not a payment-processing detail.
  `MicroCover` escrows and routes money; the promise behind it is the insurer's.
- **Product filing and approval.** Policy wording, pricing and terms go through
  IRDAI's product approval process. The `cover_products.sellable` flag cannot be
  set without an `irdai_filing_reference`, and a database constraint enforces
  it, precisely so an unfiled product cannot quietly be sold.
- **Claims adjudication.** Deciding whether a claim is payable, and for how
  much. This is why `settleClaim` requires the insurer's signature and has no
  override: there is no code path by which this application decides a claim.
- **Solvency and capital requirements.** Maintaining the required solvency
  margin and reporting it. A reserve balance in a contract is not a solvency
  margin and must not be presented as one.
- **Consumer grievance redressal.** A formal complaints process, and access to
  the Insurance Ombudsman. A rejected claimant's recourse is against the
  insurer, through that process. The schema deliberately lets a claimant read
  the rejection reason on their own claim, because they need it to complain —
  but the complaint goes to the insurer, not to this app.

### What the IRDAI sandbox allows

**First, a correction to the figures in the brief.** Three of the four specifics
it gives did not survive checking, and are not repeated as fact anywhere in this
repo:

| The brief says | What checking found |
|---|---|
| "IRDAI Regulatory Sandbox (2025 regulations)" | **Confirmed.** The IRDAI (Regulatory Sandbox) Regulations, 2025 were notified on 1 January 2025 and came into force on 3 January 2025, repealing the 2019 regulations. |
| "Application is via Form RG-1" | **Not found.** The 2025 regulations say an application is made electronically "in the specified form". No source found names a Form RG-1. |
| "a ₹10,000 processing fee" | **Not current.** The 2025 regulations say the application carries a non-refundable fee "as specified" and do not state an amount. ₹10,000 is the figure from the **2019** regime. |
| "up to 36 months of operating permission" | **Not from the 2025 regulations.** The 36-month figure comes from a 2022 amendment to the 2019 framework. The 2025 regulations do not fix a duration: permission runs for an experiment period the Authority specifies, with a single extension possible. |

What can be said with confidence: the sandbox exists, it is the route by which a
novel insurance product gets controlled permission to operate with temporary
regulatory relaxations, and operational detail — forms, fees, durations — is set
by IRDAI outside the regulation text and must be read from the current master
circular before anyone relies on it. Secondary summaries were the only sources
available here; **the regulation text and the master circular are what to
check**, and the numbers above should be re-verified before they reach a pitch
deck or an investor.

The part that matters for this repo is unchanged by any of it: **the sandbox is
a path to a live product, not a substitute for an insurer partner.** It relaxes
specified requirements for an approved experiment; it does not let a non-insurer
bear risk. There is no configuration of this codebase that launches without a
licensed insurer, and none should be built.

---

## The server is a trusted verifier

Wherever a backend signs something a contract relies on, a compromised backend
can forge it. That is true of any design where off-chain facts gate on-chain
money, and it is not hidden behind the word "oracle" here.

What reduces the damage in this codebase:

- The server verifies Privy access **and** identity tokens before acting, and
  takes the caller's address from Privy's signed record rather than the request
  body (`apps/pot/lib/server/privy.ts`).
- Send limits are enforced by a database trigger, so even a compromised server
  key cannot exceed them. Verified: an over-cap insert made with the service
  key is refused with `daily_send_limit_exceeded`.
- RLS restricts every client read to that user's own rows, and no client role
  can write at all. Verified against the live database.
- Every intent, refusal and auth rejection is written to an append-only audit
  table with a reason code.

What that does **not** fix: a server with the signing key can still authorise a
payout that should not happen. Replacing it with a decentralised oracle network
(Chainlink Functions, Reclaim) is the real fix, and it is not done.

---

## SocialPay's arbitrator is a placeholder

Dispute resolution is a genuine two-of-three between the sender, the recipient
and a platform arbitrator fixed at deployment. The arbitrator cannot decide
alone, and the two parties can settle without it — both proven by test.

But it is still one address chosen by whoever deploys the contract, and the
deploy script defaults it to the deployer. A deadlocked dispute stays frozen
until someone breaks the tie, with no time limit. A decentralised arbitration
layer (Kleros or equivalent) is the production answer.

---

## Pot's invite code becomes public

A pot's invite code is visible on-chain once anybody joins with it — it appears
in transaction calldata. The cap on members bounds the damage, and a pot is a
friend group rather than a public pool, but it is not a secret and the README
says so rather than implying otherwise.

---

## Test money only

`TestRupee` is a play token with two decimals and a faucet. There is no
real-money on-ramp, nothing here touches mainnet, and no deployment exists yet
on any network. The contracts are **unaudited**.

---

## Nothing has been used by a person

Every passing figure in this repository comes from a compiler, a test suite, a
build, or a database query run against the live schema. As of this date:

- **272 contract tests pass** (`forge test`) across eight suites. `IncomeShare.sol`,
  `SalaryStream.sol`, `BehaviourSavings.sol`, `Gift.sol`, `SocialPay.sol` and
  `PotManager.sol` are all at 100% line coverage.
- The trust layer's RLS and send limits are verified against the live Supabase
  project.
- **No screen has been rendered past the login gate**, because that needs a
  Privy app ID that does not exist yet.
- No user testing has happened. `docs/feedback-log.md` is empty on purpose.

There are no user numbers, adoption figures or performance claims anywhere in
this repository, because there is nothing to report.

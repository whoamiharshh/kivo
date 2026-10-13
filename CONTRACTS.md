# CONTRACTS — smart-contract reference

Part of the [PROJECT_DOSSIER](PROJECT_DOSSIER.md). Everything here was read from
`packages/contracts/src/*.sol`, `packages/contracts/script/Deploy.s.sol`, the
Foundry broadcast record, and read-only RPC calls made on 2026-10-12 (block
70,393,555). Where a claim comes from a project document instead of the source,
it says so.

Status vocabulary used across the dossier: **Verified** (checked against source
or a command run in this pass), **Implemented, unverified** (source exists, not
exercised), **Incomplete**, **Planned**, **Unknown**.

## 1. Toolchain and layout

| Item | Value | Evidence |
|---|---|---|
| Language / compiler | Solidity, `pragma ^0.8.24`, `solc_version = "0.8.24"`, optimizer on, 200 runs | `foundry.toml` |
| Libraries | OpenZeppelin Contracts v5.7.0, forge-std v1.17.0 | `foundry.lock` |
| Remappings | `@openzeppelin/contracts/` → `lib/openzeppelin-contracts/contracts/`, `forge-std/` → `lib/forge-std/src/` | `remappings.txt` |
| RPC alias | `monad_testnet = https://testnet-rpc.monad.xyz` | `foundry.toml` |
| Upgradeability | **None.** No proxies, no `Ownable`, no pause, no `selfdestruct`/`delegatecall` | source read; also `docs/security-audit.md` §8 |
| Token | One ERC-20 (`TestRupee`, 2 decimals, 1 unit = 1 paisa) shared by every money-holding contract | source |
| Foundry installed in this environment | **No** (`forge` unavailable on 2026-10-12) | `docs/production-readiness.md`; not rerun by this pass |

Directory: `packages/contracts/{src,test,script,lib,out,cache,broadcast}`.
`lib/`, `out/`, `cache/`, `broadcast/` are git-ignored build/vendor output.

## 2. Deployment (what is actually on chain)

Source of truth for addresses: `broadcast/Deploy.s.sol/10143/run-latest.json`
(commit field `6dfbf6e`, nine `CREATE` transactions, all receipts `status 0x1`,
blocks 69,937,293 … 69,937,338, deployer `0xD6A07f0aE71CE9a8f36f0d50Cd907aC652c0EDA7`).
Bytecode presence was re-checked on 2026-10-12 with `eth_getCode` through the
public RPC (chain id 10143 confirmed).

| Contract | Address | Runtime bytes | Constructor args (from broadcast) |
|---|---|---|---|
| TestRupee | `0xCc29aA71B0f98c90AF219c2CdC9cBAd68B86BdaA` | 2,086 | — |
| PotManager | `0x2818b52178840Ef546fc728c12daec39Be235968` | 10,393 | token, trustSigner `0xbe4AD8…1D94` |
| SocialPay | `0x4f407850A04286c6D2362C311E70586cc73e1133` | 5,796 | token, arbitrator `0xD6A07f…EDA7` |
| Gift | `0xeB89662b92C881ADeF9F5c410f357Fc1dc3b0d5d` | 6,093 | token |
| BehaviourSavings | `0x008A65Aa1dE78Fe2551427f17e63D2881AF29930` | 8,156 | token, admin `0xD6A07f…EDA7` |
| AccountabilityPool | `0x14cD8532b4aA4eF5E583CEb82db7Ec29e5517994` | 7,615 | token, attester `0xbe4AD8…1D94` |
| SalaryStream | `0x208fdB568CF949Fb7Fdc02d74Ed9811249e73974` | 5,614 | token |
| IncomeShare | `0x80340B46Ab439C722E0C990F532f94C90A7cF2eF` | 4,119 | recorder `0xbe4AD8…1D94` |
| MicroCover | `0x380491FfD851602100aDBBf855ff403623db5816` | 7,946 | token, insurer `0xD6A07f…EDA7`, insurerSigner `0xbe4AD8…1D94` |

Read-only role read-backs on 2026-10-12 matched the constructor arguments:
`PotManager.trustSigner`, `AccountabilityPool.attester`, `IncomeShare.recorder`,
`MicroCover.insurerSigner` and `BehaviourSavings.behaviourVerifier` all return
`0xbe4AD8Cc900e5824440526E7669a82881c661D94` (the **compromised trust signer
address**, see [SECURITY.md](SECURITY.md)); `SocialPay.arbitrator`,
`BehaviourSavings.admin` and `MicroCover.insurer` return the deployer
`0xD6A07f0aE71CE9a8f36f0d50Cd907aC652c0EDA7`.

On-chain usage at block 70,393,555 (counters, read-only):

| Counter | Value |
|---|---|
| `PotManager.potCount` | **5** |
| `SocialPay.paymentCount`, `Gift.giftCount`, `BehaviourSavings.goalCount`, `AccountabilityPool.poolCount`, `SalaryStream.streamCount`, `IncomeShare.agreementCount`, `MicroCover.policyCount` | all **0** |
| `MicroCover.reserve` | 0 |
| `TestRupee.totalSupply` | 1,000,000 units (= ₹10,000.00, i.e. two faucet claims have ever happened) |

So: only Pot has ever been used on chain; no other feature has been exercised on
the deployed contracts.

"Source-verified on Sourcify (`exact_match`)" is claimed in `README.md` and was
**not** re-checked in this pass (Unknown). `BehaviourSavings.behaviourVerifier`
being set (not zero) means ExternalSignal goals are enabled on the deployment;
the README's statement that no verifier is registered is outdated (Contradiction
C-3 in the dossier).

**Deployed vs. local source.** The broadcast record's `commit` is `6dfbf6e`; HEAD
is `602fc49`. The working tree has uncommitted app changes but no contract source
changes were reported in `docs/production-readiness.md`. This pass did not diff
the compiled artifacts against the deployed runtime code (Unknown). Anything that
would change a contract needs a redeployment — roles are immutable constructor
arguments.

## 3. Roles and immutability

| Role | Contract | Set by | Power | Can it be rotated? |
|---|---|---|---|---|
| `trustSigner` | PotManager | constructor | Signs `join` authorizations. Cannot spend/approve/close/refund. | No — redeploy |
| `arbitrator` | SocialPay | constructor | One of three dispute votes; cannot decide alone | No — redeploy |
| `admin` | BehaviourSavings | constructor | `registerVerifier`, `revokeVerifier`, `setBehaviourVerifier`; cannot touch tokens | No — redeploy |
| `attester` | AccountabilityPool | constructor | Signs per-member per-day attestations; can withhold to fail a member | No — redeploy |
| `recorder` | IncomeShare | constructor | Only caller of `recordRepayment` (still needs the recipient's signature) | No — redeploy |
| `insurer` | MicroCover | constructor | `activatePolicy`, `declineToBind`, `withdrawReserve` (uncommitted only), `remitPremiums` | No — redeploy |
| `insurerSigner` | MicroCover | constructor | Signature that authorizes `settleClaim` payouts | No — redeploy |
| `behaviourVerifier` | BehaviourSavings | `setBehaviourVerifier` (admin) | Signer assigned to new ExternalSignal goals | Yes, by admin (affects new goals only) |

`Deploy.s.sol` behaviour: refuses to run unless `block.chainid == 10143` or
`ALLOW_OTHER_CHAIN=true`. On Monad Testnet any unset role (`TRUST_SIGNER`,
`ARBITRATOR`, `SAVINGS_ADMIN`, `POOL_ATTESTER`, `RECORDER`, `INSURER`) falls back
to the deployer with a console warning; `INSURER_SIGNER` falls back to `INSURER`.
Off testnet every role must be set and none may equal the deployer
(`RoleNotSet`, `RoleIsDeployer`). The deploy order is TestRupee, PotManager,
SocialPay, Gift, BehaviourSavings, AccountabilityPool, SalaryStream,
IncomeShare, MicroCover.

**Which features need a redeployment or role change to work safely.** Any feature
that consumes the trust-signer address (Pot join, pool day attestation, savings
ExternalSignal, IncomeShare repayment recording, MicroCover claim settlement) is
bound to the compromised key. There is no on-chain way to rotate; see
[SECURITY.md](SECURITY.md) §3.

## 4. TestRupee

ERC-20 "Test Rupee" / `tINR`, `decimals() = 2`. `faucet()` mints
`FAUCET_AMOUNT = 500_000` (₹5,000.00) to the caller once per `COOLDOWN = 1 days`
per address (`lastClaim`); an early call reverts `FaucetCooldown(availableAt)`.
No owner, no cap, no burn. Tests: none dedicated (exercised via the other suites).

## 5. PotManager (the core product)

All pots live in one contract. IDs start at **1** (`potId = ++potCount`), spend
IDs start at **1** per pot (`spendId = ++p.spendCount`), members are an
append-only array per pot (cap 20).

States: `Collecting(0) → Funded(1) → Closed(3)`, or `Collecting → Refunding(2) →
Closed(3)`.

Constants: `MAX_MEMBERS_CAP = 20`, `MAX_DEADLINE_HORIZON = 365 days`.

### Writes

| Function | Caller | Preconditions (revert) | Effects / events |
|---|---|---|---|
| `createPot(inviteHash, approvalLimit, maxMembers, targetAmount, deadline)` | anyone | `inviteHash != 0`; `2 ≤ maxMembers ≤ 20`; `targetAmount > 0`; `block.timestamp < deadline ≤ now + 365d`; `approvalLimit ≤ targetAmount` (`InvalidParams`) | Creates pot, state Collecting, creator becomes member 1. Emits `PotCreated`, `MemberJoined`. |
| `join(potId, inviteCode, expiry, authorization)` | anyone | pot exists; Collecting and `now < deadline` **or** Funded (else `DeadlinePassed`/`NotCollecting`); not already member (`AlreadyMember`, checked first on purpose); `now < expiry` (`AuthorizationExpired`); `keccak256(inviteCode) == inviteHash` (`BadInviteCode`); `ECDSA.recover(joinDigest(potId, msg.sender, expiry), authorization) == trustSigner` (`BadAuthorization`); `members < maxMembers` (`PotFull`) | Adds member; emits `MemberJoined`. No nonce mapping: single use because a second join by the same address reverts `AlreadyMember`. |
| `deposit(potId, amount) → accepted` | member | state Collecting, `now < deadline`, `amount > 0` | `accepted = min(amount, targetAmount − totalContributed)`; first contribution increments `refundsOutstanding`; updates `balance`, `totalContributed`, `contributed[member]`; reaching the target sets Funded. `safeTransferFrom(accepted)`. Emits `Deposited`, and `PotFunded` when the target is hit. |
| `requestSpend(potId, to, amount, memoHash) → spendId` | member | Funded; `to` is a member (`RecipientNotMember`); `amount > 0`; `amount ≤ balance − reserved` (`InsufficientBalance`) | `needsApproval = (to == msg.sender) \|\| (instantSpent[msg.sender] + amount > approvalLimit)`. If true: `reserved += amount`, `pendingSpendCount++`. Else: `instantSpent += amount` and the spend executes immediately. Emits `SpendRequested`, and `SpendExecuted` if instant. |
| `approveSpend(potId, spendId)` | member | Funded; spend exists/not executed/not cancelled; caller ≠ requester (`CannotApproveOwnSpend`) **and** caller ≠ recipient (`CannotApproveOwnPayout`) | Releases the reservation, `pendingSpendCount--`, emits `SpendApproved`, executes (`SpendExecuted`). |
| `cancelSpend(potId, spendId)` | requester or creator | Funded; spend exists/open | `cancelled = true`, releases reservation. Emits `SpendCancelled`. |
| `closePot(potId)` | creator | Funded; `pendingSpendCount == 0` (`PendingRequests`) | State Closed; distributes `balance` pro-rata to `contributed` — each share `remaining * c / totalContributed`, the last contributor (highest index with `c > 0`) receives `remaining − distributed`. Emits `PotClosed(remaining)` then one `Refunded` per payout. |
| `finalizeFailed(potId)` | anyone | Collecting; `now ≥ deadline` (`DeadlineNotReached`) | If `refundsOutstanding == 0` → Closed (`PotClosed(0)`); else Refunding (`RefundingStarted`). |
| `claimRefund(potId)` | contributor | Refunding; `contributed > 0` (`NothingToClaim`); not claimed (`AlreadyClaimed`) | Pays exactly `contributed[caller]`; last claim moves the pot to Closed (`PotClosed(0)`). Emits `Refunded`. |

### Views

`getPot` (all fields except `inviteHash`, plus `memberCount`), `getMembers`,
`getSpend`, `remainingToTarget`, `availableBalance` (= `balance − reserved`),
`instantRemaining(potId, member)`, `refundableOf(potId, member)`, `joinDigest`;
public mappings `isMember`, `contributed`, `refundClaimed`, `instantSpent`; public
`token`, `trustSigner`, `potCount`.

### Join digest

`toEthSignedMessageHash(keccak256(abi.encode(keccak256("PotManager.join.v1"),
address(this), block.chainid, potId, joiner, expiry)))`. The server recreates this
in `apps/pot/lib/server/trust-signer.ts` and a Solidity test pins the equivalence
(`TrustLayerDigests.t.sol`).

### Money rules as implemented (traced, not inferred from names)

1. Money leaves only a **Funded** pot (spend functions require Funded; refunds
   require Refunding).
2. A pot never takes more than its target; excess stays with the sender.
3. Payout recipients must be members at request time.
4. `approvalLimit` is a **cumulative per-member** counter (`instantSpent`);
   approved spends do **not** consume it.
5. A pending request reserves its amount; `requestSpend` checks
   `balance − reserved`.
6. The approver must be neither requester nor recipient. Consequence stated in
   the contract: in a **two-member** pot an over-limit payment between the two
   members cannot be approved by anyone (cancel is the only way out).
7. `closePot` is creator-only, blocked while anything is pending, pro-rata with
   the last contributor absorbing rounding dust.
8. Failed pots refund by individual claim with no expiry and no sweep.

### Edge cases and observations (from reading the code)

- Tokens sent to the contract outside `deposit` are not tracked in `balance` and
  have no recovery path (no sweep function). Not tested for here (Unknown).
- `closePot` emits `Refunded` for the leftover payout as well as for failed-pot
  claims; any consumer of `Refunded` cannot distinguish the two without the pot
  state.
- `requestSpend` emits `SpendRequested` **before** executing an instant spend; if
  execution reverts the whole transaction reverts (no partial state).
- `cancelSpend` requires `Funded`; after `closePot` there can be no pending
  requests (enforced), so no stuck reservations are possible in a closed pot.
- The invite code is not confidential once used (it appears in calldata); access
  control rests on the trust-signer signature, not on the code (contract header).
- Members cannot leave; there is no edit function (Verified by absence).
- `deadline` is exclusive on both sides: deposits require `now < deadline`;
  `finalizeFailed` requires `now ≥ deadline`.

### Events and custom errors

Events: `PotCreated, MemberJoined, Deposited, PotFunded, RefundingStarted,
SpendRequested, SpendApproved, SpendCancelled, SpendExecuted, PotClosed,
Refunded`.
Errors: `InvalidParams, PotNotFound, NotCollecting, NotFunded, NotRefunding,
DeadlinePassed, DeadlineNotReached, NotMember, AlreadyMember, BadInviteCode,
PotFull, NotCreator, ZeroAmount, InsufficientBalance, RecipientNotMember,
SpendNotFound, SpendAlreadyExecuted, SpendWasCancelled, CannotApproveOwnSpend,
CannotApproveOwnPayout, AuthorizationExpired, BadAuthorization,
NotRequesterOrCreator, PendingRequests, NothingToClaim, AlreadyClaimed`.

Tests: `PotManager.t.sol` (91 test functions), `PotManagerSecurity.t.sol` (2).

## 6. SocialPay — payments held until confirmed

IDs start at **0** (`paymentId = paymentCount++`). Constants:
`MIN_CONFIRM_WINDOW = 1 hours`, `MAX_CONFIRM_WINDOW = 30 days`,
`CLAIM_EXPIRY = 30 days`. States: `None, Held, Claimable, Confirmed, Claimed,
Reclaimed, Disputed, Resolved`. `arbitrator` immutable.

| Function | Caller | Rule |
|---|---|---|
| `sendPayment(recipient, amount, memoHash, confirmWindow)` | anyone | recipient ≠ 0/self, amount > 0, window 1 h–30 d; pulls tokens; state Held, `deadline = now + window` |
| `createClaimablePayment(claimHash, amount, memoHash)` | anyone | `claimHash ≠ 0`, amount > 0; state Claimable, expires in 30 d |
| `confirmReceipt(id)` | recipient | Held (even after the deadline, until the sender reclaims) → Confirmed, pays recipient |
| `claimPayment(id, secret)` | anyone except sender | Claimable, before expiry, `keccak256(secret) == claimHash`; recipient becomes caller |
| `reclaim(id)` | sender | Held or Claimable and `now ≥ deadline` → Reclaimed, refunds sender |
| `dispute(id)` | sender or recipient | Held → Disputed |
| `resolveDispute(id, releaseToRecipient)` | sender, recipient or arbitrator | Disputed; one vote each; **2 of 3 matching votes** pay the winner; no deadline on a deadlocked dispute |

Views: `getPayment`, `isOpen`, `timeUntilReclaimable`, `voteOf`, `paymentCount`.
Tests: `SocialPay.t.sol` (46), `SocialPaySecurity.t.sol` (4). The app UI covers
send/confirm/reclaim/dispute only (see [FEATURE_MATRIX.md](FEATURE_MATRIX.md));
claimable payments and `resolveDispute` have no UI (Verified by searching the
hooks).

## 7. Gift — money released on a condition

IDs start at **0**. Constants: `TIMEOUT_PERIOD = 730 days`,
`MIN_RELEASE_DELAY = 1 hours`. Condition types: `Time`, `Event`, `Attestation`
(Event and Attestation are identical on-chain: a signature from `attester`).
States: `None, Pending, Attested, Claimed, Cancelled, Released`.

| Function | Rule |
|---|---|
| `createGift(recipient, amount, type, conditionData, attester, irrevocable)` | recipient ≠ 0/self; amount > 0. Time: `attester == 0`, `conditionData` is `abi.encode(uint256 releaseTime)` (32 bytes), `releaseTime ≥ now + 1 h`. Otherwise `attester ≠ 0` and non-empty `conditionData`. Stores `keccak256(conditionData)`; `timeoutAt = now + 730 d`. |
| `attestCondition(giftId, signature)` | anyone may submit; rejected for Time gifts; `ECDSA.recover(attestationDigest) == gift.attester` (`BadAttestation`); Pending → Attested |
| `claim(giftId)` | recipient. Time: Pending and `now ≥ releaseTime`. Else: state Attested. |
| `requestTimeoutRelease(giftId)` | recipient, non-Time gifts, Pending and `now ≥ timeoutAt` |
| `cancel(giftId)` | sender, not irrevocable, Pending; for Time gifts only before `releaseTime` |

Digest: `toEthSignedMessageHash(keccak256(abi.encode(address(this), chainid,
giftId, conditionHash)))`. The contract proves a named address signed; it does
not and cannot prove the event happened. Tests: `Gift.t.sol` (38).

## 8. BehaviourSavings — save with a stake

IDs start at **0**. Constants: `STAKE_BPS = 1000` (10 % of target),
`MIN_DEPOSITS = 4`, `MIN_DURATION = 1 day`, `MAX_DURATION = 365 days`.
`BehaviourType`: `SaveConsistently` (verified from storage) or `ExternalSignal`
(signature from the goal's snapshotted `verifier`). States: `None, Open,
Finalised, Settled`.

| Function | Rule |
|---|---|
| `registerVerifier / revokeVerifier / setBehaviourVerifier` | `admin` only; verifier registry; revoking does not retarget open goals |
| `createSavingsGoal(user, target, deadline, behaviour)` | `user == msg.sender`; stake = `target * 1000 / 10000` must be > 0; deadline within 1 d–365 d; ExternalSignal needs `behaviourVerifier ≠ 0` and ≠ user; pulls the **stake** |
| `deposit(goalId, amount)` | goal owner, Open, before deadline; pulls `amount` toward principal |
| `submitBehaviour(goalId, signalHash, signature)` | ExternalSignal only; Open, before deadline; once per goal; signer must equal the goal's verifier |
| `finalise(goalId)` | anyone, after deadline; met = `saved ≥ target` and (`depositCount ≥ 4` for SaveConsistently, `behaviourVerified` for ExternalSignal); **returns principal immediately**; tallies the deadline cohort |
| `claimOutcome(goalId)` | goal owner, after every goal in the cohort is finalised; winners get stake + pro-rata share of forfeited stakes (last winner takes the remainder); if nobody won, losers get their stakes back; otherwise a loser reverts `NothingToClaim` |

Cohorts key on the **exact deadline second**. Invariant tested by the authors:
principal is always returned (`testFuzz_NobodyEverLosesPrincipal`). Tests:
`BehaviourSavings.t.sol` (49 functions; the project docs also quote 34 at an
earlier date).

## 9. AccountabilityPool — a group stakes on turning up

IDs start at **1**. Constants: `MAX_MEMBERS_CAP = 20`, `MIN_DURATION = 1 day`,
`MAX_DURATION = 365 days`. `ATTEST_ACTION = keccak256("AccountabilityPool.attest.v1")`.
States: `None, Open, Finalised`.

| Function | Rule |
|---|---|
| `createPool(stakePerMember, deadline, requiredDays, graceDays, maxMembers)` | stake > 0; 2 ≤ members ≤ 20; `requiredDays > 0`; `graceDays < requiredDays`; deadline within 1 d–365 d; creator joins and stakes |
| `joinPool(poolId)` | Open, before deadline, not member, not full; stakes |
| `attestDay(poolId, member, day, signature)` | anyone may relay; Open, before deadline; member; once per member per day; signer must equal `attester` |
| `finalise(poolId)` | anyone, after deadline; bounded loop; success rule `daysAttested + graceDays ≥ requiredDays`; if nobody succeeded every stake stays claimable by its owner |
| `claim(poolId)` | member; winners get stake + pro-rata forfeits (last winner takes remainder); a loser's claim marks claimed and pays 0 unless everyone failed |

Digest: `abi.encode(ATTEST_ACTION, address(this), chainid, poolId, member, day)`.
Tests: `AccountabilityPool.t.sol` (39).

## 10. SalaryStream — pay by the second

IDs start at **0**. Constants: `LOW_RUNWAY = 7 days`, `MIN_DURATION = 1 hour`,
`MAX_DURATION = 3650 days`. States: `None, Active, Paused, Cancelled`.
Accrual: `ratePerSecond × seconds`, **capped at the funded balance** (no
division, so no rounding). `createStream` and `createAndFundStream` both require a
non-zero deposit (the former always reverts `UnderfundedStart` because it passes
0). `topUp`, `withdraw` (employee), `pauseStream` (employer anytime; anyone when
runway < 7 days), `resumeStream` (employer; paused time is never back-paid),
`cancelStream` (employer; accrued stays withdrawable, the rest returns to the
employer). Tests: `SalaryStream.t.sol` (37).

## 11. IncomeShare — a ledger, holds no tokens

IDs start at **0**. No token, no balance. `createAgreement(recipient,
fundingAmount, repaymentPercent, cap, termEnd, agreementHash)`: recipient ≠ 0/self;
funding > 0; percent 1–100; `cap ≥ fundingAmount`; non-zero hash; `termEnd` in the
future. `recordRepayment(id, income, repaymentAmount, signature)`:
**`msg.sender == recorder`** and the **recipient's** signature over
`toEthSignedMessageHash(keccak256(abi.encode(address(this), chainid, agreementId,
index, income, repaymentAmount)))`; totals may not exceed `cap`; reaching the cap
completes the agreement. `markComplete` is permissionless once the cap is reached
or the term ended. The contract does not recompute the repayment amount from the
percentage — the server does that in `attest-income` and the recipient signs the
result. Tests: `IncomeShare.t.sol` (31).

## 12. MicroCover — premium and payout rail (not an insurer)

IDs start at **1**. Constants: `CLAIM_WINDOW = 30 days`, `BIND_WINDOW = 1 day`,
`MIN_DURATION = 10 minutes`, `MAX_DURATION = 365 days`. Policy states: `None,
Escrowed, Active, Refunded, Closed`; claim states: `None, Submitted, Paid,
Declined`.

| Function | Caller | Rule |
|---|---|---|
| `fundReserve(amount)` | anyone | adds to `reserve` |
| `withdrawReserve(amount)` | insurer | only `reserve − committed` |
| `remitPremiums()` | insurer | pulls premiums of bound policies |
| `createPolicy(insured, premium, coverage, start, end, termsHash)` | anyone (payer) | premium > 0; `coverage > premium`; non-zero hash; window valid, 10 min–365 d, end in the future; escrows the premium; state Escrowed (**no cover yet**) |
| `activatePolicy(id)` | **insurer only** | Escrowed; before `endTime`; `reserve − committed ≥ coverage`; commits the coverage, makes the premium remittable |
| `declineToBind(id)` | insurer | refunds the premium immediately |
| `refundUnboundPremium(id)` | anyone | Escrowed and (`now > createdAt + 1 day` or `now > endTime`) |
| `submitClaim(id, evidenceHash)` | insured | Active; one claim per policy; within `endTime + 30 d` |
| `settleClaim(id, payout, insurerSignature)` | anyone | signature must equal `insurerSigner` over `(address(this), chainid, policyId, evidenceHash, payout)`; `payout ≤ coverage`; payout 0 = decline; policy closes either way |
| `closeExpiredPolicy(id)` | anyone | Active, no claim, `now > endTime + 30 d` |

Because `insurer` is the deployer EOA (not a Privy wallet), no in-app user can
call `activatePolicy`; the app's `useBindCover` hook can only work if that exact
address signs in (see [FEATURE_MATRIX.md](FEATURE_MATRIX.md)). Tests:
`MicroCover.t.sol` (62).

## 13. Test inventory (contracts)

| Suite | Test functions (static count of `function test…`) | Fuzz |
|---|---|---|
| AccountabilityPool.t.sol | 39 | 1 |
| BehaviourSavings.t.sol | 49 | 1 |
| Gift.t.sol | 38 | 1 |
| IncomeShare.t.sol | 31 | 1 |
| MicroCover.t.sol | 62 | 1 |
| PotManager.t.sol | 91 | 0 |
| PotManagerSecurity.t.sol | 2 | 1 |
| SalaryStream.t.sol | 37 | 1 |
| SocialPay.t.sol | 46 | 1 |
| SocialPaySecurity.t.sol | 4 | 1 |
| TrustLayerDigests.t.sol | 9 | 0 |
| **Total** | **408** | |

The static total equals the 408 quoted by `README.md`/`docs/tech.md`. **These
tests were not executed in this pass** (no Foundry). See [TESTING.md](TESTING.md).

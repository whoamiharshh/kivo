/**
 * The trust layer's one signing key, and everything it is allowed to say.
 *
 * ──────────────── what this module is for ────────────────
 *
 * Four of this project's contracts gate money on an ECDSA signature. None of
 * them can check whether the signer had any business signing: a contract sees
 * a key, not a reason. This module is the reason. Every function here pairs one
 * signature with one record in `trust_nonces`, so that afterwards you can ask
 * "why does this signature exist" and get an answer instead of a shrug.
 *
 * ──────────────── the honest part ────────────────
 *
 * **This key is a trusted party and the system is not trustless because of it.**
 * Anyone holding it can assert a behaviour happened, an income was earned, a
 * gift condition was met, or an insured event occurred. Nothing in this
 * repository checks those claims against hardware, a bank, or a real feed.
 * `docs/trust-layer.md` lists each assumption and what would replace it.
 *
 * What the key still cannot do, which is worth as much as the warning: it holds
 * no money, it is not an owner or admin of any contract, and it cannot move a
 * token that a contract's own rules do not already allow to move.
 *
 * ──────────────── why not EIP-712 ────────────────
 *
 * The brief asks for an EIP-712 domain. The five contracts here already
 * standardised on hand-rolled EIP-191 digests that bind `address(this)` and
 * `block.chainid` — the same cross-contract and cross-chain binding an EIP-712
 * domain gives, reached a different way. Converting all five plus their tests
 * for uniformity alone would be a large change with no security gain, and a
 * half-converted codebase would be worse than either. So: EIP-191 everywhere,
 * stated rather than hidden, and listed in docs/trust-layer.md as a deviation.
 *
 * ──────────────── why the digests are written out here ────────────────
 *
 * Each `*Digest` below recreates what the contract computes, rather than
 * calling the contract's view function. Two reasons: signing needs no RPC
 * round trip, and if a contract's formula ever changes, the mismatch shows up
 * as signatures being REJECTED rather than as two copies of a bug agreeing
 * with each other. Each contract has a test asserting the two agree.
 */
import "server-only";
import {
  encodeAbiParameters,
  keccak256,
  toBytes,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { TRUST_SIGNER_KEY } from "./env";

/** Every action the trust layer can be asked for. Stored on each nonce row. */
export type TrustAction =
  | "join_pot"
  | "attest_behaviour"
  | "attest_income"
  | "attest_condition"
  | "attest_oracle"
  | "attest_day"
  | "verify_employer";

/**
 * How long an authorization stays valid.
 *
 * Read `docs/trust-layer.md` before trusting this number to mean more than it
 * does. Only `join_pot` carries its expiry ON-CHAIN, because only PotManager
 * takes an expiry argument. For the others the expiry is enforced by this
 * server when the signature is requested and when the nonce is consumed; the
 * signature itself, once issued, stays acceptable to the contract until the
 * record it names has been consumed — and each record can be consumed exactly
 * once, which is the protection that actually holds.
 */
export const TTL_SECONDS: Record<TrustAction, number> = {
  join_pot: 600,
  attest_behaviour: 900,
  attest_income: 900,
  attest_condition: 900,
  attest_oracle: 900,
  attest_day: 900,
  verify_employer: 900,
};

let cached: ReturnType<typeof privateKeyToAccount> | null = null;

function account() {
  cached ??= privateKeyToAccount(TRUST_SIGNER_KEY());
  return cached;
}

/** The address to give the deploy script as TRUST_SIGNER / RECORDER / INSURER. */
export function trustSignerAddress(): Address {
  return account().address;
}

/**
 * Sign a digest the EIP-191 way, which is what every contract here expects.
 * `signMessage` with a raw hash applies the same prefix as
 * `MessageHashUtils.toEthSignedMessageHash`.
 */
async function sign(digest: Hex): Promise<Hex> {
  return account().signMessage({ message: { raw: digest } });
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

// ═══════════════ PotManager.join ═══════════════

const JOIN_ACTION = keccak256(toBytes("PotManager.join.v1"));

/** Matches `PotManager.joinDigest`. */
export function joinDigest(
  potManager: Address,
  chainId: number,
  potId: number,
  joiner: Address,
  expiry: number
): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "address" },
        { type: "uint64" },
      ],
      [JOIN_ACTION, potManager, BigInt(chainId), BigInt(potId), joiner, BigInt(expiry)]
    )
  );
}

export type Authorization = { expiry: number; signature: Hex; digest: Hex };

export async function signJoin(args: {
  potManager: Address;
  chainId: number;
  potId: number;
  joiner: Address;
}): Promise<Authorization> {
  const expiry = nowSeconds() + TTL_SECONDS.join_pot;
  const digest = joinDigest(
    args.potManager,
    args.chainId,
    args.potId,
    args.joiner,
    expiry
  );
  return { expiry, digest, signature: await sign(digest) };
}

// ═══════════════ BehaviourSavings.submitBehaviour ═══════════════

/**
 * Matches `BehaviourSavings.behaviourDigest`.
 *
 * Note what is NOT in here: no expiry, and no statement of what the signal
 * actually was. The contract sees a 32-byte hash and the fact that the
 * registered verifier signed it. Whether `signalHash` commits to "walked
 * 12,000 steps" or to "I say so" is this layer's business, and it is why
 * `behaviour_signals` stores the preimage fields next to the hash.
 */
export function behaviourDigest(
  savings: Address,
  chainId: number,
  goalId: number,
  signalHash: Hex
): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32" }],
      [savings, BigInt(chainId), BigInt(goalId), signalHash]
    )
  );
}

export async function signBehaviour(args: {
  savings: Address;
  chainId: number;
  goalId: number;
  signalHash: Hex;
}): Promise<Authorization> {
  const digest = behaviourDigest(
    args.savings,
    args.chainId,
    args.goalId,
    args.signalHash
  );
  return {
    expiry: nowSeconds() + TTL_SECONDS.attest_behaviour,
    digest,
    signature: await sign(digest),
  };
}

// ═══════════════ Gift.attestCondition ═══════════════

/**
 * Matches `Gift.attestationDigest`.
 *
 * `conditionHash` is read FROM THE CHAIN by the caller, never taken from the
 * request. A condition hash supplied by whoever wants the gift released is not
 * evidence of anything.
 */
export function conditionDigest(
  gift: Address,
  chainId: number,
  giftId: number,
  conditionHash: Hex
): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32" }],
      [gift, BigInt(chainId), BigInt(giftId), conditionHash]
    )
  );
}

export async function signCondition(args: {
  gift: Address;
  chainId: number;
  giftId: number;
  conditionHash: Hex;
}): Promise<Authorization> {
  const digest = conditionDigest(
    args.gift,
    args.chainId,
    args.giftId,
    args.conditionHash
  );
  return {
    expiry: nowSeconds() + TTL_SECONDS.attest_condition,
    digest,
    signature: await sign(digest),
  };
}

// ═══════════════ MicroCover.settleClaim ═══════════════

/**
 * Matches `MicroCover.settlementDigest`.
 *
 * **Read this before believing anything about feature 07.** On a real product
 * this signature comes from a licensed insurer's claims-signing key, and
 * producing it IS the act of adjudicating a claim. Here it comes from the same
 * server key as everything else, driven by a button in a demo. That is why the
 * UI for this feature says "Prototype: the trigger is simulated" and why
 * `oracle_events.source` is a column rather than an assumption.
 *
 * `evidenceHash` is read from the chain's claim record, not from the request,
 * so a claimant cannot choose what their own claim is said to contain.
 */
export function settlementDigest(
  microCover: Address,
  chainId: number,
  policyId: number,
  evidenceHash: Hex,
  payoutAmount: bigint
): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "uint256" },
      ],
      [microCover, BigInt(chainId), BigInt(policyId), evidenceHash, payoutAmount]
    )
  );
}

export async function signSettlement(args: {
  microCover: Address;
  chainId: number;
  policyId: number;
  evidenceHash: Hex;
  payoutAmount: bigint;
}): Promise<Authorization> {
  const digest = settlementDigest(
    args.microCover,
    args.chainId,
    args.policyId,
    args.evidenceHash,
    args.payoutAmount
  );
  return {
    expiry: nowSeconds() + TTL_SECONDS.attest_oracle,
    digest,
    signature: await sign(digest),
  };
}

// ═══════════════ IncomeShare.recordRepayment ═══════════════

/**
 * Matches `IncomeShare.repaymentDigest`.
 *
 * The odd one out, and worth understanding: this signature is NOT the
 * server's. `IncomeShare.recordRepayment` requires the RECIPIENT's signature
 * over this digest and requires `msg.sender == recorder`. So the recipient
 * agrees to the number, and the server merely carries the transaction.
 *
 * That split is the useful property of feature 04: the server can refuse to
 * record, but it cannot invent a repayment the recipient did not sign for.
 * This function therefore only computes the digest for the browser to sign;
 * there is deliberately no `signRepayment` here, because the server signing it
 * would be exactly the thing the contract is designed to prevent.
 */
export function repaymentDigest(
  incomeShare: Address,
  chainId: number,
  agreementId: number,
  index: number,
  incomePaise: bigint,
  repaymentPaise: bigint
): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
      ],
      [
        incomeShare,
        BigInt(chainId),
        BigInt(agreementId),
        BigInt(index),
        incomePaise,
        repaymentPaise,
      ]
    )
  );
}

// ═══════════════ employer verification: no on-chain hook at all ═══════════════

/**
 * `SalaryStream` verifies no signatures. It has no employer registry, no
 * attester role, and no code path that consults one.
 *
 * So an employer attestation is **advisory only**: it is recorded in
 * `employer_attestations`, shown in the UI, and signed so the record is
 * tamper-evident — but no contract will ever refuse a stream because of it.
 * The solvency rule that actually protects an employee (pause when the funded
 * balance runs below the configured number of days) is enforced in the
 * contract and needs no attestation.
 *
 * This signature exists so the stored record cannot be edited after the fact
 * without detection. It is not a gate, and the UI must not imply it is one.
 */
const EMPLOYER_ACTION = keccak256(toBytes("Pot.employerAttestation.v1"));

export function employerDigest(
  chainId: number,
  employer: Address,
  proofHash: Hex,
  issuedAt: number
): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
        { type: "bytes32" },
        { type: "uint64" },
      ],
      [EMPLOYER_ACTION, BigInt(chainId), employer, proofHash, BigInt(issuedAt)]
    )
  );
}

export async function signEmployerAttestation(args: {
  chainId: number;
  employer: Address;
  proofHash: Hex;
}): Promise<Authorization & { issuedAt: number }> {
  const issuedAt = nowSeconds();
  const digest = employerDigest(
    args.chainId,
    args.employer,
    args.proofHash,
    issuedAt
  );
  return {
    issuedAt,
    expiry: issuedAt + TTL_SECONDS.verify_employer,
    digest,
    signature: await sign(digest),
  };
}

// ═══════════════ AccountabilityPool.attestDay ═══════════════

const POOL_ACTION = keccak256(toBytes("AccountabilityPool.attest.v1"));

/**
 * Matches `AccountabilityPool.attestationDigest`.
 *
 * `day` is whole days since the unix epoch. The server and the browser have to
 * agree which timezone produced that number, and they agree on the MEMBER's
 * local date: a student in Delhi submitting at 11pm means today for them, and
 * a server computing UTC midnight would file it as tomorrow. The contract
 * rejects a second attestation for the same day, so the only way a timezone
 * disagreement can hurt is by wasting one day's submission.
 */
export function poolAttestationDigest(
  poolAddress: Address,
  chainId: number,
  poolId: number,
  member: Address,
  day: number
): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "address" },
        { type: "uint64" },
      ],
      [
        POOL_ACTION,
        poolAddress,
        BigInt(chainId),
        BigInt(poolId),
        member,
        BigInt(day),
      ]
    )
  );
}

export async function signPoolDay(args: {
  poolAddress: Address;
  chainId: number;
  poolId: number;
  member: Address;
  day: number;
}): Promise<Authorization> {
  const digest = poolAttestationDigest(
    args.poolAddress,
    args.chainId,
    args.poolId,
    args.member,
    args.day
  );
  return {
    expiry: nowSeconds() + TTL_SECONDS.attest_day,
    digest,
    signature: await sign(digest),
  };
}

/** Whole days since the epoch, from a YYYY-MM-DD string. */
export function dayNumber(isoDay: string): number {
  const ms = Date.parse(`${isoDay}T00:00:00Z`);
  if (Number.isNaN(ms)) throw new Error(`not a date: ${isoDay}`);
  return Math.floor(ms / 86_400_000);
}

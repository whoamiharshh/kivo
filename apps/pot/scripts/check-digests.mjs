/**
 * Cross-check the TypeScript digests against the Solidity ones.
 *
 * If these two ever disagree, every signature the trust layer issues is
 * rejected on-chain and nothing in the app works. That failure is total but
 * silent until somebody tries a transaction, so it gets its own check.
 *
 * This script prints the digests TypeScript computes for a set of fixed
 * inputs. `test/TrustLayerDigests.t.sol` asserts the CONTRACTS produce exactly
 * these bytes for the same inputs. Run both; they have to agree.
 *
 *   node scripts/check-digests.mjs
 *   cd ../../packages/contracts && forge test --match-contract TrustLayerDigests
 */
import { encodeAbiParameters, keccak256, toBytes } from "viem";

// Fixed, arbitrary, and deliberately not round numbers, so a transposed
// argument shows up instead of cancelling out.
const V = {
  potManager: "0x00000000000000000000000000000000000000a1",
  savings: "0x00000000000000000000000000000000000000a2",
  gift: "0x00000000000000000000000000000000000000a3",
  microCover: "0x00000000000000000000000000000000000000a4",
  incomeShare: "0x00000000000000000000000000000000000000a5",
  pool: "0x00000000000000000000000000000000000000a6",
  joiner: "0x00000000000000000000000000000000000000b1",
  chainId: 10143n,
  potId: 7n,
  expiry: 1800000000n,
  goalId: 3n,
  giftId: 11n,
  policyId: 5n,
  poolId: 13n,
  day: 20400n,
  agreementId: 9n,
  index: 2n,
  income: 4567800n,
  repayment: 456780n,
  payout: 250000n,
  signalHash:
    "0x1111111111111111111111111111111111111111111111111111111111111111",
  conditionHash:
    "0x2222222222222222222222222222222222222222222222222222222222222222",
  evidenceHash:
    "0x3333333333333333333333333333333333333333333333333333333333333333",
};

const JOIN_ACTION = keccak256(toBytes("PotManager.join.v1"));
const POOL_ACTION = keccak256(toBytes("AccountabilityPool.attest.v1"));

const enc = (types, values) =>
  keccak256(encodeAbiParameters(types.map((type) => ({ type })), values));

const digests = {
  joinDigest: enc(
    ["bytes32", "address", "uint256", "uint256", "address", "uint64"],
    [JOIN_ACTION, V.potManager, V.chainId, V.potId, V.joiner, V.expiry]
  ),
  behaviourDigest: enc(
    ["address", "uint256", "uint256", "bytes32"],
    [V.savings, V.chainId, V.goalId, V.signalHash]
  ),
  conditionDigest: enc(
    ["address", "uint256", "uint256", "bytes32"],
    [V.gift, V.chainId, V.giftId, V.conditionHash]
  ),
  settlementDigest: enc(
    ["address", "uint256", "uint256", "bytes32", "uint256"],
    [V.microCover, V.chainId, V.policyId, V.evidenceHash, V.payout]
  ),
  repaymentDigest: enc(
    ["address", "uint256", "uint256", "uint256", "uint256", "uint256"],
    [
      V.incomeShare,
      V.chainId,
      V.agreementId,
      V.index,
      V.income,
      V.repayment,
    ]
  ),
  poolAttestationDigest: enc(
    ["bytes32", "address", "uint256", "uint256", "address", "uint64"],
    [POOL_ACTION, V.pool, V.chainId, V.poolId, V.joiner, V.day]
  ),
  joinActionTag: JOIN_ACTION,
  poolActionTag: POOL_ACTION,
};

for (const [name, value] of Object.entries(digests)) {
  console.log(`${name.padEnd(18)} ${value}`);
}

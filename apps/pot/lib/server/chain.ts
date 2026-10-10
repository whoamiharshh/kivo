/**
 * Reading the chain, and the two places the server has to write to it.
 *
 * ──────────────── reads ────────────────
 *
 * Several attestations have to commit to a value the chain already holds — a
 * gift's `conditionHash`, a claim's `evidenceHash`. Those are read from here,
 * never taken from the request body. The difference matters: a condition hash
 * supplied by whoever wants the gift released is not evidence of anything,
 * whereas the one in storage was fixed when the gift was created.
 *
 * ──────────────── writes, and why they exist at all ────────────────
 *
 * Most of this project avoids the server sending transactions. The user's own
 * wallet signs and submits, so a compromised server cannot move money. Two
 * contracts make that impossible:
 *
 *   IncomeShare.recordRepayment  requires msg.sender == recorder
 *   MicroCover.activatePolicy    requires msg.sender == insurer
 *
 * Those roles exist because on a real product they belong to a licensed
 * counterparty and a licensed insurer, who would run their own infrastructure
 * and send their own transactions. On a testnet there is no such party, so the
 * demo gives both roles to this server and says so loudly — in the deploy
 * script's warnings, in the UI's "Prototype" labels, and here.
 *
 * What that costs, stated plainly: a compromised server key could record a
 * repayment against an agreement, or bind an insurance policy. It still could
 * NOT invent a repayment the recipient did not sign for (the contract checks
 * the recipient's signature separately), and it could not take money out of
 * MicroCover's reserve beyond paying a claim the policy already covers.
 *
 * The server pays its own gas for these. On Monad Testnet that comes from the
 * faucet; see README. If the key runs dry these two actions fail with a clear
 * message rather than appearing to succeed.
 */
import "server-only";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import { TRUST_SIGNER_KEY } from "./env";
import { giftAbi, incomeShareAbi, microCoverAbi } from "../abis";
import { GIFT_ADDRESS, INCOME_SHARE_ADDRESS, MICRO_COVER_ADDRESS } from "../contracts";

export const chainId = monadTestnet.id;

let publicClient: ReturnType<typeof createPublicClient> | null = null;

export function reader() {
  publicClient ??= createPublicClient({
    chain: monadTestnet,
    transport: http(),
  });
  return publicClient;
}

let walletClient: ReturnType<typeof createWalletClient> | null = null;

function writer() {
  walletClient ??= createWalletClient({
    account: privateKeyToAccount(TRUST_SIGNER_KEY()),
    chain: monadTestnet,
    transport: http(),
  });
  return walletClient;
}

export class ChainError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason: string
  ) {
    super(message);
    this.name = "ChainError";
  }
}

/**
 * The condition hash a gift was created with.
 *
 * Read rather than trusted, so an attestation can only ever commit to the
 * condition the sender actually set.
 */
export async function giftConditionHash(giftId: number): Promise<Hex> {
  try {
    const g = (await reader().readContract({
      address: GIFT_ADDRESS,
      abi: giftAbi,
      functionName: "getGift",
      args: [BigInt(giftId)],
    })) as { conditionHash: Hex; state: number };

    if (!g || g.state === 0) {
      throw new ChainError("That gift doesn't exist.", 404, "gift_not_found");
    }
    return g.conditionHash;
  } catch (err) {
    if (err instanceof ChainError) throw err;
    console.error("[chain] gift read failed", err);
    throw new ChainError(
      "We couldn't check that gift. Please try again.",
      502,
      "gift_read_failed"
    );
  }
}

/** The evidence hash on a policy's open claim, and what the policy covers. */
export async function claimFacts(
  policyId: number
): Promise<{ evidenceHash: Hex; coverage: bigint; insured: Address }> {
  try {
    const [claim, policy] = await Promise.all([
      reader().readContract({
        address: MICRO_COVER_ADDRESS,
        abi: microCoverAbi,
        functionName: "getClaim",
        args: [BigInt(policyId)],
      }) as Promise<{ evidenceHash: Hex; state: number }>,
      reader().readContract({
        address: MICRO_COVER_ADDRESS,
        abi: microCoverAbi,
        functionName: "getPolicy",
        args: [BigInt(policyId)],
      }) as Promise<{ coverage: bigint; insured: Address }>,
    ]);

    // state 0 is ClaimState.None: nothing to settle, so nothing to sign.
    if (!claim || claim.state === 0) {
      throw new ChainError(
        "There is no open claim on that policy.",
        409,
        "no_claim"
      );
    }
    return {
      evidenceHash: claim.evidenceHash,
      coverage: policy.coverage,
      insured: policy.insured,
    };
  } catch (err) {
    if (err instanceof ChainError) throw err;
    console.error("[chain] claim read failed", err);
    throw new ChainError(
      "We couldn't check that policy. Please try again.",
      502,
      "claim_read_failed"
    );
  }
}

/**
 * Submit a repayment the recipient has already signed for.
 *
 * The server is only the postman here. `signature` is the recipient's, over
 * `IncomeShare.repaymentDigest`, and the contract checks it — so this function
 * cannot record a number the recipient did not agree to, however it is called.
 */
export async function submitRepayment(args: {
  agreementId: number;
  incomePaise: bigint;
  repaymentPaise: bigint;
  signature: Hex;
}): Promise<Hex> {
  try {
    return await writer().writeContract({
      address: INCOME_SHARE_ADDRESS,
      abi: incomeShareAbi,
      functionName: "recordRepayment",
      args: [
        BigInt(args.agreementId),
        args.incomePaise,
        args.repaymentPaise,
        args.signature,
      ],
      chain: monadTestnet,
      account: privateKeyToAccount(TRUST_SIGNER_KEY()),
    });
  } catch (err) {
    console.error("[chain] recordRepayment failed", err);
    throw new ChainError(
      "The repayment could not be recorded. It has not been saved — please try again.",
      502,
      "record_failed"
    );
  }
}

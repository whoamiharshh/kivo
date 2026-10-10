/**
 * POST /api/trust/attest-income — feature 04, PROTOTYPE MODE.
 *
 *   { agreementId, forMonth, incomePaise }
 *     -> { nonce, digest, repaymentPaise, prototype: true }
 *
 * ──────────────── read this before trusting anything here ────────────────
 *
 * The income is a number the recipient typed about themselves. There is no
 * Account Aggregator consent, no bank feed, no payslip, nothing. A recipient
 * who under-reports pays less; a recipient who over-reports pays more. The UI
 * says "Prototype: income is self-declared" and the stored row says
 * `source = 'self_declared'`, permanently, in a column that exists so a real
 * source can never be confused with this one.
 *
 * ──────────────── the part that IS sound ────────────────
 *
 * This route does not return a server signature, and that is deliberate.
 * `IncomeShare.recordRepayment` requires the RECIPIENT's signature over
 * `repaymentDigest` and requires `msg.sender == recorder`. So:
 *
 *   this route    computes the repayment and hands back the digest to sign
 *   the browser   signs it with the recipient's own wallet
 *   /confirm      submits it, with the server acting only as postman
 *
 * The consequence is worth stating: **the server cannot invent a repayment.**
 * It can refuse to record one, and it can carry one the recipient signed, but
 * a repayment the recipient never agreed to will not pass the contract. That
 * property survives even if this server is fully compromised.
 */
import { handle } from "@/lib/server/trust";
import { db } from "@/lib/server/db";
import { repaymentDigest, TTL_SECONDS } from "@/lib/server/trust-signer";
import { reserveNonce, assertNotTooFrequent } from "@/lib/server/nonce";
import {
  asResponse,
  body,
  ok,
  readDay,
  readId,
  readPaise,
  BadRequest,
} from "@/lib/server/route-kit";
import { INCOME_SHARE_ADDRESS, incomeShareAbi } from "@/lib/contracts";
import { reader } from "@/lib/server/chain";
import { monadTestnet } from "viem/chains";
import type { Address } from "viem";

/** ₹10,00,00,000 in paise. A sanity ceiling, not a product rule. */
const MAX_INCOME = 100_000_000_00n;

export const POST = handle(async (request, { caller }) => {
  try {
    const b = await body(request);
    const agreementId = readId(b, "agreementId");
    const forMonth = readDay(b, "forMonth");
    const incomePaise = readPaise(b, "incomePaise", MAX_INCOME);

    await assertNotTooFrequent({
      did: caller.did,
      action: "attest_income",
      maxPerHour: 12,
    });

    // The repayment share and the cap are the agreement's, read from the chain
    // rather than from the request. The recipient does not get to choose what
    // percentage they owe.
    let agreement: {
      recipient: Address;
      repaymentPercent: bigint;
      cap: bigint;
      totalRepaid: bigint;
      repaymentCount: number;
      state: number;
    };
    try {
      agreement = (await reader().readContract({
        address: INCOME_SHARE_ADDRESS,
        abi: incomeShareAbi,
        functionName: "getAgreement",
        args: [BigInt(agreementId)],
      })) as typeof agreement;
    } catch (err) {
      console.error("[attest-income] agreement read failed", err);
      throw new BadRequest(
        "We couldn't check that agreement. Please try again.",
        "agreement_read_failed",
        502
      );
    }

    if (agreement.recipient.toLowerCase() !== caller.address.toLowerCase()) {
      // Only the person who owes can declare their own income.
      throw new BadRequest(
        "That agreement isn't yours.",
        "not_your_agreement",
        403
      );
    }

    // The agreement states a whole percent of income. The contract does NOT
    // recompute this - it records the figure the recipient signed - so this is
    // the one place the arithmetic lives, and it has to match what the UI
    // shows. Integer division truncates, which favours the recipient by at
    // most one paisa per month; the alternative is rounding a debt upward,
    // which is worse.
    const share = (incomePaise * agreement.repaymentPercent) / 100n;

    // Clipped to what is left under the cap, because the contract reverts
    // CapExceeded rather than clipping, and a revert after signing is a
    // confusing dead end for the person.
    const remaining =
      agreement.cap > agreement.totalRepaid
        ? agreement.cap - agreement.totalRepaid
        : 0n;
    const repaymentPaise = share < remaining ? share : remaining;

    if (remaining === 0n) {
      throw new BadRequest(
        "This agreement is fully repaid. Nothing further is owed.",
        "already_repaid",
        409
      );
    }

    const digest = repaymentDigest(
      INCOME_SHARE_ADDRESS as Address,
      monadTestnet.id,
      agreementId,
      Number(agreement.repaymentCount),
      incomePaise,
      repaymentPaise
    );

    const nonce = await reserveNonce({
      did: caller.did,
      action: "attest_income",
      payloadHash: digest,
      ttlSeconds: TTL_SECONDS.attest_income,
    });

    const { error } = await db().from("income_declarations").insert({
      agreement_id: agreementId,
      recipient_did: caller.did,
      for_month: forMonth,
      income_paise: Number(incomePaise),
      source: "self_declared",
      nonce_id: nonce.id,
    });

    if (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new BadRequest(
          "You have already declared income for that month.",
          "already_declared",
          409
        );
      }
      console.error("[attest-income] insert failed", error);
      throw new BadRequest(
        "We couldn't save that. Please try again.",
        "store_failed",
        500
      );
    }

    return ok({
      nonce: nonce.nonce,
      digest,
      index: Number(agreement.repaymentCount),
      incomePaise: incomePaise.toString(),
      repaymentPaise: repaymentPaise.toString(),
      prototype: true,
    });
  } catch (err) {
    return asResponse(err);
  }
});

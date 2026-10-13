/**
 * POST /api/trust/record-repayment — the postman half of feature 04.
 *
 *   { agreementId, nonce, incomePaise, repaymentPaise, signature }
 *     -> { txHash }
 *
 * `IncomeShare.recordRepayment` insists on two things at once: the recipient's
 * signature over the exact figures, and `msg.sender == recorder`. The browser
 * can produce the first and not the second, so the transaction has to come
 * from here.
 *
 * That makes this the one route in the project where the server sends a
 * transaction that moves a record. Worth being exact about what it can and
 * cannot do:
 *
 *   it CANNOT  record a repayment the recipient did not sign for — the
 *              contract recovers the signature and compares it to the
 *              agreement's recipient, so a forged figure simply reverts;
 *   it CAN     refuse to carry a repayment, or carry a stale one the recipient
 *              signed earlier. The contract's own `index` ordering limits the
 *              second: a signature names its position in the sequence, so it
 *              fits exactly one slot and cannot be replayed into another.
 *
 * The nonce is consumed here rather than in `attest-income`, so that one
 * declaration leads to at most one recorded repayment even if the browser
 * retries.
 */
import { handle } from "@/lib/server/trust";
import { consumeNonce } from "@/lib/server/nonce";
import { submitRepayment } from "@/lib/server/chain";
import {
  asResponse,
  body,
  ok,
  readId,
  readPaise,
  readSignature,
  readText,
  BadRequest,
} from "@/lib/server/route-kit";

const MAX_PAISE = 100_000_000_00n;

export const POST = handle(async (request) => {
  try {
    const b = await body(request);
    const agreementId = readId(b, "agreementId");
    const nonce = readText(b, "nonce", 32);
    const incomePaise = readPaise(b, "incomePaise", MAX_PAISE);
    const repaymentPaise = readPaise(b, "repaymentPaise", MAX_PAISE);
    const signature = readSignature(b, "signature");

    if (!/^[0-9a-f]{32}$/.test(nonce)) {
      throw new BadRequest("That request has expired.", "bad_nonce");
    }

    // Consumed BEFORE the transaction is sent. If the send then fails the
    // person has to declare again, which is the right way round: the
    // alternative risks two transactions for one declaration.
    await consumeNonce(nonce);

    const txHash = await submitRepayment({
      agreementId,
      incomePaise,
      repaymentPaise,
      signature,
    });

    return ok({ txHash });
  } catch (err) {
    return asResponse(err);
  }
});

/**
 * POST /api/trust/attest-behaviour — features 02, 03 and 08.
 *
 *   { subject, subjectId, goalId, metric, value, forDay }
 *     -> { nonce, expiry, signature, signalHash, bound }
 *
 * ──────────────── what this actually attests ────────────────
 *
 * That a number was submitted, that it was inside a plausible range, and that
 * it was recorded against one person, one day and one metric. **Not** that the
 * person did the thing. Nothing here talks to a pedometer, a screen-time API,
 * Play Integrity or App Attest. The number arrives from a text box.
 *
 * So why bother signing it at all? Three things it does buy:
 *
 *  - the record cannot be edited afterwards without the hash changing;
 *  - one person cannot submit twice for the same day (a database constraint,
 *    not a check in this file);
 *  - an impossible number is refused at the boundary rather than stored and
 *    discovered later.
 *
 * Features 02 and 03 and 08 all land here because they ask the same question
 * of the same contract. What differs is how the stake is structured on-chain,
 * not how the signal is verified.
 *
 * The UI that calls this says "Prototype: we take your word for it." It has to.
 */
import { handle } from "@/lib/server/trust";
import { db } from "@/lib/server/db";
import { signBehaviour, TTL_SECONDS } from "@/lib/server/trust-signer";
import { reserveNonce, assertNotTooFrequent } from "@/lib/server/nonce";
import {
  asResponse,
  body,
  ok,
  readDay,
  readId,
  readOneOf,
  BadRequest,
} from "@/lib/server/route-kit";
import { BEHAVIOUR_SAVINGS_ADDRESS } from "@/lib/contracts";
import { monadTestnet } from "viem/chains";
import { keccak256, encodeAbiParameters, type Address } from "viem";

const SUBJECTS = ["commitment_goal", "accountability_pool", "savings_goal"] as const;
const METRICS = ["steps", "screen_time_minutes"] as const;

/** The bounds from the brief. Also enforced as a CHECK constraint. */
const BOUNDS: Record<(typeof METRICS)[number], number> = {
  steps: 50_000,
  screen_time_minutes: 1440,
};

export const POST = handle(async (request, { caller }) => {
  try {
    const b = await body(request);
    const subject = readOneOf(b, "subject", SUBJECTS);
    const subjectId = readId(b, "subjectId");
    const goalId = readId(b, "goalId");
    const metric = readOneOf(b, "metric", METRICS);
    const forDay = readDay(b, "forDay");

    const raw = b.value;
    if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 0) {
      throw new BadRequest("That number doesn't look right.", "bad_value");
    }
    const bound = BOUNDS[metric];
    if (raw > bound) {
      // Named rather than clamped. Silently capping a number somebody typed
      // would make a goal look met when the submission was nonsense.
      throw new BadRequest(
        metric === "steps"
          ? `That is more than ${bound.toLocaleString("en-IN")} steps in a day. Please check the number.`
          : "That is more than a whole day. Please check the number.",
        "value_out_of_bounds"
      );
    }

    // A day in the future is not something anybody can report on yet.
    if (forDay > new Date().toISOString().slice(0, 10)) {
      throw new BadRequest(
        "You can't submit for a day that hasn't happened.",
        "day_in_future"
      );
    }

    await assertNotTooFrequent({
      did: caller.did,
      action: "attest_behaviour",
      maxPerHour: 30,
    });

    // What the contract will see. It commits to everything that matters about
    // the submission, so the 32 bytes on-chain are not an opaque token: given
    // the row in `behaviour_signals` anyone can recompute this and check it.
    const signalHash = keccak256(
      encodeAbiParameters(
        [
          { type: "string" },
          { type: "uint256" },
          { type: "string" },
          { type: "string" },
          { type: "uint256" },
          { type: "string" },
        ],
        [subject, BigInt(subjectId), caller.did, metric, BigInt(raw), forDay]
      )
    );

    const auth = await signBehaviour({
      savings: BEHAVIOUR_SAVINGS_ADDRESS as Address,
      chainId: monadTestnet.id,
      goalId,
      signalHash,
    });

    const nonce = await reserveNonce({
      did: caller.did,
      action: "attest_behaviour",
      payloadHash: auth.digest,
      ttlSeconds: TTL_SECONDS.attest_behaviour,
    });

    const { error } = await db().from("behaviour_signals").insert({
      subject,
      subject_id: subjectId,
      member_did: caller.did,
      for_day: forDay,
      metric,
      value: raw,
      bound_applied: bound,
      signal_sha256: signalHash,
      nonce_id: nonce.id,
    });

    if (error) {
      // 23505 is unique_violation: the one-per-day constraint.
      if ((error as { code?: string }).code === "23505") {
        throw new BadRequest(
          "You have already submitted for that day.",
          "already_submitted",
          409
        );
      }
      console.error("[attest-behaviour] insert failed", error);
      throw new BadRequest(
        "We couldn't save that. Please try again.",
        "store_failed",
        500
      );
    }

    return ok({
      nonce: nonce.nonce,
      expiry: auth.expiry,
      signature: auth.signature,
      signalHash,
      bound,
      prototype: true,
    });
  } catch (err) {
    return asResponse(err);
  }
});

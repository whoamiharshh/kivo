/**
 * POST /api/trust/attest-day — feature 03, the group streak pool.
 *
 *   { poolId, forDay, metric, value }
 *     -> { nonce, member, day, expiry, signature, signalHash, bound }
 *
 * ──────────────── why this is not attest-behaviour ────────────────
 *
 * The number is checked the same way (same table, same bounds, same
 * one-per-day rule), but the signature is a different shape. `attest-behaviour`
 * signs a digest bound to BehaviourSavings and a goal; AccountabilityPool
 * wants one bound to the pool contract, the pool id, the MEMBER's address and
 * the day. Signing the wrong one is not a soft failure — the contract rejects
 * it — so the two live in separate files rather than behind a flag.
 *
 * ──────────────── what it actually attests ────────────────
 *
 * That this person submitted a plausible number for a day that has already
 * happened, once. **Not** that they walked, slept or stayed off their phone.
 * The figure comes from a text box; nothing here reads a pedometer or a device
 * attestation. `docs/trust-layer.md` carries the full list.
 *
 * One deliberate narrowing: `attestDay` on-chain accepts a submission from
 * anybody holding a valid signature, but this route only ever signs for
 * `caller.address`. So a signature exists only for the person who typed the
 * number, and a member cannot bank a day on a friend's behalf.
 */
import { handle } from "@/lib/server/trust";
import { db } from "@/lib/server/db";
import { signPoolDay, dayNumber, TTL_SECONDS } from "@/lib/server/trust-signer";
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
import { ACCOUNTABILITY_POOL_ADDRESS, isSet } from "@/lib/contracts";
import { monadTestnet } from "viem/chains";
import { keccak256, encodeAbiParameters, type Address } from "viem";
import { logServerError } from "@/lib/server/logging";

const METRICS = ["steps", "screen_time_minutes"] as const;

/** The bounds from the brief. Also enforced as a CHECK constraint. */
const BOUNDS: Record<(typeof METRICS)[number], number> = {
  steps: 50_000,
  screen_time_minutes: 1440,
};

export const POST = handle(async (request, { caller }) => {
  try {
    if (!isSet(ACCOUNTABILITY_POOL_ADDRESS)) {
      throw new BadRequest(
        "Group streaks aren't set up yet.",
        "pool_not_configured",
        503
      );
    }

    const b = await body(request);
    const poolId = readId(b, "poolId");
    const forDay = readDay(b, "forDay");
    const metric = readOneOf(b, "metric", METRICS);

    const raw = b.value;
    if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 0) {
      throw new BadRequest("That number doesn't look right.", "bad_value");
    }
    const bound = BOUNDS[metric];
    if (raw > bound) {
      // Named rather than clamped: silently capping a typo would let a day
      // count as kept on a number nobody meant.
      throw new BadRequest(
        metric === "steps"
          ? `That is more than ${bound.toLocaleString("en-IN")} steps in a day. Please check the number.`
          : "That is more than a whole day. Please check the number.",
        "value_out_of_bounds"
      );
    }

    // A day nobody has lived through yet is not reportable. The member's own
    // date decides this, which is also how `dayNumber` is read on-chain; see
    // the note on `poolAttestationDigest`.
    if (forDay > new Date().toISOString().slice(0, 10)) {
      throw new BadRequest(
        "You can't submit for a day that hasn't happened.",
        "day_in_future"
      );
    }

    await assertNotTooFrequent({
      did: caller.did,
      action: "attest_day",
      maxPerHour: 30,
    });

    // Commits to everything that matters about the submission, so the row in
    // `behaviour_signals` is enough for anyone to recompute and check it.
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
        [
          "accountability_pool",
          BigInt(poolId),
          caller.did,
          metric,
          BigInt(raw),
          forDay,
        ]
      )
    );

    const day = dayNumber(forDay);
    const auth = await signPoolDay({
      poolAddress: ACCOUNTABILITY_POOL_ADDRESS as Address,
      chainId: monadTestnet.id,
      poolId,
      member: caller.address as Address,
      day,
    });

    const nonce = await reserveNonce({
      did: caller.did,
      action: "attest_day",
      payloadHash: auth.digest,
      ttlSeconds: TTL_SECONDS.attest_day,
    });

    const { error } = await db().from("behaviour_signals").insert({
      subject: "accountability_pool",
      subject_id: poolId,
      member_did: caller.did,
      for_day: forDay,
      metric,
      value: raw,
      bound_applied: bound,
      signal_sha256: signalHash,
      nonce_id: nonce.id,
    });

    if (error) {
      // 23505 is unique_violation: the one-per-day constraint. The contract
      // refuses a second attestation for the same day too, so this is the
      // same rule stated twice on purpose.
      if ((error as { code?: string }).code === "23505") {
        throw new BadRequest(
          "You have already submitted for that day.",
          "already_submitted",
          409
        );
      }
      logServerError("attest-day insert failed", error);
      throw new BadRequest(
        "We couldn't save that. Please try again.",
        "store_failed",
        500
      );
    }

    return ok({
      nonce: nonce.nonce,
      member: caller.address,
      day,
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

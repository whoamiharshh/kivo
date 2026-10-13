/**
 * POST /api/trust/attest-condition — feature 05.
 *
 *   { giftId, evidenceHash }
 *     -> { nonce, expiry, signature }
 *
 * A gift is held until its condition is attested. This route is the attester.
 *
 * ──────────────── what makes this one better than the others ────────────────
 *
 * The condition hash is read FROM THE CHAIN, not from the request. The sender
 * fixed it when they created the gift, so an attestation can only ever commit
 * to the condition that was actually set — a recipient cannot hand over a
 * different condition hash and have it signed. That is a real property, and it
 * is why `Gift.attestCondition` is permissionless: the signature is the
 * authority, so the recipient can submit it themselves and does not have to
 * wait on anybody.
 *
 * ──────────────── what is still only a promise ────────────────
 *
 * Whether the condition HAPPENED is not checked by anything. `evidenceHash`
 * commits to whatever the submitter says the evidence is; the server does not
 * look at it, and could not judge it if it did. In a real deployment the
 * attester is a named person or an organisation who looked — a tutor
 * confirming a grade, a clinic confirming an appointment. Here it is this
 * server, which is why the attester inbox screen says so.
 */
import { handle } from "@/lib/server/trust";
import { db } from "@/lib/server/db";
import { signCondition, TTL_SECONDS } from "@/lib/server/trust-signer";
import { reserveNonce, assertNotTooFrequent } from "@/lib/server/nonce";
import { giftConditionHash } from "@/lib/server/chain";
import {
  asResponse,
  body,
  ok,
  readHash,
  readId,
  BadRequest,
} from "@/lib/server/route-kit";
import { GIFT_ADDRESS } from "@/lib/contracts";
import { monadTestnet } from "viem/chains";
import type { Address } from "viem";
import { logServerError } from "@/lib/server/logging";

export const POST = handle(async (request, { caller }) => {
  try {
    const b = await body(request);
    const giftId = readId(b, "giftId");
    const evidenceHash = readHash(b, "evidenceHash");

    await assertNotTooFrequent({
      did: caller.did,
      action: "attest_condition",
      maxPerHour: 30,
    });

    // From the chain. Never from the body: see the note above.
    const conditionHash = await giftConditionHash(giftId);

    const auth = await signCondition({
      gift: GIFT_ADDRESS as Address,
      chainId: monadTestnet.id,
      giftId,
      conditionHash,
    });

    const nonce = await reserveNonce({
      did: caller.did,
      action: "attest_condition",
      payloadHash: auth.digest,
      ttlSeconds: TTL_SECONDS.attest_condition,
    });

    // Recorded so the attestation has a provenance, and so the gift detail
    // screen can say who attested and when rather than only that it happened.
    // `upsert` because the condition row may already exist from gift creation.
    const { error } = await db()
      .from("gift_conditions")
      .upsert(
        {
          gift_id: giftId,
          condition_text: "(set when the gift was created)",
          condition_hash: conditionHash,
          evidence_hash: evidenceHash,
          attester_did: caller.did,
          attested_at: new Date().toISOString(),
          nonce_id: nonce.id,
        },
        { onConflict: "gift_id" }
      );

    if (error) {
      logServerError("attest-condition store failed", error);
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
      conditionHash,
      prototype: true,
    });
  } catch (err) {
    return asResponse(err);
  }
});

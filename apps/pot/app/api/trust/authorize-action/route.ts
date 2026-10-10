/**
 * POST /api/trust/authorize-action
 *
 * The one entry point for "the server has checked something the chain cannot,
 * and will put its name to it". Today it authorises one action; the shape is
 * built to take more without a second route appearing.
 *
 *   { action: "join_pot", potId, inviteCode }
 *     -> { nonce, expiry, signature }
 *
 * The caller's wallet address is NEVER read from the body. It comes from the
 * verified Privy identity token, which is the whole difference between
 * authorising the person who asked and authorising whoever they name.
 */
import { handle } from "@/lib/server/trust";
import { db } from "@/lib/server/db";
import { signJoin, TTL_SECONDS } from "@/lib/server/trust-signer";
import { reserveNonce, assertNotTooFrequent } from "@/lib/server/nonce";
import {
  asResponse,
  body,
  ok,
  readHash,
  readId,
  readOneOf,
  BadRequest,
} from "@/lib/server/route-kit";
import { POT_MANAGER_ADDRESS } from "@/lib/contracts";
import { monadTestnet } from "viem/chains";
import type { Address } from "viem";

const ACTIONS = ["join_pot"] as const;

export const POST = handle(async (request, { caller }) => {
  try {
    const b = await body(request);
    const action = readOneOf(b, "action", ACTIONS);

    // Generous enough that somebody retrying a flaky link never notices, tight
    // enough that nobody farms authorizations. Counted from the nonce ledger,
    // so it holds across restarts and across instances.
    await assertNotTooFrequent({ did: caller.did, action, maxPerHour: 60 });

    if (action === "join_pot") {
      const potId = readId(b, "potId");
      if (potId === 0) {
        throw new BadRequest("That invite link doesn't look right.", "bad_potId");
      }
      const inviteCode = readHash(b, "inviteCode");

      // The only read of the private table anywhere in this codebase.
      const { data, error } = await db()
        .from("pots_private")
        .select("invite_code")
        .eq("pot_id", potId)
        .maybeSingle();

      if (error) {
        console.error("[authorize-action] lookup failed", error);
        throw new BadRequest(
          "Something went wrong. Please try again.",
          "lookup_failed",
          500
        );
      }

      // "No such pot" and "wrong code" answer identically, so this endpoint
      // cannot be used to find out which pots exist.
      const stored = data?.invite_code;
      if (!stored || stored.toLowerCase() !== inviteCode.toLowerCase()) {
        throw new BadRequest(
          "That invite link isn't valid.",
          "invite_rejected",
          403
        );
      }

      const auth = await signJoin({
        potManager: POT_MANAGER_ADDRESS as Address,
        chainId: monadTestnet.id,
        potId,
        joiner: caller.address as Address,
      });

      // Recorded BEFORE the signature leaves, so no signature exists in the
      // world without a row explaining where it came from.
      const nonce = await reserveNonce({
        did: caller.did,
        action,
        payloadHash: auth.digest,
        ttlSeconds: TTL_SECONDS.join_pot,
      });

      return ok({
        nonce: nonce.nonce,
        expiry: auth.expiry,
        signature: auth.signature,
      });
    }

    // Unreachable while ACTIONS has one member; kept so that adding one without
    // a branch is a 400 rather than a 200 with an empty body.
    throw new BadRequest("That action isn't supported.", "unknown_action");
  } catch (err) {
    return asResponse(err);
  }
});

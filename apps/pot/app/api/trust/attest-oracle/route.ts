/**
 * POST /api/trust/attest-oracle — feature 07, PROTOTYPE MODE.
 *
 *   { policyId, eventType, eventOccurred, payoutPaise }
 *     -> { nonce, signature, payoutPaise } | { declined: true }
 *
 * ──────────────── what this really is ────────────────
 *
 * **A button.** Somebody presses "the event happened" and this route signs a
 * settlement authorization. There is no weather feed, no flight API, no
 * Chainlink, no insurer. `oracle_events.source` records `'simulated'` and the
 * UI says "Prototype: the trigger is simulated."
 *
 * On a real product this signature comes from an IRDAI-licensed insurer's
 * claims-signing key, and **producing it is the regulated act of adjudicating
 * a claim.** That is not a detail this app can take over by writing better
 * code: see docs/limitations.md, "What requires an IRDAI-licensed insurer".
 *
 * ──────────────── what is nonetheless enforced ────────────────
 *
 * Even a simulated trigger goes through the real rails, so the demo exercises
 * the same code a licensed insurer would:
 *
 *  - the evidence hash comes from the chain's claim record, so a claimant
 *    cannot choose what their own claim is said to contain;
 *  - the payout is checked against the policy's coverage here, and checked
 *    again by the contract, which reverts `PayoutAboveCoverage`;
 *  - a decision is recorded once per policy and event type, so the same
 *    "event" cannot be triggered twice;
 *  - `eventOccurred: false` produces NO signature. A declined claim must not
 *    come back with a payout authorization attached to it.
 */
import { handle } from "@/lib/server/trust";
import { db } from "@/lib/server/db";
import { signSettlement, TTL_SECONDS } from "@/lib/server/trust-signer";
import { reserveNonce, assertNotTooFrequent } from "@/lib/server/nonce";
import { claimFacts } from "@/lib/server/chain";
import {
  asResponse,
  body,
  ok,
  readBool,
  readId,
  readPaise,
  readText,
  BadRequest,
} from "@/lib/server/route-kit";
import { MICRO_COVER_ADDRESS } from "@/lib/contracts";
import { monadTestnet } from "viem/chains";
import type { Address } from "viem";

const MAX_PAISE = 100_000_000_00n;

export const POST = handle(async (request, { caller }) => {
  try {
    const b = await body(request);
    const policyId = readId(b, "policyId");
    const eventType = readText(b, "eventType", 60);
    const eventOccurred = readBool(b, "eventOccurred");

    await assertNotTooFrequent({
      did: caller.did,
      action: "attest_oracle",
      maxPerHour: 20,
    });

    // From the chain: the claim's evidence hash, and what the policy covers.
    const facts = await claimFacts(policyId);

    if (facts.insured.toLowerCase() !== caller.address.toLowerCase()) {
      // In the prototype only the insured can press the button, so one person
      // cannot trigger a payout on somebody else's policy. On a real product
      // this check is irrelevant, because the caller would be the insurer.
      throw new BadRequest(
        "That policy isn't yours.",
        "not_your_policy",
        403
      );
    }

    // Record the decision first, whichever way it went. A declined event is
    // part of the record, not an absence from it.
    const payoutPaise = eventOccurred
      ? readPaise(b, "payoutPaise", MAX_PAISE)
      : 0n;

    if (eventOccurred && payoutPaise === 0n) {
      throw new BadRequest(
        "A payout of nothing is not a payout.",
        "zero_payout"
      );
    }
    if (payoutPaise > facts.coverage) {
      throw new BadRequest(
        "That is more than this policy covers.",
        "above_coverage"
      );
    }

    let nonceId: number | null = null;
    let signature: string | null = null;
    let expiry: number | null = null;
    let nonceValue: string | null = null;

    if (eventOccurred) {
      const auth = await signSettlement({
        microCover: MICRO_COVER_ADDRESS as Address,
        chainId: monadTestnet.id,
        policyId,
        evidenceHash: facts.evidenceHash,
        payoutAmount: payoutPaise,
      });
      const nonce = await reserveNonce({
        did: caller.did,
        action: "attest_oracle",
        payloadHash: auth.digest,
        ttlSeconds: TTL_SECONDS.attest_oracle,
      });
      nonceId = nonce.id;
      nonceValue = nonce.nonce;
      signature = auth.signature;
      expiry = auth.expiry;
    }

    const { error } = await db().from("oracle_events").insert({
      policy_id: policyId,
      event_type: eventType,
      event_occurred: eventOccurred,
      source: "simulated",
      payout_paise: Number(payoutPaise),
      nonce_id: nonceId,
    });

    if (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new BadRequest(
          "That event has already been decided for this policy.",
          "already_decided",
          409
        );
      }
      console.error("[attest-oracle] store failed", error);
      throw new BadRequest(
        "We couldn't save that. Please try again.",
        "store_failed",
        500
      );
    }

    if (!eventOccurred) {
      // No signature, on purpose. Nothing here can be used to collect.
      return ok({ declined: true, prototype: true });
    }

    return ok({
      nonce: nonceValue,
      expiry,
      signature,
      payoutPaise: payoutPaise.toString(),
      prototype: true,
    });
  } catch (err) {
    return asResponse(err);
  }
});

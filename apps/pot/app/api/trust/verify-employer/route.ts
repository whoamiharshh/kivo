/**
 * POST /api/trust/verify-employer — feature 06.
 *
 *   { employerAddress, entityProof, proofKind }
 *     -> { nonce, signature, verified: false }
 *
 * ──────────────── the name of this route is a promise it cannot keep ────────
 *
 * It is called `verify-employer` because the brief calls it that. It does not
 * verify an employer. It records what an employer typed about itself, signs
 * the record so it cannot be altered afterwards without detection, and
 * returns `verified: false` — a field that is hardcoded, not computed, and
 * will stay false until something here actually contacts a registry.
 *
 * Nothing in this repository talks to the GST portal or the MCA register. A
 * GSTIN is checked for SHAPE and nothing else. Somebody can type a real
 * company's real number and be recorded as that company.
 *
 * ──────────────── so what protects the employee? ────────────────
 *
 * Not this. `SalaryStream` verifies no signatures at all — it has no employer
 * registry and no code path that consults one — so no contract will ever
 * refuse a stream because of what is or is not stored here.
 *
 * What does protect the employee is in the contract and needs no attestation:
 * a stream only ever pays out of money the employer has already put in, the
 * employee withdraws what has accrued without asking anyone, and the stream
 * pauses when the funded balance runs below the configured number of days'
 * runway. An unverified employer who funds a stream can still be trusted for
 * exactly as much as they funded, which is the only number that matters.
 *
 * The employer dashboard says all of this on the screen. It must keep saying
 * it: an "employer verified" badge over this data would be a lie.
 */
import { handle } from "@/lib/server/trust";
import { db } from "@/lib/server/db";
import {
  signEmployerAttestation,
  TTL_SECONDS,
} from "@/lib/server/trust-signer";
import { reserveNonce, assertNotTooFrequent } from "@/lib/server/nonce";
import {
  asResponse,
  body,
  ok,
  readOneOf,
  readText,
  BadRequest,
} from "@/lib/server/route-kit";
import { monadTestnet } from "viem/chains";
import { keccak256, toBytes, type Address } from "viem";

const KINDS = ["self_asserted", "gst", "cin"] as const;

/** Shape only. A number that looks like a GSTIN is not a verified GSTIN. */
const SHAPES: Record<(typeof KINDS)[number], RegExp> = {
  self_asserted: /^.{1,200}$/,
  gst: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/,
  cin: /^[LUu][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/,
};

export const POST = handle(async (request, { caller }) => {
  try {
    const b = await body(request);
    const entityProof = readText(b, "entityProof", 200);
    const proofKind = readOneOf(b, "proofKind", KINDS);

    const raw = b.employerAddress;
    if (typeof raw !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(raw)) {
      throw new BadRequest(
        "That address doesn't look right.",
        "bad_employerAddress"
      );
    }
    const employerAddress = raw.toLowerCase() as Address;

    // An employer may only register the account it is signed in as. Otherwise
    // one person could attach their own claimed identity to somebody else's
    // funding account.
    if (employerAddress !== caller.address.toLowerCase()) {
      throw new BadRequest(
        "You can only register the account you are signed in with.",
        "not_your_account",
        403
      );
    }

    if (!SHAPES[proofKind].test(entityProof)) {
      throw new BadRequest(
        proofKind === "gst"
          ? "That doesn't look like a GST number."
          : "That doesn't look like a company number.",
        "bad_proof_shape"
      );
    }

    await assertNotTooFrequent({
      did: caller.did,
      action: "verify_employer",
      maxPerHour: 10,
    });

    const proofHash = keccak256(toBytes(`${proofKind}:${entityProof}`));
    const auth = await signEmployerAttestation({
      chainId: monadTestnet.id,
      employer: employerAddress,
      proofHash,
    });

    const nonce = await reserveNonce({
      did: caller.did,
      action: "verify_employer",
      payloadHash: auth.digest,
      ttlSeconds: TTL_SECONDS.verify_employer,
    });

    const { error } = await db()
      .from("employer_attestations")
      .upsert(
        {
          employer_address: employerAddress,
          owner_did: caller.did,
          entity_proof: entityProof,
          proof_kind: proofKind,
          // Hardcoded. Not a computation. See the note at the top.
          verified: false,
          nonce_id: nonce.id,
        },
        { onConflict: "employer_address" }
      );

    if (error) {
      console.error("[verify-employer] store failed", error);
      throw new BadRequest(
        "We couldn't save that. Please try again.",
        "store_failed",
        500
      );
    }

    return ok({
      nonce: nonce.nonce,
      signature: auth.signature,
      issuedAt: auth.issuedAt,
      // Said out loud in the response, so a client cannot read a success
      // status as a verification.
      verified: false,
      prototype: true,
    });
  } catch (err) {
    return asResponse(err);
  }
});

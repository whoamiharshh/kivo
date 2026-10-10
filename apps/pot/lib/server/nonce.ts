/**
 * The nonce ledger.
 *
 * One row per signature the trust layer issues, written BEFORE the signature
 * goes out. Three jobs:
 *
 *  1. **Replay protection at the API boundary.** A nonce is handed out once and
 *     consumed once. Asking twice with the same nonce gets nothing.
 *  2. **An audit trail.** Every row says which DID asked, for what action, over
 *     what payload hash, and when. If a signature ever turns up somewhere
 *     surprising, there is a row explaining where it came from.
 *  3. **A rate-limit substrate.** Counting a DID's recent rows for an action is
 *     how the routes stop somebody minting a thousand attestations a minute.
 *
 * ──────────────── the limit of what this buys ────────────────
 *
 * Be precise about this, because it is easy to oversell. For `join_pot` the
 * expiry is also checked by the contract, so an expired authorization is dead
 * everywhere. For the other actions the contract takes no expiry argument, so
 * marking a nonce used here does NOT make the signature unusable on-chain. What
 * stops a replay there is the contract's own one-shot rule for the record the
 * signature names: a goal can only be verified once (`AlreadyVerified`), a gift
 * can only be attested once, a claim can only be settled once. This ledger
 * stops the API being used as a signature vending machine; the contract stops
 * the signature being used twice. Both are needed and neither is sufficient.
 */
import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "./db";
import type { TrustAction } from "./trust-signer";

export type NonceRecord = {
  id: number;
  nonce: string;
  expiresAt: Date;
};

/** 16 bytes from the OS. Matches the column's `^[0-9a-f]{32}$` check. */
function freshNonce(): string {
  return randomBytes(16).toString("hex");
}

export class NonceError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason: string
  ) {
    super(message);
    this.name = "NonceError";
  }
}

/**
 * Reserve a nonce for a signature that is about to be issued.
 *
 * Written before signing on purpose. If the insert fails, no signature is
 * produced — the alternative (sign first, record afterwards) would leave
 * signatures in the world with no row explaining them, which is the one state
 * this ledger exists to prevent.
 */
export async function reserveNonce(args: {
  did: string;
  action: TrustAction;
  payloadHash: string;
  ttlSeconds: number;
}): Promise<NonceRecord> {
  const expiresAt = new Date(Date.now() + args.ttlSeconds * 1000);

  const { data, error } = await db()
    .from("trust_nonces")
    .insert({
      nonce: freshNonce(),
      signer_did: args.did,
      action_type: args.action,
      payload_hash: args.payloadHash,
      expires_at: expiresAt.toISOString(),
    })
    .select("id,nonce,expires_at")
    .single();

  if (error || !data) {
    console.error("[nonce] could not reserve", error);
    throw new NonceError(
      "Something went wrong. Please try again.",
      500,
      "nonce_reserve_failed"
    );
  }

  return { id: data.id, nonce: data.nonce, expiresAt: new Date(data.expires_at) };
}

/**
 * Mark a reserved nonce as used.
 *
 * Conditional on `used_at is null`, so two concurrent requests cannot both
 * succeed: whichever update matches zero rows is the loser and is told so.
 */
export async function consumeNonce(nonce: string): Promise<void> {
  const { data, error } = await db()
    .from("trust_nonces")
    .update({ used_at: new Date().toISOString() })
    .eq("nonce", nonce)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("id");

  if (error) {
    console.error("[nonce] could not consume", error);
    throw new NonceError(
      "Something went wrong. Please try again.",
      500,
      "nonce_consume_failed"
    );
  }
  if (!data || data.length === 0) {
    throw new NonceError(
      "That request has already been used. Please start again.",
      409,
      "nonce_already_used"
    );
  }
}

/**
 * Refuse a DID that is asking for the same kind of signature too often.
 *
 * Counted from the ledger rather than from memory, so it survives a restart
 * and holds across however many server instances are running. The audit found
 * the previous in-memory limiter bypassable for exactly this reason (H-5).
 */
export async function assertNotTooFrequent(args: {
  did: string;
  action: TrustAction;
  maxPerHour: number;
}): Promise<void> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { count, error } = await db()
    .from("trust_nonces")
    .select("id", { count: "exact", head: true })
    .eq("signer_did", args.did)
    .eq("action_type", args.action)
    .gte("created_at", since);

  if (error) {
    // Fail CLOSED. A limiter that waves everything through when the database
    // hiccups is not a limiter.
    console.error("[nonce] could not count", error);
    throw new NonceError(
      "Something went wrong. Please try again.",
      500,
      "rate_check_failed"
    );
  }

  if ((count ?? 0) >= args.maxPerHour) {
    throw new NonceError(
      "That is a lot of requests in one hour. Try again later.",
      429,
      "rate_limited"
    );
  }
}

"use client";

/**
 * Talking to the trust layer from the browser.
 *
 * One `post` helper, one place where 401 / 403 / 409 / 429 / 500 / offline /
 * unparseable-body all turn into a sentence a person can act on, and one rule
 * that matters more than the rest:
 *
 *   **a response without a usable signature is an error, not a success.**
 *
 * Every function below checks the shape of what came back before returning it.
 * Letting an `undefined` signature through to a contract call produces an
 * opaque revert several seconds later, which is the worst possible place to
 * discover that a route had a bad day.
 */
import { getAccessToken, getIdentityToken } from "@privy-io/react-auth";

export class TrustCallError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason?: string
  ) {
    super(message);
    this.name = "TrustCallError";
  }
}

function messageFor(status: number, fromServer?: string): string {
  if (fromServer) return fromServer;
  if (status === 401) return "Please sign in again.";
  if (status === 403) return "That isn't allowed.";
  if (status === 409) return "That has already been done.";
  if (status === 429) return "Too many tries. Wait a minute and try again.";
  if (status >= 500) return "Something went wrong. Please try again.";
  return "That didn't work. Please try again.";
}

async function post<T>(path: string, payload: unknown): Promise<T> {
  const [accessToken, identityToken] = await Promise.all([
    getAccessToken(),
    getIdentityToken(),
  ]);

  // Caught here rather than at the server, so a signed-out person gets a
  // sentence instead of a 401 round trip.
  if (!accessToken || !identityToken) {
    throw new TrustCallError("Please sign in again.", 401, "no_session");
  }

  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
        "x-privy-id-token": identityToken,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new TrustCallError(
      "We couldn't reach the server. Check that you're online and try again.",
      0,
      "network"
    );
  }

  // A 500 can arrive as an HTML error page, so parsing is guarded separately
  // from the status check.
  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }
  const rec = (parsed ?? {}) as Record<string, unknown>;

  if (!response.ok) {
    throw new TrustCallError(
      messageFor(
        response.status,
        typeof rec.error === "string" ? rec.error : undefined
      ),
      response.status,
      typeof rec.reason === "string" ? rec.reason : undefined
    );
  }

  return parsed as T;
}

const SIG = /^0x[0-9a-fA-F]{130}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;

function needSignature(v: unknown, what: string): `0x${string}` {
  if (typeof v !== "string" || !SIG.test(v)) {
    throw new TrustCallError(
      `The server didn't approve that ${what}. Please try again.`,
      502,
      "no_signature"
    );
  }
  return v as `0x${string}`;
}

function needHash(v: unknown, what: string): `0x${string}` {
  if (typeof v !== "string" || !HASH.test(v)) {
    throw new TrustCallError(
      `The server didn't return a usable ${what}. Please try again.`,
      502,
      "no_hash"
    );
  }
  return v as `0x${string}`;
}

function needExpiry(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
    throw new TrustCallError(
      "The server didn't approve that. Please try again.",
      502,
      "no_expiry"
    );
  }
  return v;
}

// ═══════════════ feature 01: joining a pot ═══════════════

export type JoinAuthorization = { expiry: number; signature: `0x${string}` };

export async function authorizeJoin(
  potId: number,
  inviteCode: `0x${string}`
): Promise<JoinAuthorization> {
  const r = await post<Record<string, unknown>>("/api/trust/authorize-action", {
    action: "join_pot",
    potId,
    inviteCode,
  });
  return {
    expiry: needExpiry(r.expiry),
    signature: needSignature(r.signature, "invite"),
  };
}

/**
 * The generic form, for anything added later. Exported because the brief asks
 * for `authorizeAction(action, payload)`; `authorizeJoin` is the typed
 * specialisation that the app actually calls.
 */
export async function authorizeAction(
  action: string,
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  return post<Record<string, unknown>>("/api/trust/authorize-action", {
    action,
    ...payload,
  });
}

// ═══════════════ features 02 / 03 / 08: behaviour ═══════════════

export type BehaviourSubject =
  | "commitment_goal"
  | "accountability_pool"
  | "savings_goal";
export type BehaviourMetric = "steps" | "screen_time_minutes";

export type BehaviourAttestation = {
  expiry: number;
  signature: `0x${string}`;
  signalHash: `0x${string}`;
  bound: number;
};

/**
 * Submit today's number and get the attestation the contract wants.
 *
 * `forDay` defaults to today in the BROWSER's timezone, deliberately: a
 * student in Delhi submitting at 11pm means today for them, and a server
 * computing UTC midnight would file it as tomorrow. The server rejects a
 * future day, so the worst a skewed clock does is get a submission refused.
 */
export async function attestBehaviour(args: {
  subject: BehaviourSubject;
  subjectId: number;
  goalId: number;
  metric: BehaviourMetric;
  value: number;
  forDay?: string;
}): Promise<BehaviourAttestation> {
  const forDay = args.forDay ?? localToday();
  const r = await post<Record<string, unknown>>(
    "/api/trust/attest-behaviour",
    { ...args, forDay }
  );
  return {
    expiry: needExpiry(r.expiry),
    signature: needSignature(r.signature, "submission"),
    signalHash: needHash(r.signalHash, "signal"),
    bound: typeof r.bound === "number" ? r.bound : 0,
  };
}

/** Today where the person is, as YYYY-MM-DD. */
export function localToday(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ═══════════════ feature 04: income ═══════════════

export type IncomeDeclaration = {
  nonce: string;
  digest: `0x${string}`;
  index: number;
  incomePaise: string;
  repaymentPaise: string;
};

/**
 * Declare a month's income. Returns the digest the RECIPIENT must sign with
 * their own wallet — the server does not and cannot sign this one.
 */
export async function attestIncome(
  agreementId: number,
  incomePaise: bigint,
  forMonth: string
): Promise<IncomeDeclaration> {
  const r = await post<Record<string, unknown>>("/api/trust/attest-income", {
    agreementId,
    incomePaise: incomePaise.toString(),
    forMonth,
  });
  if (typeof r.nonce !== "string" || !/^[0-9a-f]{32}$/.test(r.nonce)) {
    throw new TrustCallError(
      "The server didn't approve that declaration. Please try again.",
      502,
      "no_nonce"
    );
  }
  return {
    nonce: r.nonce,
    digest: needHash(r.digest, "confirmation"),
    index: typeof r.index === "number" ? r.index : 0,
    incomePaise: String(r.incomePaise ?? "0"),
    repaymentPaise: String(r.repaymentPaise ?? "0"),
  };
}

/** Hand the recipient's signed confirmation back so the server can record it. */
export async function recordRepayment(args: {
  agreementId: number;
  nonce: string;
  incomePaise: string;
  repaymentPaise: string;
  signature: `0x${string}`;
}): Promise<{ txHash: `0x${string}` }> {
  const r = await post<Record<string, unknown>>(
    "/api/trust/record-repayment",
    args
  );
  if (typeof r.txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(r.txHash)) {
    throw new TrustCallError(
      "We couldn't tell whether that was recorded. Check the agreement before trying again.",
      502,
      "no_tx"
    );
  }
  return { txHash: r.txHash as `0x${string}` };
}

// ═══════════════ feature 05: gift conditions ═══════════════

export async function attestCondition(
  giftId: number,
  evidenceHash: `0x${string}`
): Promise<{ expiry: number; signature: `0x${string}` }> {
  const r = await post<Record<string, unknown>>(
    "/api/trust/attest-condition",
    { giftId, evidenceHash }
  );
  return {
    expiry: needExpiry(r.expiry),
    signature: needSignature(r.signature, "attestation"),
  };
}

// ═══════════════ feature 07: the simulated oracle ═══════════════

export type OracleOutcome =
  | { declined: true }
  | { declined: false; signature: `0x${string}`; payoutPaise: string };

/**
 * Trigger the prototype oracle.
 *
 * A declined event returns NO signature, and the union above forces callers to
 * handle that rather than reaching for a signature that is not there.
 */
export async function attestOracle(args: {
  policyId: number;
  eventType: string;
  eventOccurred: boolean;
  payoutPaise?: bigint;
}): Promise<OracleOutcome> {
  const r = await post<Record<string, unknown>>("/api/trust/attest-oracle", {
    policyId: args.policyId,
    eventType: args.eventType,
    eventOccurred: args.eventOccurred,
    ...(args.payoutPaise !== undefined
      ? { payoutPaise: args.payoutPaise.toString() }
      : {}),
  });

  if (r.declined === true) return { declined: true };

  return {
    declined: false,
    signature: needSignature(r.signature, "claim"),
    payoutPaise: String(r.payoutPaise ?? "0"),
  };
}

// ═══════════════ feature 06: employer records ═══════════════

/**
 * Record what an employer says about itself.
 *
 * Returns `verified: false`, always. The name of the route says "verify" and
 * the return value says what actually happened; believe the return value.
 */
export async function verifyEmployer(args: {
  employerAddress: `0x${string}`;
  entityProof: string;
  proofKind: "self_asserted" | "gst" | "cin";
}): Promise<{ verified: false; signature: `0x${string}` }> {
  const r = await post<Record<string, unknown>>(
    "/api/trust/verify-employer",
    args
  );
  return {
    verified: false,
    signature: needSignature(r.signature, "registration"),
  };
}

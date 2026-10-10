/**
 * The trust layer's rules, in one place.
 *
 * Recipient verification, send limits, the step-up policy, and the audit trail.
 * Route handlers are thin wrappers around these; nothing here trusts a value
 * that came from the browser except as a hint to be looked up.
 */
import "server-only";
import {
  db,
  type AuditEvent,
  type PaymentRow,
  type SendLimitsRow,
  type UserRow,
} from "./db";
import type { Json } from "./database.types";
import { CallerError, verifyCaller, type Caller } from "./privy";
import {
  assertIpUnderLimit,
  assertSameOrigin,
  GuardError,
  hashedIp,
} from "./guards";

/** A rule was broken. Carries a status and a machine-readable reason. */
export class TrustError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 429,
    readonly reason: string
  ) {
    super(message);
    this.name = "TrustError";
  }
}

/** The configured limits, read from the database rather than hardcoded. */
export async function getLimits(): Promise<SendLimitsRow> {
  const { data, error } = await db()
    .from("send_limits")
    .select("*")
    .limit(1)
    .single();
  if (error || !data) {
    throw new Error(`Send limits are not configured: ${error?.message}`);
  }
  return data as unknown as SendLimitsRow;
}

/**
 * Record (or refresh) the DID → address mapping from Privy's own record.
 *
 * Called on every authenticated request, so the mapping cannot drift and a
 * first-time caller is registered without a separate signup step. The address
 * and the passkey flag come from `verifyCaller`, which read them out of a
 * Privy-signed identity token — not from the request body.
 */
export async function ensureUser(caller: Caller): Promise<UserRow> {
  const { data, error } = await db()
    .from("users")
    .upsert(
      {
        did: caller.did,
        address: caller.address,
        passkey_enrolled: caller.hasPasskey,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "did" }
    )
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`Could not record your account: ${error?.message}`);
  }
  return data as unknown as UserRow;
}

/** Someone the money can actually reach. */
export type ResolvedRecipient =
  | { kind: "direct"; user: UserRow }
  | { kind: "claimable"; hint: string };

/**
 * Work out who a payment is for.
 *
 * A registered handle resolves to that person's verified address. Anything else
 * — an unknown handle, an email, a phone number — becomes a claimable payment
 * that the recipient must register to collect.
 *
 * A manually typed address is deliberately NOT accepted as a direct recipient
 * (§1.2): we have no way to know it belongs to a real person who can claim it,
 * so routing it through the claimable path is the only safe option.
 */
export async function resolveRecipient(
  raw: string,
  sender: UserRow
): Promise<ResolvedRecipient> {
  const hint = raw.trim();
  if (!hint) throw new TrustError("Who is this for?", 400, "missing_recipient");
  if (hint.length > 120) {
    throw new TrustError(
      "That recipient is too long.",
      400,
      "recipient_too_long"
    );
  }

  const handle = hint.replace(/^@/, "").toLowerCase();
  if (/^[a-z0-9_]{3,20}$/.test(handle)) {
    const { data } = await db()
      .from("users")
      .select("*")
      .eq("handle", handle)
      .maybeSingle();

    if (data) {
      const user = data as unknown as UserRow;
      if (user.did === sender.did) {
        throw new TrustError(
          "You can't send money to yourself.",
          400,
          "self_payment"
        );
      }
      return { kind: "direct", user };
    }
  }

  return { kind: "claimable", hint };
}

/**
 * The friendly half of rate limiting.
 *
 * The database enforces these with a BEFORE INSERT trigger, which is what
 * actually stops a race or a direct write. This check exists so the person gets
 * a sentence they can act on instead of a constraint violation, and so the
 * refusal lands in the audit log before any money moves.
 */
export async function assertWithinLimits(
  sender: UserRow,
  recipientDid: string | null,
  amountPaise: number,
  limits: SendLimitsRow
): Promise<void> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const since = startOfDay.toISOString();

  const { data: todays } = await db()
    .from("payments")
    .select("amount_paise, recipient_did, status")
    .eq("sender_did", sender.did)
    .gte("created_at", since);

  const rows = (todays ?? []) as unknown as Pick<
    PaymentRow,
    "amount_paise" | "recipient_did" | "status"
  >[];

  const refunded = new Set(["reclaimed", "resolved_sender", "expired"]);
  const dayTotal = rows
    .filter((r) => !refunded.has(r.status))
    .reduce((sum, r) => sum + Number(r.amount_paise), 0);

  if (dayTotal + amountPaise > limits.daily_total_paise) {
    throw new TrustError(
      `That would go over your daily limit of ${rupees(limits.daily_total_paise)}. You've sent ${rupees(dayTotal)} today.`,
      429,
      "daily_send_limit_exceeded"
    );
  }

  if (recipientDid) {
    const pair = rows.filter((r) => r.recipient_did === recipientDid);
    const pairTotal = pair.reduce((sum, r) => sum + Number(r.amount_paise), 0);

    if (pair.length + 1 > limits.pair_daily_count) {
      throw new TrustError(
        `You've already sent this person ${pair.length} payments today. Try again tomorrow.`,
        429,
        "pair_daily_count_exceeded"
      );
    }
    if (pairTotal + amountPaise > limits.pair_daily_total_paise) {
      throw new TrustError(
        `That would go over the ${rupees(limits.pair_daily_total_paise)} daily limit for one person.`,
        429,
        "pair_daily_total_exceeded"
      );
    }
  }
}

/** Whether this amount needs a fresh passkey check before it can be sent. */
export function requiresStepUp(
  amountPaise: number,
  limits: SendLimitsRow
): boolean {
  return amountPaise > limits.stepup_threshold_paise;
}

/** Append to the audit trail. Never throws into the caller's path. */
export async function audit(entry: {
  event: AuditEvent;
  caller?: Caller | null;
  counterpartyDid?: string | null;
  paymentId?: number | null;
  amountPaise?: number | null;
  detail?: Json;
}): Promise<void> {
  const { error } = await db()
    .from("audit_log")
    .insert({
      event: entry.event,
      actor_did: entry.caller?.did ?? null,
      actor_address: entry.caller?.address ?? null,
      counterparty_did: entry.counterpartyDid ?? null,
      payment_id: entry.paymentId ?? null,
      amount_paise: entry.amountPaise ?? null,
      detail: entry.detail ?? {},
    });

  // An unwritable audit row must not take a payment down with it, but it is a
  // real problem, so it is loud in the server log.
  if (error) {
    console.error("[audit] could not write entry", entry.event, error.message);
  }
}

function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}

export type RouteContext = { caller: Caller; user: UserRow };

/**
 * Wrap a route handler so it only ever runs for a verified caller, and so
 * every rejection is logged and answered in the same shape.
 */
export function handle(
  fn: (request: Request, ctx: RouteContext) => Promise<Response>
) {
  return async (request: Request): Promise<Response> => {
    // Before anything else, and before any database call: a cross-site caller
    // and a client in a hot loop are both cheaper to refuse here than after
    // two token verifications and a round trip.
    try {
      assertSameOrigin(request);
      assertIpUnderLimit(request);
    } catch (err) {
      if (err instanceof GuardError) {
        await audit({
          event: err.status === 429 ? "rate_limit_blocked" : "auth_rejected",
          detail: {
            reason: err.reason,
            path: new URL(request.url).pathname,
            // Salted SHA-256, never the address itself: `audit_read_own` lets a
            // signed-in user read their own rows, and an audit trail is not a
            // place to hand anybody back their own network location. The field
            // is named for what it holds so no later reader has to guess.
            ip_hash: hashedIp(request),
          },
        });
        return json({ error: err.message, reason: err.reason }, err.status);
      }
      throw err;
    }

    let caller: Caller;
    try {
      caller = await verifyCaller(request);
    } catch (err) {
      if (err instanceof CallerError) {
        await audit({
          event: "auth_rejected",
          detail: { reason: err.reason, path: new URL(request.url).pathname },
        });
        return json({ error: err.message, reason: err.reason }, err.status);
      }
      throw err;
    }

    try {
      const user = await ensureUser(caller);
      return await fn(request, { caller, user });
    } catch (err) {
      if (err instanceof TrustError) {
        if (err.status === 429) {
          await audit({
            event: "rate_limit_blocked",
            caller,
            detail: { reason: err.reason },
          });
        }
        return json({ error: err.message, reason: err.reason }, err.status);
      }
      if (err instanceof CallerError) {
        await audit({
          event: "auth_rejected",
          caller,
          detail: { reason: err.reason },
        });
        return json({ error: err.message, reason: err.reason }, err.status);
      }
      console.error("[route]", err);
      return json({ error: "Something went wrong. Please try again." }, 500);
    }
  };
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

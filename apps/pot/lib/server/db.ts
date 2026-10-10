/**
 * The database, as the server sees it.
 *
 * This client uses the Supabase secret key, which bypasses RLS. That is only
 * safe because it never leaves the server: route handlers call it *after*
 * `verifyCaller`, and every query is scoped by the verified DID rather than by
 * anything the browser asked for.
 *
 * RLS is still enabled on every table (see the socialpay_trust_layer
 * migration). It is the backstop: if the publishable key leaks, a reader gets
 * their own rows and nothing else, and no client role can write at all.
 */
import "server-only";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_SECRET_KEY, SUPABASE_URL } from "./env";
import type { Database, Enum, Row } from "./database.types";

export type PaymentKind = Enum<"payment_kind">;
export type PaymentStatus = Enum<"payment_status">;

export type UserRow = Row<"users">;
/** Amounts are paise. JSON numbers are safe: the daily cap is far below 2^53. */
export type PaymentRow = Row<"payments">;
export type ContactRow = Row<"contacts">;

export type AuditEvent =
  | "payment_intent"
  | "payment_sent"
  | "payment_confirmed"
  | "payment_reclaimed"
  | "payment_disputed"
  | "dispute_resolved"
  | "claimable_created"
  | "claimable_claimed"
  | "claimable_expired"
  | "rate_limit_blocked"
  | "auth_rejected"
  | "stepup_required"
  | "stepup_passed"
  | "recipient_unverified";

/** The column is plain `text` with a CHECK constraint; `AuditEvent` narrows it. */
export type AuditRow = Omit<Row<"audit_log">, "event"> & { event: AuditEvent };

export type SendLimitsRow = Row<"send_limits">;

let client: ReturnType<typeof createClient<Database>> | null = null;

/** The service-role client. Server only — never hand this to a component. */
export function db() {
  if (!client) {
    client = createClient<Database>(SUPABASE_URL(), SUPABASE_SECRET_KEY(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

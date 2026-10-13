import Link from "next/link";
// From pay-state, not pay: this is a Server Component, and `pay.ts` is
// "use client".
import type { PaymentView } from "@/lib/features/pay-state";
import { PayState, describe, pendingAction } from "@/lib/features/pay-state";
import { cn } from "@/lib/utils";
import {
  Amount,
  Avatar,
  EmptyState,
  StatusBadge,
  TestMoneyNote,
} from "../primitives";

/**
 * Money you have sent and money waiting on you.
 *
 * ──────────────── why this is a row and not a card ────────────────
 *
 * A pot is a card: it has a target, a bar, a deadline, several people. A
 * payment has one other person and one amount, and a card around that much
 * information is mostly whitespace. Rows let five payments fit on a phone
 * screen, which is what makes this feel like a payments list rather than a
 * gallery.
 *
 * ──────────────── the one thing this screen must get right ────────────────
 *
 * Money that has left your balance but has not reached theirs is in a third
 * place — the contract holds it until they confirm. If the UI says only
 * "Sent", a person assumes it arrived; if it says only "Pending", they assume
 * it failed and send again. So every held payment states who it is waiting on,
 * in those words.
 *
 * Presentational on purpose: it takes an array and renders it, with no hook of
 * its own. That is what lets the same component be reviewed with sample data
 * before sign-in exists and then be handed real data later without a rewrite.
 */
export function PaymentList({
  payments,
  nowSeconds,
  basePath = "/pay",
}: {
  payments: PaymentView[];
  /** Passed in rather than read from the clock, so a screenshot is stable and
   *  server and client never disagree about "now". */
  nowSeconds: number;
  basePath?: string;
}) {
  if (payments.length === 0) {
    return (
      <EmptyState
        title="No payments yet"
        body="Money you send sits safely until the other person says they got it. Nothing has been sent or received so far."
      />
    );
  }

  const waiting = payments.filter((p) => pendingAction(p, nowSeconds) !== null);
  const rest = payments.filter((p) => pendingAction(p, nowSeconds) === null);

  return (
    <div className="space-y-6">
      {waiting.length > 0 ? (
        <section>
          <h2 className="mb-3 text-small text-muted-foreground">
            Needs you
          </h2>
          <div className="divide-y overflow-hidden rounded-lg border bg-card">
            {waiting.map((p) => (
              <PaymentRow
                key={p.id}
                payment={p}
                nowSeconds={nowSeconds}
                basePath={basePath}
              />
            ))}
          </div>
        </section>
      ) : null}

      {rest.length > 0 ? (
        <section>
          {waiting.length > 0 ? (
            <h2 className="mb-3 text-small text-muted-foreground">
              Everything else
            </h2>
          ) : null}
          <div className="divide-y overflow-hidden rounded-lg border bg-card">
            {rest.map((p) => (
              <PaymentRow
                key={p.id}
                payment={p}
                nowSeconds={nowSeconds}
                basePath={basePath}
              />
            ))}
          </div>
        </section>
      ) : null}

      <TestMoneyNote />
    </div>
  );
}

/** One payment. The whole row is the tap target, at least 72px tall. */
export function PaymentRow({
  payment,
  nowSeconds,
  basePath = "/pay",
}: {
  payment: PaymentView;
  nowSeconds: number;
  basePath?: string;
}) {
  const { status, tone } = describe(payment, nowSeconds);
  const released =
    payment.state === PayState.Confirmed || payment.state === PayState.Claimed;

  // The badge sits under the name rather than beside the amount. Stacking it
  // on the right made the right-hand column wide enough to squeeze the memo
  // into an ellipsis, and the memo is the part a person actually reads to
  // remember what a payment was for.
  return (
    <Link
      href={`${basePath}/${payment.id}`}
      prefetch
      className="flex min-h-[72px] items-start gap-3 px-5 py-4 active:bg-muted/60"
    >
      <Avatar name={payment.otherName} />

      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-semibold text-foreground">
          {payment.outgoing ? "To " : "From "}
          {payment.otherName}
        </p>
        <p className="truncate text-small text-muted-foreground">
          {payment.memo || subtitle(payment, nowSeconds)}
        </p>
        <div className="mt-1.5">
          <StatusBadge tone={tone}>{status}</StatusBadge>
        </div>
      </div>

      <Amount
        paise={payment.amount}
        size="body"
        className={cn(
          "shrink-0",
          released && !payment.outgoing
            ? "text-success-strong"
            : "text-foreground"
        )}
      />
    </Link>
  );
}

/**
 * The second line, when there is no memo to show.
 *
 * Says what happens next and when, rather than restating the status already in
 * the badge beside it.
 */
function subtitle(payment: PaymentView, nowSeconds: number): string {
  const action = pendingAction(payment, nowSeconds);
  if (action === "confirm") return "Tap to accept";
  if (action === "reclaim") return "They never accepted it";

  if (payment.state === PayState.Held) {
    const left = Number(payment.deadline) - nowSeconds;
    if (left <= 0) return "Time is up — they can no longer accept";
    const hours = Math.floor(left / 3600);
    if (hours < 1) return "Less than an hour to accept";
    if (hours < 48)
      return `${hours} ${hours === 1 ? "hour" : "hours"} to accept`;
    return `${Math.floor(hours / 24)} days to accept`;
  }

  if (payment.state === PayState.Reclaimed) return "Came back to you";
  if (payment.state === PayState.Disputed) return "Frozen until you agree";
  return "";
}

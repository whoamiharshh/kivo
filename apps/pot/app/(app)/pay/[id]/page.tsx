"use client";

/**
 * One payment.
 *
 * ──────────────── one screen, two points of view ────────────────
 *
 * A held payment is the same row on the chain and two different situations in
 * real life: the sender is waiting, the recipient owes an answer. Rather than
 * branch on `outgoing` in a dozen places, this screen asks
 * `pendingAction(payment, now)` — the same pure function the list uses — for
 * the one thing this person can do, and renders that. The list and the detail
 * screen can therefore never disagree about whose turn it is, which is the
 * bug that makes somebody pay twice.
 *
 * ──────────────── why dispute is not the main button ────────────────
 *
 * Objecting freezes the money until two of three parties agree. That is a
 * wait, not an appeal to someone who will decide quickly, and a full-width
 * button invites a tap from anyone who is merely impatient. So it sits below
 * the fold as a quiet link with the consequence spelled out next to it.
 */

import { Suspense, use, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { LoginGate } from "@/components/login-gate";
import { ActionButton, StickyAction } from "@/components/feature/action-button";
import {
  Alert,
  Amount,
  Avatar,
  Card,
  StatRow,
  StatusBadge,
  TestMoneyNote,
} from "@/components/feature/primitives";
import { ready } from "@/lib/contracts";
import {
  PayState,
  describe,
  pendingAction,
  useConfirmReceipt,
  useDisputePayment,
  usePayment,
  usePaymentActivity,
  useReclaimPayment,
} from "@/lib/features/pay";
import { formatRupees } from "@/lib/money";
import { useNowSeconds } from "@/lib/now";
import { readableError } from "@/lib/tx";

/**
 * The route's own parameters are read inside a Suspense boundary.
 *
 * Which pot, which payment, which invite code is in the URL, and the URL is
 * only known when somebody actually asks for the page. Reading it above a
 * boundary would stop Next from prerendering the frame around it, so the
 * person would wait on an empty screen instead of seeing the shell at once.
 */
export default function PaymentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <AppShell back="/pay" title="Payment">
      <LoginGate>
        <Suspense fallback={<DetailSkeleton />}>
          <PaymentRoute params={params} />
        </Suspense>
      </LoginGate>
    </AppShell>
  );
}

function PaymentRoute({ params }: { params: Promise<{ id: string }> }) {
  // Next 16 hands route params as a promise; `use` unwraps it in a Client
  // Component without turning this into an async server boundary.
  const { id } = use(params);
  const paymentId = Number(id);

  if (!(Number.isSafeInteger(paymentId) && paymentId >= 0)) {
    return (
      <Alert tone="over" title="No such payment">
        That link does not point at a payment.
      </Alert>
    );
  }

  return <PaymentDetail paymentId={paymentId} />;
}

function DetailSkeleton() {
  return (
    <div className="space-y-3">
      <div className="h-28 animate-pulse rounded-lg bg-muted" />
      <div className="h-40 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}

function PaymentDetail({ paymentId }: { paymentId: number }) {
  const nowSeconds = useNowSeconds(60_000);
  const { data: payment, isLoading } = usePayment(paymentId);
  const { data: activity } = usePaymentActivity(paymentId);
  const confirm = useConfirmReceipt();
  const reclaim = useReclaimPayment();
  const dispute = useDisputePayment();
  const [confirmingDispute, setConfirmingDispute] = useState(false);

  if (!ready.pay) {
    return (
      <Alert tone="attention" title="Not set up yet">
        Paying a person needs one more address in the app&apos;s settings.
      </Alert>
    );
  }

  if (isLoading) return <DetailSkeleton />;

  if (!payment) {
    return (
      <Alert tone="over" title="No such payment">
        This payment does not exist, or it was never part of your account.
      </Alert>
    );
  }

  const { status, tone } = describe(payment, nowSeconds);
  const action = pendingAction(payment, nowSeconds);
  const pending = confirm.isPending || reclaim.isPending || dispute.isPending;

  // Objecting is only meaningful while the money is still held: once it is
  // released, reclaimed or already settled there is nothing left to freeze.
  const canDispute =
    payment.state === PayState.Held || payment.state === PayState.Claimable;

  return (
    <div className="space-y-6 pb-4">
      <Card>
        <div className="flex items-start gap-3">
          <Avatar name={payment.otherName} size={44} />
          <div className="min-w-0 flex-1">
            <p className="text-small text-muted-foreground">
              {payment.outgoing ? "You paid" : "You were paid by"}
            </p>
            <p className="truncate text-h3 text-foreground">
              {payment.otherName}
            </p>
          </div>
          <StatusBadge tone={tone}>{status}</StatusBadge>
        </div>

        <div className="mt-4">
          <Amount paise={payment.amount} size="display" />
        </div>

        {payment.memo ? (
          <p className="mt-2 text-body text-muted-foreground">
            {payment.memo}
          </p>
        ) : null}

        <TestMoneyNote className="mt-3" />
      </Card>

      {/* What happens next, in words, before any button. A held payment that
          does not explain itself is the failure mode of this whole feature. */}
      {payment.state === PayState.Held ? (
        <Alert
          tone={action ? "attention" : "progress"}
          title={
            action === "confirm"
              ? "Waiting on you"
              : action === "reclaim"
                ? "They never accepted it"
                : "Waiting on them"
          }
        >
          {action === "confirm" ? (
            <>
              {payment.otherName} has sent you {formatRupees(payment.amount)}.
              It is being held until you say you got it. Accepting moves it into
              your balance.
            </>
          ) : action === "reclaim" ? (
            <>
              The time to accept has passed, so this money is yours to take
              back.
            </>
          ) : (
            <>
              {formatRupees(payment.amount)} has left your balance and is being
              held until {payment.otherName} says they got it. If they never do,
              you can take it back after that.
            </>
          )}
        </Alert>
      ) : null}

      {payment.state === PayState.Disputed ? (
        <Alert tone="attention" title="On hold">
          Somebody objected, so the money is frozen where it is. It stays there
          until two of the three — you, {payment.otherName}, and the person you
          both agreed would decide — agree where it should go.
        </Alert>
      ) : null}

      <Card>
        <StatRow label="Amount">{formatRupees(payment.amount)}</StatRow>
        <StatRow label="Started">{dateLabel(payment.createdAt)}</StatRow>
        <StatRow
          label={
            payment.state === PayState.Held ? "Accept by" : "Accept-by date"
          }
        >
          {dateLabel(payment.deadline)}
        </StatRow>
      </Card>

      {activity && activity.length > 0 ? (
        <section>
          <h2 className="mb-3 text-small font-semibold text-foreground">
            What happened
          </h2>
          <div className="divide-y rounded-lg border bg-card px-5">
            {activity.map((entry) => (
              <div
                key={entry.key}
                className="py-3"
              >
                <p className="text-body text-foreground">
                  {entryLabel(entry.kind, payment.outgoing, payment.otherName)}
                </p>
              </div>
            ))}
          </div>
          {/* Ordered, not dated: the contract keeps state, not times. */}
          <p className="mt-2 text-caption text-text-tertiary">
            In the order it happened. Exact times aren&apos;t recorded.
          </p>
        </section>
      ) : null}

      {/* Quiet, with the consequence next to it — see the header. */}
      {canDispute ? (
        <section>
          {confirmingDispute ? (
            <Alert tone="attention" title="Freeze this money?">
              <p>
                Nobody can take it until two of three agree where it goes. This
                is not a quick decision — use it only if something is actually
                wrong.
              </p>
              <div className="mt-4 flex gap-3">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    dispute.mutate(payment.id, {
                      onSuccess: () => {
                        toast.success("This money is now frozen.");
                        setConfirmingDispute(false);
                      },
                      onError: (err) => toast.error(readableError(err)),
                    })
                  }
                  className="h-11 flex-1 rounded-md bg-danger px-4 text-small font-semibold text-primary-foreground disabled:opacity-60"
                >
                  {dispute.isPending ? "Freezing…" : "Yes, freeze it"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDispute(false)}
                  className="h-11 flex-1 rounded-md border bg-card px-4 text-small font-semibold text-foreground"
                >
                  Cancel
                </button>
              </div>
            </Alert>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDispute(true)}
              className="text-small font-semibold text-muted-foreground underline underline-offset-4"
            >
              Something is wrong with this payment
            </button>
          )}
        </section>
      ) : null}

      {action ? (
        <StickyAction>
          <ActionButton
            pending={pending}
            pendingLabel={action === "confirm" ? "Accepting…" : "Taking back…"}
            onClick={() => {
              if (action === "confirm") {
                confirm.mutate(payment.id, {
                  onSuccess: () =>
                    toast.success(
                      `${formatRupees(payment.amount)} is now yours`
                    ),
                  onError: (err) => toast.error(readableError(err)),
                });
              } else {
                reclaim.mutate(payment.id, {
                  onSuccess: () =>
                    toast.success(
                      `${formatRupees(payment.amount)} came back to you`
                    ),
                  onError: (err) => toast.error(readableError(err)),
                });
              }
            }}
          >
            {action === "confirm"
              ? `Yes, I got ${formatRupees(payment.amount)}`
              : `Take back ${formatRupees(payment.amount)}`}
          </ActionButton>
        </StickyAction>
      ) : null}
    </div>
  );
}

/** A unix second as a date a person reads, not a timestamp. */
function dateLabel(seconds: bigint): string {
  return new Date(Number(seconds) * 1000).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * One line of history, phrased from this person's side.
 *
 * The event itself says "confirmed"; what a person needs to read is who did
 * it and what it meant for them.
 */
function entryLabel(
  kind: "sent" | "confirmed" | "reclaimed" | "disputed" | "resolved",
  outgoing: boolean,
  otherName: string
): string {
  switch (kind) {
    case "sent":
      return outgoing ? "You sent it" : `${otherName} sent it`;
    case "confirmed":
      return outgoing
        ? `${otherName} said they got it`
        : "You said you got it";
    case "reclaimed":
      return outgoing ? "You took it back" : `${otherName} took it back`;
    case "disputed":
      return "Somebody objected, and the money was frozen";
    case "resolved":
      return "It was settled";
  }
}

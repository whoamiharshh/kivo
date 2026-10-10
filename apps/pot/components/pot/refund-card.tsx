"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useClaimRefund, useFinalizeFailed } from "@/lib/actions";
import { formatRupees } from "@/lib/money";
import { PotState, type Pot } from "@/lib/queries";
import { isPast } from "@/lib/time";
import { readableError } from "@/lib/tx";

/**
 * What a person sees when the date passed and the pot never filled up.
 *
 * A contract cannot act on its own at a deadline, so someone has to send a
 * transaction to open refunds. The app does that quietly the first time a
 * member looks at the pot, and the button is there if that didn't happen.
 */
export function RefundCard({
  potId,
  pot,
  myRefund,
  isMember,
}: {
  potId: number;
  pot: Pot;
  myRefund: bigint;
  isMember: boolean;
}) {
  const finalize = useFinalizeFailed();
  const claim = useClaimRefund();
  const triedRef = useRef(false);

  const missedDeadline =
    pot.state === PotState.Collecting && isPast(pot.deadline);

  useEffect(() => {
    if (!missedDeadline || !isMember || triedRef.current) return;
    triedRef.current = true;
    finalize.mutate(potId, {
      // Quietly: another member may well have got there first.
      onError: () => {},
    });
  }, [missedDeadline, isMember, potId, finalize]);

  if (missedDeadline) {
    return (
      <Card className="border-destructive/30 bg-destructive/5">
        <CardContent className="space-y-3 py-5">
          <div className="space-y-1">
            <p className="font-medium">This pot didn&apos;t fill up in time</p>
            <p className="text-sm text-muted-foreground">
              It reached {formatRupees(pot.totalContributed)} of{" "}
              {formatRupees(pot.targetAmount)}. Everyone gets back exactly what
              they put in — opening that takes one tap, which we&apos;re doing
              now.
            </p>
          </div>
          <Button
            variant="outline"
            className="h-11 w-full"
            disabled={finalize.isPending}
            onClick={() =>
              finalize.mutate(potId, {
                onSuccess: () => toast.success("Refunds are open"),
                onError: (err) => toast.error(readableError(err)),
              })
            }
          >
            {finalize.isPending ? "Opening refunds…" : "Open refunds now"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (pot.state !== PotState.Refunding) return null;

  return (
    <Card className="border-destructive/30 bg-destructive/5">
      <CardContent className="space-y-3 py-5">
        <div className="space-y-1">
          <p className="font-medium">This pot didn&apos;t fill up</p>
          <p className="text-sm text-muted-foreground">
            It reached {formatRupees(pot.totalContributed)} of{" "}
            {formatRupees(pot.targetAmount)} by the deadline, so nothing was
            spent. Each person takes back exactly what they put in.
          </p>
        </div>

        {myRefund > 0n ? (
          <Button
            className="h-11 w-full"
            disabled={claim.isPending}
            onClick={() =>
              claim.mutate(potId, {
                onSuccess: () =>
                  toast.success(`${formatRupees(myRefund)} is back with you`),
                onError: (err) => toast.error(readableError(err)),
              })
            }
          >
            {claim.isPending
              ? "Returning your money…"
              : `Claim your ${formatRupees(myRefund)} back`}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            {pot.refundsOutstanding > 0
              ? "You've taken your money back. Waiting on the others to take theirs."
              : "Everyone has taken their money back."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

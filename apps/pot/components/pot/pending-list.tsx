"use client";

import { toast } from "sonner";
import { Person, personLabel } from "@/components/person";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useApproveRepayment, useCancelRepayment } from "@/lib/actions";
import { formatRupees } from "@/lib/money";
import { readableError } from "@/lib/tx";

export type Pending = {
  spendId: number;
  requester: `0x${string}`;
  to: `0x${string}`;
  amount: bigint;
  memo: string | null;
};

/**
 * Repayments waiting on one approval from someone other than the requester.
 * Each one is holding its amount in the pot until it is approved or withdrawn.
 */
export function PendingList({
  potId,
  pending,
  names,
  me,
  creator,
  closed,
}: {
  potId: number;
  pending: Pending[];
  names: Record<string, string>;
  me: string | undefined;
  creator: string;
  closed: boolean;
}) {
  const approve = useApproveRepayment();
  const cancel = useCancelRepayment();

  if (pending.length === 0) return null;

  const held = pending.reduce((sum, p) => sum + p.amount, 0n);
  const iAmCreator = Boolean(me && creator.toLowerCase() === me.toLowerCase());

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">
          Waiting for approval
        </h2>
        <span className="tabular text-xs text-muted-foreground">
          {formatRupees(held)} set aside
        </span>
      </div>

      <ul className="space-y-3">
        {pending.map((p) => {
          const mine = Boolean(
            me && p.requester.toLowerCase() === me.toLowerCase()
          );
          const canWithdraw = mine || iAmCreator;

          return (
            <li key={p.spendId}>
              <Card className="border-amber-200 bg-amber-50/60">
                <CardContent className="space-y-3 py-4">
                  <div className="min-w-0 space-y-1">
                    <p className="text-[15px]">
                      <span className="tabular font-semibold">
                        {formatRupees(p.amount)}
                      </span>{" "}
                      to{" "}
                      <span className="font-medium">
                        {personLabel(p.to, names[p.to.toLowerCase()], me)}
                      </span>
                      {p.memo ? (
                        <span className="text-muted-foreground"> — {p.memo}</span>
                      ) : null}
                    </p>
                    <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      asked by
                      <Person
                        address={p.requester}
                        name={names[p.requester.toLowerCase()]}
                        you={me}
                        size="sm"
                      />
                    </p>
                  </div>

                  {closed ? (
                    <p className="text-sm text-muted-foreground">
                      This pot is closed, so this can no longer be paid.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {mine ? (
                        <p className="text-sm text-muted-foreground">
                          Someone else in the pot has to approve this. It&apos;s
                          holding {formatRupees(p.amount)} until then.
                        </p>
                      ) : (
                        <Button
                          className="h-10 w-full"
                          disabled={approve.isPending || cancel.isPending}
                          onClick={() =>
                            approve.mutate(
                              { potId, spendId: p.spendId },
                              {
                                onSuccess: () =>
                                  toast.success("Approved and paid"),
                                onError: (err) =>
                                  toast.error(readableError(err)),
                              }
                            )
                          }
                        >
                          {approve.isPending ? "Approving…" : "Approve"}
                        </Button>
                      )}

                      {canWithdraw ? (
                        <Button
                          variant="ghost"
                          className="h-9 w-full text-muted-foreground"
                          disabled={cancel.isPending || approve.isPending}
                          onClick={() =>
                            cancel.mutate(
                              { potId, spendId: p.spendId },
                              {
                                onSuccess: () =>
                                  toast.success("Request withdrawn"),
                                onError: (err) =>
                                  toast.error(readableError(err)),
                              }
                            )
                          }
                        >
                          {cancel.isPending
                            ? "Withdrawing…"
                            : mine
                              ? "Withdraw this request"
                              : "Withdraw it for them"}
                        </Button>
                      ) : null}
                    </div>
                  )}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

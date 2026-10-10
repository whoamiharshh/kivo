"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Person } from "@/components/person";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useClosePot } from "@/lib/actions";
import { formatRupees } from "@/lib/money";
import { readableError } from "@/lib/tx";

type Member = {
  address: `0x${string}`;
  name: string | null;
  contributed: bigint;
};

/**
 * Shows what each person gets back before closing. Mirrors the contract's
 * pro-rata split, with the rounding remainder going to the last contributor —
 * so the preview adds up to the balance exactly, like the payout does.
 */
function previewRefunds(
  members: Member[],
  balance: bigint,
  totalContributed: bigint
) {
  const contributors = members.filter((m) => m.contributed > 0n);
  if (contributors.length === 0 || totalContributed === 0n || balance === 0n) {
    return [];
  }
  let distributed = 0n;
  return contributors.map((m, i) => {
    const isLast = i === contributors.length - 1;
    const share = isLast
      ? balance - distributed
      : (balance * m.contributed) / totalContributed;
    distributed += share;
    return { ...m, share };
  });
}

export function ClosePotDialog({
  potId,
  members,
  balance,
  totalContributed,
  pendingCount,
  me,
  trigger,
}: {
  potId: number;
  members: Member[];
  balance: bigint;
  totalContributed: bigint;
  /** The contract refuses to close while any repayment is still pending. */
  pendingCount: number;
  me: string | undefined;
  trigger: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const close = useClosePot();
  const blocked = pendingCount > 0;
  const refunds = previewRefunds(members, balance, totalContributed);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Close this pot?</DialogTitle>
          <DialogDescription>
            {blocked
              ? `${pendingCount === 1 ? "A repayment is" : `${pendingCount} repayments are`} still waiting for approval. Approve or withdraw ${pendingCount === 1 ? "it" : "them"} first — closing now would leave someone unpaid.`
              : balance === 0n
                ? "The pot is empty, so there's nothing to return."
                : "Whatever is left goes back to each person in proportion to what they put in. This can't be undone."}
          </DialogDescription>
        </DialogHeader>

        {!blocked && refunds.length > 0 ? (
          <div className="divide-y rounded-lg border">
            {refunds.map((r) => (
              <div
                key={r.address}
                className="flex items-center justify-between gap-3 px-3 py-2.5"
              >
                <Person
                  address={r.address}
                  name={r.name}
                  you={me}
                  size="sm"
                />
                <span className="tabular text-sm font-medium">
                  {formatRupees(r.share)}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            className="h-11 flex-1"
            onClick={() => setOpen(false)}
          >
            Keep it open
          </Button>
          <Button
            className="h-11 flex-1"
            disabled={close.isPending || blocked}
            onClick={() =>
              close.mutate(potId, {
                onSuccess: () => {
                  toast.success("Pot closed and everyone refunded");
                  setOpen(false);
                },
                onError: (err) => toast.error(readableError(err)),
              })
            }
          >
            {close.isPending ? "Closing…" : "Close pot"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

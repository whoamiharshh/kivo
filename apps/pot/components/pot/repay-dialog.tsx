"use client";

import { useState } from "react";
import { toast } from "sonner";
import { MoneyInput } from "@/components/money-input";
import { Person, personLabel } from "@/components/person";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRepay } from "@/lib/actions";
import { formatRupees, rupeesToPaise } from "@/lib/money";
import { readableError } from "@/lib/tx";
import { cn } from "@/lib/utils";

type Member = { address: `0x${string}`; name: string | null };

/**
 * "₹1,200 to Rahul — cab".
 *
 * Whether it lands at once mirrors the contract exactly: you each get a budget
 * you can move without anyone agreeing, and repaying yourself always needs a
 * second person.
 */
export function RepayDialog({
  potId,
  members,
  me,
  available,
  instantRemaining,
  trigger,
}: {
  potId: number;
  members: Member[];
  me: string | undefined;
  /** Pot balance minus anything already held by a pending request. */
  available: bigint;
  /** How much this person can still move without an approval. */
  instantRemaining: bigint;
  trigger: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState<`0x${string}` | null>(null);
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const repay = useRepay();

  let paise = 0n;
  try {
    paise = amount ? rupeesToPaise(amount) : 0n;
  } catch {
    paise = 0n;
  }

  const isSelf = Boolean(to && me && to.toLowerCase() === me.toLowerCase());
  const needsApproval = isSelf || paise > instantRemaining;

  function submit() {
    if (!to) return toast.error("Choose who you're repaying.");
    let value: bigint;
    try {
      value = rupeesToPaise(amount);
    } catch (err) {
      return toast.error(
        err instanceof Error ? err.message : "Check the amount."
      );
    }
    if (value === 0n) return toast.error("Enter an amount first.");
    if (value > available) {
      return toast.error(
        `Only ${formatRupees(available)} is free in the pot right now.`
      );
    }

    repay.mutate(
      { potId, to, amountPaise: value, memo },
      {
        onSuccess: () => {
          toast.success(
            needsApproval
              ? "Sent for one approval"
              : `${formatRupees(value)} repaid`
          );
          setAmount("");
          setMemo("");
          setTo(null);
          setOpen(false);
        },
        onError: (err) => toast.error(readableError(err)),
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-h-[90dvh] max-w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Repay someone</DialogTitle>
          <DialogDescription>
            {formatRupees(available)} is free to use right now.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label>Who paid?</Label>
          <div className="grid gap-2">
            {members.map((m) => {
              const selected = to === m.address;
              const self = m.address.toLowerCase() === me?.toLowerCase();
              return (
                <button
                  key={m.address}
                  type="button"
                  onClick={() => setTo(m.address)}
                  aria-pressed={selected}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors",
                    selected
                      ? "border-primary bg-primary/5"
                      : "hover:bg-muted/60"
                  )}
                >
                  <Person address={m.address} name={m.name} you={me} size="sm" />
                  {self ? (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      needs approval
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="repay-amount">How much?</Label>
          <MoneyInput id="repay-amount" value={amount} onChange={setAmount} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="repay-memo">What for?</Label>
          <Input
            id="repay-memo"
            value={memo}
            maxLength={60}
            placeholder="cab"
            className="h-12 text-base"
            onChange={(e) => setMemo(e.target.value)}
          />
        </div>

        {paise > 0n && to ? (
          <p className="rounded-lg bg-muted px-3 py-2.5 text-sm text-muted-foreground">
            {needsApproval ? (
              isSelf ? (
                "Repaying yourself always needs one other person to approve."
              ) : instantRemaining === 0n ? (
                "You've used up what you can move on your own, so one other person has to approve this."
              ) : (
                <>
                  You can still move {formatRupees(instantRemaining)} on your
                  own, so this one needs an approval from someone else.
                </>
              )
            ) : (
              <>
                {personLabel(
                  to,
                  members.find((m) => m.address === to)?.name,
                  me
                )}{" "}
                gets this straight away. You&apos;ll have{" "}
                {formatRupees(instantRemaining - paise)} left to move on your
                own.
              </>
            )}
          </p>
        ) : null}

        <DialogFooter>
          <Button
            className="h-11 w-full"
            disabled={repay.isPending}
            onClick={submit}
          >
            {repay.isPending
              ? "Sending…"
              : needsApproval && paise > 0n
                ? "Ask for approval"
                : "Repay"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

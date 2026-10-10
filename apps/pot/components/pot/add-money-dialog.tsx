"use client";

import { useState } from "react";
import { toast } from "sonner";
import { MoneyInput } from "@/components/money-input";
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
import { useAddMoney } from "@/lib/actions";
import { formatRupees, rupeesToPaise } from "@/lib/money";
import { useTestMoney } from "@/lib/queries";
import { readableError } from "@/lib/tx";

/**
 * One step for the person. Behind it, the first time also grants the pot
 * permission to move their test money.
 */
export function AddMoneyDialog({
  potId,
  suggestedPaise,
  remainingToTarget,
  trigger,
}: {
  potId: number;
  suggestedPaise: bigint;
  /** The pot takes only what it still needs, so never offer more. */
  remainingToTarget: bigint;
  trigger: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const { data: money } = useTestMoney();
  const addMoney = useAddMoney();

  // Never suggest more than the pot can still take.
  const capped =
    suggestedPaise > 0n && suggestedPaise < remainingToTarget
      ? suggestedPaise
      : remainingToTarget;
  const suggestion = capped > 0n ? (capped / 100n).toString() : "";

  function submit() {
    let paise: bigint;
    try {
      paise = rupeesToPaise(amount);
    } catch (err) {
      return toast.error(
        err instanceof Error ? err.message : "Check the amount."
      );
    }
    if (paise === 0n) return toast.error("Enter an amount first.");
    if (money && paise > money.balance) {
      return toast.error("That's more than you have. Get test money first.");
    }

    addMoney.mutate(
      { potId, amountPaise: paise, allowance: money?.allowance ?? 0n },
      {
        onSuccess: () => {
          toast.success(`${formatRupees(paise)} added to the pot`);
          setAmount("");
          setOpen(false);
        },
        onError: (err) => toast.error(readableError(err)),
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add money to the pot</DialogTitle>
          <DialogDescription>
            {money
              ? `You have ${formatRupees(money.balance)} of test money. The pot still needs ${formatRupees(remainingToTarget)}.`
              : "Checking what you have…"}
          </DialogDescription>
        </DialogHeader>

        <MoneyInput autoFocus value={amount} onChange={setAmount} />

        {suggestion && amount !== suggestion ? (
          <button
            type="button"
            onClick={() => setAmount(suggestion)}
            className="self-start text-sm text-primary underline-offset-4 hover:underline"
          >
            {capped === remainingToTarget
              ? `Put in ${formatRupees(capped)} — finishes the pot`
              : `Put in ${formatRupees(capped)} — the suggested share`}
          </button>
        ) : null}

        <p className="text-xs text-muted-foreground">
          If you enter more than the pot still needs, only{" "}
          {formatRupees(remainingToTarget)} goes in and the rest stays with you.
        </p>

        <DialogFooter>
          <Button
            className="h-11 w-full"
            disabled={addMoney.isPending}
            onClick={submit}
          >
            {addMoney.isPending ? "Adding…" : "Add money"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

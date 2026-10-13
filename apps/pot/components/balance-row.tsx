"use client";

/**
 * What you have left to put in, on one line.
 *
 * ──────────────── why this is not a card ────────────────
 *
 * This used to be the largest thing on the home screen: a full card with the
 * balance set in display type, the way a bank app leads with your money. That
 * framed the product as a wallet, which it is not. Pot is a shared money box,
 * and the figure that matters is how full the pot is, not how much one person
 * happens to be holding at this instant.
 *
 * So the balance keeps its honesty and loses its weight: one row, the number
 * at heading size rather than display, the top-up beside it where a thumb
 * would reach. It answers "have I got enough to pay my share" at a glance and
 * then gets out of the way of the pots.
 *
 * ──────────────── the button says what it will do ────────────────
 *
 * The faucet gives a fixed amount once a day. The button names that amount
 * rather than saying "Top up", and once the day's is gone it says when to come
 * back instead of sitting there greyed out with no explanation.
 */

import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NameRow } from "@/components/name-row";
import { useCollectTestMoney } from "@/lib/actions";
import { formatRupees } from "@/lib/money";
import { useTestMoney } from "@/lib/queries";
import { readableError } from "@/lib/tx";

export function BalanceRow() {
  const { data, isLoading } = useTestMoney();
  const collect = useCollectTestMoney();

  const spent = data ? !data.canCollect : false;

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-small text-muted-foreground">
            Yours to put in
            <span className="rounded-[5px] bg-muted px-1.5 py-0.5 text-caption text-neutral-strong">
              Test money
            </span>
          </p>
          {isLoading || !data ? (
            <div className="mt-1 h-7 w-28 animate-pulse rounded bg-muted" />
          ) : (
            <p className="tabular mt-0.5 text-h2 text-foreground">
              {formatRupees(data.balance)}
            </p>
          )}
        </div>

        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={collect.isPending || spent}
          onClick={() => {
            collect.mutate(undefined, {
              onSuccess: () => toast.success("₹5,000 added"),
              onError: (err) => toast.error(readableError(err)),
            });
          }}
        >
          {collect.isPending
            ? "Adding…"
            : spent
              ? "More tomorrow"
              : "Get ₹5,000"}
        </Button>
      </div>

      <NameRow />
    </section>
  );
}

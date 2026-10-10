"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { formatRupees } from "@/lib/money";
import { PotState, type Pot } from "@/lib/queries";
import { deadlineExact, deadlineLabel } from "@/lib/time";

/** Where the pot is in its life, in words a person would use. */
export function StateBadge({ pot }: { pot: Pot }) {
  switch (pot.state) {
    case PotState.Collecting:
      return <Badge variant="secondary">Collecting</Badge>;
    case PotState.Funded:
      return <Badge>Ready to spend</Badge>;
    case PotState.Refunding:
      return <Badge variant="destructive">Didn&apos;t fill up</Badge>;
    case PotState.Closed:
      return <Badge variant="outline">Finished</Badge>;
  }
}

/** How close the pot is to its target, and how long is left. */
export function TargetProgress({
  pot,
  remaining,
}: {
  pot: Pot;
  remaining: bigint;
}) {
  // Re-render once a minute so "4 hours left" doesn't go stale on screen.
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const pct =
    pot.targetAmount === 0n
      ? 0
      : Number((pot.totalContributed * 100n) / pot.targetAmount);
  const collecting = pot.state === PotState.Collecting;

  return (
    <div className="space-y-2">
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={Math.min(100, pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Progress toward the pot's target"
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${
            pot.state === PotState.Refunding ? "bg-destructive" : "bg-primary"
          }`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>

      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-muted-foreground">
          <span className="tabular font-medium text-foreground">
            {formatRupees(pot.totalContributed)}
          </span>{" "}
          of {formatRupees(pot.targetAmount)}
        </span>
        {collecting ? (
          <span
            className="text-muted-foreground"
            title={deadlineExact(pot.deadline)}
          >
            {deadlineLabel(pot.deadline)}
          </span>
        ) : null}
      </div>

      {collecting && remaining > 0n ? (
        <p className="text-sm text-muted-foreground">
          {formatRupees(remaining)} still needed by{" "}
          {deadlineExact(pot.deadline)}.
        </p>
      ) : null}
    </div>
  );
}

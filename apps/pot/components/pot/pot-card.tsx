"use client";

/**
 * One pot, drawn as a pot.
 *
 * ──────────────── why the card fills instead of a bar ────────────────
 *
 * A thin bar under two lines of text is how every app on a phone shows
 * progress, and it reads as a component rather than as the thing itself. This
 * product is a shared money box, so the card is the box: the tint rises from
 * the bottom as money goes in, and a pot that is nearly full looks nearly full
 * from across the room without anybody reading a percentage.
 *
 * It is also the one piece of boldness on the home screen. Everything around
 * it — the greeting, the balance, the list of other features — is deliberately
 * flat and quiet so that this is what the eye lands on.
 *
 * ──────────────── scaleY, not height ────────────────
 *
 * The fill is a full-height block scaled from its bottom edge rather than an
 * element whose height changes. Scaling is composited on the GPU and costs no
 * layout work, which on a mid-range Android phone is the difference between
 * smooth and visibly janky. A flat colour block loses nothing by being scaled,
 * unlike the rounded ends of a bar — which is why the progress bar elsewhere
 * in this app is allowed to animate width and this is not.
 *
 * The rise happens once, on arrival, staggered down the list. Motion that
 * repeats on every render is noise; this one carries the information.
 */

import Link from "next/link";
import { motion } from "motion/react";
import { PotState, type Pot } from "@/lib/queries";
import { formatRupees } from "@/lib/money";
import { useNowSeconds } from "@/lib/now";
import { DURATION, EASE } from "@/lib/motion";

/** Where the pot is in its life, in words a person would use. */
export function StatusBadge({ state }: { state: Pot["state"] }) {
  const { label, className } = BADGES[state];
  return (
    <span
      className={`inline-flex h-6 shrink-0 items-center rounded-[6px] px-2 text-small font-semibold ${className}`}
    >
      {label}
    </span>
  );
}

// No outline on the badges: the card already carries a border and a fill, and
// a third outlined thing inside it makes the whole card read as a diagram.
const BADGES: Record<Pot["state"], { label: string; className: string }> = {
  [PotState.Collecting]: {
    label: "Collecting",
    className: "bg-primary-subtle text-primary-strong",
  },
  [PotState.Funded]: {
    label: "Ready to spend",
    className: "bg-success-bg text-success-strong",
  },
  [PotState.Refunding]: {
    label: "Didn't fill up",
    className: "bg-warning-bg text-warning-strong",
  },
  [PotState.Closed]: {
    label: "Finished",
    className: "bg-muted text-neutral-strong",
  },
};

/**
 * How many whole days are left, or null once the date has passed.
 *
 * Rounded up, because "1 day left" on the last afternoon is what a person
 * means, and "0 days left" reads as already over when it is not.
 */
function daysLeft(deadline: bigint, nowSeconds: number): number | null {
  const remaining = Number(deadline) - nowSeconds;
  if (remaining <= 0) return null;
  return Math.ceil(remaining / 86_400);
}

export function PotCard({
  potId,
  pot,
  name,
  index = 0,
}: {
  potId: number;
  pot: Pot;
  name: string;
  /** Position in the list, used to stagger the fills on arrival. */
  index?: number;
}) {
  // Ticking, not Date.now(): "3 days left" must not quietly go stale while the
  // app sits open, and reading the clock during render is not allowed.
  const nowSeconds = useNowSeconds(60_000);

  const collecting = pot.state === PotState.Collecting;
  const pct =
    pot.targetAmount === 0n
      ? 0
      : Number((pot.totalContributed * 100n) / pot.targetAmount);
  const filled = Math.max(0, Math.min(100, pct));
  const left = daysLeft(pot.deadline, nowSeconds);
  const shown = collecting ? pot.totalContributed : pot.balance;

  return (
    <Link
      href={`/pot/${potId}`}
      className="relative block overflow-hidden rounded-lg border bg-card transition-transform duration-100 active:scale-[0.99]"
    >
      {/* The money itself, rising from the bottom of the box. */}
      <motion.div
        aria-hidden="true"
        initial={{ scaleY: 0 }}
        animate={{ scaleY: filled / 100 }}
        transition={{
          duration: DURATION.progress,
          ease: EASE,
          delay: 0.06 * index,
        }}
        className={`absolute inset-0 origin-bottom ${
          pot.state === PotState.Refunding
            ? "bg-warning-bg"
            : pot.state === PotState.Funded
              ? "bg-success-bg"
              : "bg-primary-subtle"
        }`}
      />

      <div className="relative p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 flex-1 truncate text-h3 text-foreground">
            {name}
          </h3>
          <StatusBadge state={pot.state} />
        </div>

        <div className="mt-5 flex items-baseline gap-2">
          <span className="tabular text-display text-foreground">
            {formatRupees(shown)}
          </span>
          {collecting ? (
            <span className="tabular text-body text-muted-foreground">
              of {formatRupees(pot.targetAmount)}
            </span>
          ) : null}
        </div>

        {collecting ? (
          <p className="mt-4 text-small text-muted-foreground">
            {filled}% there
            {left === null
              ? " · the date has passed"
              : left === 1
                ? " · one day left"
                : ` · ${left} days left`}
          </p>
        ) : null}
      </div>
    </Link>
  );
}

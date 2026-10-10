"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { DURATION, EASE } from "@/lib/motion";
import { formatRupees } from "@/lib/money";
import { cn } from "@/lib/utils";
import { ProgressBar } from "./progress-bar";
import { StatusBadge, type Tone } from "./primitives";

/**
 * One row in any feature's list.
 *
 * This is the prompt's PotCard with the pot-specific parts lifted out, because
 * the shape turned out to be identical everywhere once you stop calling the
 * parts by their feature's names: a title, a state, a number, a target, how
 * far along, and two facts in the footer. A pot raising ₹20,000, a savings
 * goal of ₹5,000, a policy covering ₹10,000 and a stream that has released
 * ₹8,000 of ₹24,000 all fit it without an `if`.
 *
 * The parts a feature does not have are simply omitted: a gift has no
 * progress, an agreement has no target. Nothing renders an empty bar or a
 * "₹0 of ₹0" to keep the layout symmetrical.
 *
 * `prefetch` is on because the detail page is the next tap in every case and
 * waiting for a navigation is the most noticeable kind of slow.
 */
export function FeatureCard({
  href,
  title,
  status,
  tone,
  paise,
  targetPaise,
  progress,
  footerLeft,
  footerRight,
  progressTone,
}: {
  href: string;
  title: string;
  /** The word shown in the badge: "Collecting", "Active", "Waiting on you". */
  status: string;
  tone: Tone;
  /** The number that matters most for this feature, in paise. */
  paise?: bigint;
  /** What `paise` is working towards, if anything. */
  targetPaise?: bigint;
  /** Overrides the bar's own value when progress is not about money — days
   *  kept out of days required, for instance. */
  progress?: { value: number; max: number; label: string };
  footerLeft?: string;
  footerRight?: string;
  progressTone?: "auto" | "attention";
}) {
  const bar =
    progress ??
    (paise !== undefined && targetPaise !== undefined && targetPaise > 0n
      ? {
          value: Number(paise),
          max: Number(targetPaise),
          label: `${title}: progress towards ${formatRupees(targetPaise)}`,
        }
      : undefined);

  return (
    <motion.div
      whileTap={{ scale: 0.99 }}
      transition={{ duration: DURATION.micro, ease: EASE }}
    >
      <Link
        href={href}
        prefetch
        className={cn(
          "block rounded-lg border bg-card p-5 shadow-xs",
          "transition-shadow duration-150 hover:shadow-md active:shadow-md"
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 flex-1 truncate text-h3 text-foreground">
            {title}
          </h3>
          <StatusBadge tone={tone}>{status}</StatusBadge>
        </div>

        {paise !== undefined ? (
          <div className="mt-3 flex items-baseline gap-2">
            <span data-amount className="text-display text-foreground">
              {formatRupees(paise)}
            </span>
            {targetPaise !== undefined && targetPaise > 0n ? (
              <span data-amount className="text-body text-muted-foreground">
                of {formatRupees(targetPaise)}
              </span>
            ) : null}
          </div>
        ) : null}

        {bar ? (
          <ProgressBar
            className="mt-4"
            value={bar.value}
            max={bar.max}
            label={bar.label}
            tone={progressTone}
          />
        ) : null}

        {footerLeft || footerRight ? (
          <div className="mt-3 flex items-baseline justify-between gap-3">
            <span className="text-small font-semibold text-foreground">
              {footerLeft}
            </span>
            <span className="text-small text-muted-foreground">
              {footerRight}
            </span>
          </div>
        ) : null}
      </Link>
    </motion.div>
  );
}

"use client";

import { motion } from "motion/react";
import { DURATION, EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * How far along something is. The same bar in all seven features.
 *
 * ──────────────── why this one animates width ────────────────
 *
 * The house rule is transform and opacity only, because those are composited
 * and cost no layout work. This component breaks it deliberately: a bar scaled
 * up on the X axis stretches its own rounded ends into ovals, and at 8px tall
 * that distortion is the most visible thing on the screen. It is one 8px
 * element with nothing below it that can move, so the re-layout is confined to
 * a single row and costs nothing measurable. Nowhere else in the app animates
 * a layout property.
 *
 * The fill colour carries meaning: indigo while in flight, emerald once the
 * target is met, amber when something has gone wrong and money is coming
 * back. The percentage is always written out next to it, so the colour is a
 * reinforcement and never the only signal.
 */
export function ProgressBar({
  value,
  max,
  tone = "auto",
  className,
  label,
}: {
  /** Progress so far, in the same unit as `max`. Clamped, so a contract that
   *  reports more than the target cannot overflow the track. */
  value: number;
  max: number;
  /** "auto" turns emerald at 100%. "attention" forces amber for refunds. */
  tone?: "auto" | "attention";
  className?: string;
  /** What this bar measures, for screen readers. */
  label: string;
}) {
  const safeMax = max > 0 ? max : 1;
  const pct = Math.max(0, Math.min(100, (value / safeMax) * 100));
  const complete = pct >= 100;

  const fill =
    tone === "attention" ? "bg-warning" : complete ? "bg-success" : "bg-primary";

  return (
    <div
      className={cn(
        "h-2 w-full overflow-hidden rounded-full bg-muted",
        className
      )}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <motion.div
        className={cn("h-full rounded-full", fill)}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: DURATION.progress, ease: EASE }}
      />
    </div>
  );
}

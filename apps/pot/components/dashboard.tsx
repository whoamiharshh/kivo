"use client";

/**
 * The home dashboard: the pots, summed up, and a way to move between them.
 *
 * Every figure here is derived from the pots the person is in, read straight
 * from the contract. Nothing is estimated or invented: if a number cannot be
 * computed from a pot, it is not shown.
 *
 * The filter chips and the sort toggle let a person narrow the list with one
 * tap, and the banner jumps straight to a pot that is waiting on an approval.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "motion/react";
import { PotCard } from "@/components/pot/pot-card";
import { ready } from "@/lib/contracts";
import { DURATION, EASE, PRESS, RISE } from "@/lib/motion";
import { formatRupees } from "@/lib/money";
import { FEATURE_ROUTES } from "@/lib/nav/routes";
import { PotState, type Pot } from "@/lib/queries";

export type DashboardPot = { potId: number; pot: Pot; name: string };

type Filter = "all" | "collecting" | "funded" | "refunding" | "closed";
type Sort = "newest" | "fullest";

const FILTERS: { key: Filter; label: string; state?: number }[] = [
  { key: "all", label: "All" },
  { key: "collecting", label: "Collecting", state: PotState.Collecting },
  { key: "funded", label: "Ready to spend", state: PotState.Funded },
  { key: "refunding", label: "Didn't fill up", state: PotState.Refunding },
  { key: "closed", label: "Finished", state: PotState.Closed },
];

function fillPct(pot: Pot): number {
  if (pot.targetAmount === 0n) return 0;
  return Number((pot.totalContributed * 100n) / pot.targetAmount);
}

export function Dashboard({ pots }: { pots: DashboardPot[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("newest");

  const stats = useMemo(() => {
    // Money still sitting in a pot. Finished pots have been paid back out.
    let held = 0n;
    let pending = 0;
    let pendingPot: number | null = null;
    const counts: Record<Filter, number> = {
      all: pots.length,
      collecting: 0,
      funded: 0,
      refunding: 0,
      closed: 0,
    };
    for (const { potId, pot } of pots) {
      if (pot.state !== PotState.Closed) held += pot.balance;
      if (pot.state === PotState.Collecting) counts.collecting++;
      else if (pot.state === PotState.Funded) counts.funded++;
      else if (pot.state === PotState.Refunding) counts.refunding++;
      else counts.closed++;
      if (pot.state !== PotState.Closed && pot.pendingSpendCount > 0) {
        pending += pot.pendingSpendCount;
        pendingPot ??= potId;
      }
    }
    return { held, pending, pendingPot, counts };
  }, [pots]);

  const visible = useMemo(() => {
    const wanted = FILTERS.find((f) => f.key === filter)?.state;
    const list = pots.filter(
      (p) => wanted === undefined || p.pot.state === wanted
    );
    if (sort === "fullest") {
      return [...list].sort((a, b) => fillPct(b.pot) - fillPct(a.pot));
    }
    return list; // already newest first
  }, [pots, filter, sort]);

  // The hero already carries Pay, Save and Gift; list only the rest.
  const inHero = new Set(["/pay", "/savings", "/gifts"]);
  const actions = FEATURE_ROUTES.filter(
    (r) => r.built && ready[r.requiresFeature] && !inHero.has(r.href)
  );

  return (
    <div className="space-y-6">
      <Summary held={stats.held} potCount={pots.length} />

      {stats.pending > 0 && stats.pendingPot !== null ? (
        <motion.div {...RISE}>
          <Link
            href={`/pot/${stats.pendingPot}`}
            className="flex items-center gap-3 rounded-lg border border-warning-ring bg-warning-bg px-4 py-3 text-warning-strong"
          >
            <span className="relative flex size-2.5 shrink-0">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-warning opacity-60" />
              <span className="relative inline-flex size-2.5 rounded-full bg-warning" />
            </span>
            <span className="min-w-0 flex-1 text-body font-medium">
              {stats.pending === 1
                ? "1 repayment is waiting for approval"
                : `${stats.pending} repayments are waiting for approval`}
            </span>
            <Chevron />
          </Link>
        </motion.div>
      ) : null}

      {pots.length > 1 ? (
        <section aria-label="Pots at a glance" className="space-y-3">
          <h2 className="text-small font-semibold text-muted-foreground">
            At a glance
          </h2>
          <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
            {pots.map((p) => (
              <RingCard key={p.potId} {...p} />
            ))}
          </div>
        </section>
      ) : null}

      <section aria-label="Your pots" className="space-y-3">
        <div
          role="tablist"
          aria-label="Filter pots"
          className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]"
        >
          {FILTERS.map((f) => {
            const count = stats.counts[f.key];
            const active = filter === f.key;
            // Only offer filters that lead somewhere.
            if (f.key !== "all" && count === 0 && !active) return null;
            return (
              <button
                key={f.key}
                role="tab"
                aria-selected={active}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`relative h-9 shrink-0 rounded-full px-4 text-small font-semibold transition-colors ${
                  active
                    ? "text-primary-foreground"
                    : "bg-muted text-neutral-strong hover:bg-muted/70"
                }`}
              >
                {active ? (
                  <motion.span
                    layoutId="filter-pill"
                    transition={{ duration: DURATION.standard, ease: EASE }}
                    className="absolute inset-0 rounded-full bg-primary"
                  />
                ) : null}
                <span className="relative">
                  {f.label}
                  <span className="tabular ml-1.5 opacity-70">{count}</span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between">
          <p className="text-small text-muted-foreground">
            {visible.length === 1 ? "1 pot" : `${visible.length} pots`}
          </p>
          <button
            type="button"
            onClick={() =>
              setSort((s) => (s === "newest" ? "fullest" : "newest"))
            }
            className="rounded-md px-2 py-1 text-small font-semibold text-primary-strong hover:bg-primary-subtle"
            aria-label={`Sorted by ${sort}. Tap to change.`}
          >
            {sort === "newest" ? "Newest first" : "Fullest first"}
          </button>
        </div>

        <ul className="space-y-3">
          <AnimatePresence mode="popLayout" initial={false}>
            {visible.map(({ potId, pot, name }, i) => (
              <motion.li
                key={potId}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: DURATION.standard, ease: EASE }}
              >
                <PotCard potId={potId} pot={pot} name={name} index={i} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>

        {visible.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-8 text-center text-body text-muted-foreground">
            Nothing here. Try another filter.
          </p>
        ) : null}
      </section>

      <section aria-label="More ways to use Pot" className="space-y-3">
        <h2 className="text-small font-semibold text-muted-foreground">
          More ways to use Pot
        </h2>
        <div className="grid grid-cols-2 gap-3">
          {actions.map((r, i) => (
            <motion.div
              key={r.href}
              {...PRESS}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: DURATION.standard,
                ease: EASE,
                delay: 0.04 * i,
              }}
            >
              <Link
                href={r.href}
                prefetch
                className="flex h-full min-h-[104px] flex-col justify-between rounded-lg border bg-card p-4 transition-colors hover:bg-muted/50"
              >
                <span className="flex size-8 items-center justify-center rounded-full bg-primary-subtle text-small font-bold text-primary-strong">
                  {r.label.charAt(0)}
                </span>
                <span className="mt-3 block text-body font-semibold leading-snug text-foreground">
                  {r.label}
                </span>
              </Link>
            </motion.div>
          ))}
        </div>
      </section>
    </div>
  );
}

/** The headline: money currently held across the person's open pots. */
function Summary({ held, potCount }: { held: bigint; potCount: number }) {
  const reduce = useReducedMotion();
  const target = Number(held / 100n); // whole rupees for the count-up
  const value = useMotionValue(reduce ? target : 0);
  const shown = useTransform(value, (v) =>
    formatRupees(BigInt(Math.round(v)) * 100n)
  );

  useEffect(() => {
    if (reduce) {
      value.set(target);
      return;
    }
    const controls = animate(value, target, {
      duration: DURATION.progress + 0.3,
      ease: EASE,
    });
    return () => controls.stop();
  }, [target, reduce, value]);

  return (
    <motion.section
      {...RISE}
      className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary to-primary-strong p-5 text-primary-foreground shadow-lg"
    >
      {/* Soft shapes behind the figure, the way fintech heroes get depth. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full bg-white/10"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-14 right-8 size-32 rounded-full bg-white/5"
      />

      <div className="relative">
        <p className="text-small opacity-80">Held in your open pots</p>
        <motion.p className="tabular mt-1 text-display">{shown}</motion.p>
        <p className="mt-1 text-small opacity-80">
          {potCount === 1 ? "1 pot" : `${potCount} pots`} · test money
        </p>

        <div className="mt-5 grid grid-cols-4 gap-2">
          <QuickAction href="/create" label="New pot">
            <path d="M12 5v14M5 12h14" />
          </QuickAction>
          <QuickAction href="/pay" label="Pay">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </QuickAction>
          <QuickAction href="/savings" label="Save">
            <path d="M12 3v18M17 8H9.5a2.5 2.5 0 0 0 0 5h5a2.5 2.5 0 0 1 0 5H6" />
          </QuickAction>
          <QuickAction href="/gifts" label="Gift">
            <path d="M20 12v9H4v-9M2 7h20v5H2zM12 21V7M12 7a3 3 0 1 0-3-3c0 1.7 3 3 3 3zm0 0a3 3 0 1 1 3-3c0 1.7-3 3-3 3z" />
          </QuickAction>
        </div>
      </div>
    </motion.section>
  );
}

/** A round button with its label underneath, as in every banking app. */
function QuickAction({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <motion.div {...PRESS}>
      <Link href={href} className="flex flex-col items-center gap-1.5">
        <span className="flex size-12 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm transition-colors hover:bg-white/30">
          <svg
            viewBox="0 0 24 24"
            className="size-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {children}
          </svg>
        </span>
        <span className="text-caption font-semibold">{label}</span>
      </Link>
    </motion.div>
  );
}

/** A pot as a progress ring, for the swipeable glance row. */
function RingCard({ potId, pot, name }: DashboardPot) {
  const pct = Math.max(0, Math.min(100, fillPct(pot)));
  const r = 26;
  const c = 2 * Math.PI * r;
  const done = pot.state !== PotState.Collecting;
  return (
    <motion.div {...PRESS} className="snap-start">
      <Link
        href={`/pot/${potId}`}
        className="flex w-36 flex-col items-center rounded-2xl border bg-card p-4 text-center"
      >
        <span className="relative flex size-16 items-center justify-center">
          <svg viewBox="0 0 64 64" className="absolute inset-0 -rotate-90" aria-hidden="true">
            <circle cx="32" cy="32" r={r} fill="none" strokeWidth="6" className="stroke-muted" />
            <motion.circle
              cx="32"
              cy="32"
              r={r}
              fill="none"
              strokeWidth="6"
              strokeLinecap="round"
              className={done ? "stroke-success" : "stroke-primary"}
              strokeDasharray={c}
              initial={{ strokeDashoffset: c }}
              animate={{ strokeDashoffset: c * (1 - (done ? 1 : pct / 100)) }}
              transition={{ duration: DURATION.progress + 0.2, ease: EASE }}
            />
          </svg>
          <span className="tabular text-small font-bold text-foreground">
            {done ? "✓" : `${pct}%`}
          </span>
        </span>
        <span className="mt-3 w-full truncate text-small font-semibold text-foreground">
          {name}
        </span>
        <span className="tabular text-caption text-muted-foreground">
          {formatRupees(pot.state === PotState.Collecting ? pot.totalContributed : pot.balance)}
        </span>
      </Link>
    </motion.div>
  );
}

function Chevron() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

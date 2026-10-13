"use client";

/**
 * Every savings goal this person has, soonest deadline first.
 *
 * ──────────────── what a row has to answer ────────────────
 *
 * A goal is two promises at once: an amount to put aside, and a habit to keep
 * while doing it. A row that showed only the money would let somebody think
 * they were on track while the half that actually decides the outcome went
 * unmentioned. So each row carries both bars, and the badge reads the pair.
 *
 * The stake is named on every row rather than tucked into the detail screen.
 * It is the money that can be lost, and a list that mentions only what you
 * save is a list that flatters.
 *
 * Presentational: it takes rows and renders them. The screen above it does the
 * reading, so this same component can be dropped into a different screen
 * without dragging a query along with it.
 */

import Link from "next/link";
import { ProgressBar } from "@/components/feature/progress-bar";
import {
  Amount,
  EmptyState,
  RowList,
  StatusBadge,
} from "@/components/feature/primitives";
import {
  amountLeft,
  describeGoal,
  habitProgress,
  type GoalView,
} from "@/lib/features/savings-state";
import { formatRupees } from "@/lib/money";

export function GoalList({
  goals,
  nowSeconds,
}: {
  goals: GoalView[];
  nowSeconds: number;
}) {
  if (goals.length === 0) {
    return (
      <EmptyState
        title="No savings goals yet"
        body="Put money aside for something, and stake a little of it on keeping the habit that gets you there."
      />
    );
  }

  return (
    <RowList>
      {goals.map((goal) => (
        <GoalRow key={goal.id} goal={goal} nowSeconds={nowSeconds} />
      ))}
    </RowList>
  );
}

function GoalRow({
  goal,
  nowSeconds,
}: {
  goal: GoalView;
  nowSeconds: number;
}) {
  const { status, tone } = describeGoal(goal, nowSeconds);
  const habit = habitProgress(goal);
  const left = amountLeft(goal);

  // Clamped by the bar itself, but computed here so the figure beside it and
  // the bar can never disagree about what "saved" means.
  const saved = Number(goal.saved);
  const target = Number(goal.target);

  return (
    <Link
      href={`/savings/${goal.id}`}
      className="block px-5 py-4 transition-transform duration-100 active:scale-[0.99]"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 flex-1 truncate text-body font-semibold text-foreground">
          {goal.name}
        </h3>
        <StatusBadge tone={tone}>{status}</StatusBadge>
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        <Amount paise={goal.saved} size="h1" />
        <span className="tabular text-small text-muted-foreground">
          of {formatRupees(goal.target)}
        </span>
      </div>

      <ProgressBar
        className="mt-3"
        value={saved}
        max={target}
        label={`${goal.name}: ${formatRupees(goal.saved)} of ${formatRupees(goal.target)} saved`}
      />

      {/* The habit, which decides whether the stake comes back. */}
      <ProgressBar
        className="mt-2"
        value={habit.value}
        max={habit.max}
        label={habit.label}
      />

      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-small text-muted-foreground">{habit.short}</span>
        <span className="tabular text-small text-muted-foreground">
          {left > 0n ? `${formatRupees(left)} to go` : "Target reached"}
        </span>
      </div>

      {/* Said on every row: this is the money that does not simply come back. */}
      <p className="tabular mt-2 text-caption text-text-tertiary">
        {formatRupees(goal.stake)} staked on keeping the habit
      </p>
    </Link>
  );
}

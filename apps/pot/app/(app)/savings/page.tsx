"use client";

/**
 * Save towards something.
 *
 * ──────────────── what this screen is for ────────────────
 *
 * Put money aside for a thing you want, and stake a small part of it on
 * keeping the habit that gets you there. Meet the goal and the stake comes
 * back, possibly with a share of what other people forfeited. Miss it and the
 * stake does not come back.
 *
 * The screen says all three of those things before it lists anything, because
 * a person who skims the list and taps "Start a goal" has agreed to the third
 * one whether or not they read it.
 *
 * ──────────────── the two honesty notes ────────────────
 *
 * `SelfReportedNote` and `BonusSourceNote` are not decoration. Nothing in this
 * build reads a step count or any health data — a figure is a figure somebody
 * typed — and a bonus is funded by other savers missing their goals and by
 * nothing else. Both claims are easy to soften by accident, so their wording
 * lives in `savings-state.ts` and this screen only chooses to show them.
 */

import Link from "next/link";
import { AppShell, StickyBar } from "@/components/app-shell";
import { LoginGate } from "@/components/login-gate";
import { GoalList } from "@/components/feature/savings/goal-list";
import {
  BonusSourceNote,
  SavingsNotSetUp,
  SelfReportedNote,
} from "@/components/feature/savings/notes";
import { Alert, TestMoneyNote } from "@/components/feature/primitives";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ready } from "@/lib/contracts";
import { useMyGoals } from "@/lib/features/savings";
import { useNowSeconds } from "@/lib/now";

export default function SavingsPage() {
  return (
    <AppShell back="/" title="Save towards something">
      <LoginGate>
        <Savings />
      </LoginGate>
    </AppShell>
  );
}

function Savings() {
  // A minute is fine: the soonest thing any goal counts down to is a date.
  const nowSeconds = useNowSeconds(60_000);
  const { data: goals, isLoading, isError, refetch } = useMyGoals();

  if (!ready.savings) return <SavingsNotSetUp />;

  return (
    <div className="space-y-6 pb-4">
      <p className="text-body text-muted-foreground">
        Put money aside for something, and stake a little of it on keeping the
        habit that gets you there.
      </p>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-44 w-full rounded-lg" />
          <Skeleton className="h-44 w-full rounded-lg" />
        </div>
      ) : isError ? (
        <Alert tone="over" title="Couldn't load your goals">
          <p>Something went wrong reaching the network.</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => void refetch()}
          >
            Try again
          </Button>
        </Alert>
      ) : (
        <GoalList goals={goals ?? []} nowSeconds={nowSeconds} />
      )}

      <SelfReportedNote />
      <BonusSourceNote />
      <TestMoneyNote />

      <StickyBar>
        <Button
          size="lg"
          className="h-12 w-full text-base"
          render={<Link href="/savings/new" />}
        >
          Start a goal
        </Button>
      </StickyBar>
    </div>
  );
}

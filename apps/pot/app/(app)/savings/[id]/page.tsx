"use client";

/**
 * One savings goal.
 *
 * ──────────────── one screen, one thing to do ────────────────
 *
 * A goal can be in seven different situations and each has exactly one sensible
 * next move: put more in, mark the habit, close it, collect, or simply wait.
 * Rather than branch on the state in a dozen places, the screen asks
 * `nextStep(goal, now, cohort)` — the same pure function the list uses — for
 * the one thing this person can do, and renders that. The list and this screen
 * can therefore never disagree about whose turn it is.
 *
 * ──────────────── the outcome is shown before it is claimed ────────────────
 *
 * `outcomeFor` repeats the contract's settlement arithmetic so the figure can
 * be shown next to the button rather than discovered after pressing it. When
 * money has been lost it says so in those words, because a screen that only
 * ever reports good news is not telling anybody what their stake was for.
 */

import { Suspense, use, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { LoginGate } from "@/components/login-gate";
import { ActionButton, StickyAction } from "@/components/feature/action-button";
import {
  Alert,
  Amount,
  Card,
  Section,
  StatRow,
  StatusBadge,
  TestMoneyNote,
} from "@/components/feature/primitives";
import { ProgressBar } from "@/components/feature/progress-bar";
import { AmountField } from "@/components/feature/fields";
import {
  BonusSourceNote,
  SavingsNotSetUp,
  SelfReportedNote,
} from "@/components/feature/savings/notes";
import { BEHAVIOUR_SAVINGS_ADDRESS, ready } from "@/lib/contracts";
import {
  BehaviourType,
  describeGoal,
  habitProgress,
  nextStep,
  outcomeFor,
  savingsError,
  useAddToGoal,
  useClaimOutcome,
  useCloseGoal,
  useGoal,
  useGoalActivity,
  useSubmitHabit,
} from "@/lib/features/savings";
import { formatRupees, rupeesToPaise } from "@/lib/money";
import { useNowSeconds } from "@/lib/now";
import { useTokenState } from "@/lib/token";

export default function GoalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <AppShell back="/savings" title="Your goal">
      <LoginGate>
        <Suspense fallback={<Skeletons />}>
          <GoalRoute params={params} />
        </Suspense>
      </LoginGate>
    </AppShell>
  );
}

function GoalRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const goalId = Number(id);

  if (!ready.savings) return <SavingsNotSetUp />;
  if (!Number.isSafeInteger(goalId) || goalId < 0) {
    return (
      <Alert tone="over" title="No such goal">
        That link does not point at a savings goal.
      </Alert>
    );
  }
  return <GoalDetail goalId={goalId} />;
}

function GoalDetail({ goalId }: { goalId: number }) {
  const nowSeconds = useNowSeconds(60_000);
  const { data, isLoading } = useGoal(goalId);
  const { data: activity } = useGoalActivity(goalId);
  const { data: token } = useTokenState(BEHAVIOUR_SAVINGS_ADDRESS);

  const addMoney = useAddToGoal();
  const submitHabit = useSubmitHabit();
  const closeGoal = useCloseGoal();
  const claim = useClaimOutcome();

  const [topUp, setTopUp] = useState("");
  const [steps, setSteps] = useState("");

  if (isLoading) return <Skeletons />;
  if (!data) {
    return (
      <Alert tone="over" title="No such goal">
        This goal does not exist, or it was never yours.
      </Alert>
    );
  }

  const { goal, cohort } = data;
  const { status, tone } = describeGoal(goal, nowSeconds);
  const habit = habitProgress(goal);
  const step = nextStep(goal, nowSeconds, cohort);
  const outcome = outcomeFor(goal, cohort);
  const pending =
    addMoney.isPending ||
    submitHabit.isPending ||
    closeGoal.isPending ||
    claim.isPending;

  const daysLeft = Math.max(
    0,
    Math.ceil((Number(goal.deadline) - nowSeconds) / 86_400)
  );

  return (
    <div className="space-y-6 pb-4">
      <div className="flex items-start justify-between gap-3">
        <h1 className="min-w-0 flex-1 text-h1 text-foreground">{goal.name}</h1>
        <StatusBadge tone={tone}>{status}</StatusBadge>
      </div>

      <Card>
        <p className="text-small text-muted-foreground">Saved</p>
        <div className="mt-1 flex items-baseline gap-2">
          <Amount paise={goal.saved} size="display" />
          <span className="tabular text-body text-muted-foreground">
            of {formatRupees(goal.target)}
          </span>
        </div>

        <ProgressBar
          className="mt-4"
          value={Number(goal.saved)}
          max={Number(goal.target)}
          label={`${goal.name}: ${formatRupees(goal.saved)} of ${formatRupees(goal.target)} saved`}
        />

        <div className="mt-3 flex items-center justify-between">
          <span className="text-small text-muted-foreground">{habit.short}</span>
          <span className="text-small text-muted-foreground">
            {nowSeconds >= Number(goal.deadline)
              ? "Date has passed"
              : daysLeft === 1
                ? "1 day left"
                : `${daysLeft} days left`}
          </span>
        </div>

        <TestMoneyNote className="mt-4" />
      </Card>

      <Card>
        <StatRow label="You save">{formatRupees(goal.target)}</StatRow>
        <StatRow label="You staked">{formatRupees(goal.stake)}</StatRow>
        <StatRow label="Top-ups made">{String(goal.depositCount)}</StatRow>
      </Card>

      {/* What this is worth right now, in money, before anything is pressed. */}
      <OutcomeNote outcome={outcome} />

      {step === "add-money" ? (
        <Section title="Put more in">
          <AmountField
            label="How much?"
            value={topUp}
            onChange={setTopUp}
            size="body"
          />
          <div className="mt-4">
          <ActionButton
            pending={addMoney.isPending}
            pendingLabel="Adding…"
            disabled={!topUp.trim()}
            onClick={() => {
              let paise = 0n;
              try {
                paise = rupeesToPaise(topUp);
              } catch {
                toast.error("Enter an amount first.");
                return;
              }
              addMoney.mutate(
                {
                  goalId,
                  amountPaise: paise,
                  allowance: token?.allowance ?? 0n,
                },
                {
                  onSuccess: () => {
                    toast.success(`${formatRupees(paise)} added`);
                    setTopUp("");
                  },
                  onError: (err) => toast.error(savingsError(err)),
                }
              );
            }}
          >
            Add money
          </ActionButton>
          </div>
        </Section>
      ) : null}

      {step === "submit-habit" ? (
        <Section title="Mark the habit">
          <SelfReportedNote heading="Before you type a number" />
          {goal.behaviour === BehaviourType.SaveConsistently ? null : (
            <AmountField
              label="Steps today"
              value={steps}
              onChange={setSteps}
              size="body"
            />
          )}
          <div className="mt-4">
          <ActionButton
            pending={submitHabit.isPending}
            pendingLabel="Sending…"
            onClick={() =>
              submitHabit.mutate(
                { goalId, value: Number(steps.replace(/[^\d]/g, "")) || 0 },
                {
                  onSuccess: () => {
                    toast.success("Marked.");
                    setSteps("");
                  },
                  onError: (err) => toast.error(savingsError(err)),
                }
              )
            }
          >
            Mark it kept
          </ActionButton>
          </div>
        </Section>
      ) : null}

      {activity && activity.length > 0 ? (
        <Section title="What happened">
          <div className="divide-y rounded-lg border bg-card px-5">
            {activity.map((entry) => (
              <p key={entry.key} className="py-3 text-body text-foreground">
                {line(entry, goal.name)}
              </p>
            ))}
          </div>
          {/* Ordered, not dated: the contract keeps state, not times. */}
          <p className="mt-2 text-caption text-text-tertiary">
            In the order it happened. Exact times aren&apos;t recorded.
          </p>
        </Section>
      ) : null}

      <BonusSourceNote />

      {step === "close" || step === "claim" ? (
        <StickyAction>
          <ActionButton
            pending={pending}
            pendingLabel={step === "close" ? "Closing…" : "Collecting…"}
            onClick={() => {
              const action = step === "close" ? closeGoal : claim;
              action.mutate(goalId, {
                onSuccess: () =>
                  toast.success(
                    step === "close" ? "Goal closed." : "Money collected."
                  ),
                onError: (err) => toast.error(savingsError(err)),
              });
            }}
          >
            {step === "close" ? "Close this goal" : "Collect what you are owed"}
          </ActionButton>
        </StickyAction>
      ) : null}
    </div>
  );
}

/** What the goal is worth, said in whichever way is true right now. */
function OutcomeNote({ outcome }: { outcome: ReturnType<typeof outcomeFor> }) {
  switch (outcome.kind) {
    case "waiting":
      return (
        <Alert tone="progress" title="Waiting on other people">
          {outcome.closed} of {outcome.total} goals finishing on your date have
          been closed. Yours can be settled once they all are.
        </Alert>
      );
    case "won":
      return (
        <Alert tone="good" title="You kept it">
          <StatRow label="Your stake, back">
            {formatRupees(outcome.stakeBack)}
          </StatRow>
          <StatRow label="Share from people who missed">
            {formatRupees(outcome.bonus)}
          </StatRow>
          {outcome.nobodyMissed ? (
            <p className="mt-3">
              Everybody on your date kept their goal, so there is nothing extra
              to share. That is the best outcome, not a disappointing one.
            </p>
          ) : null}
        </Alert>
      );
    case "refunded":
      return (
        <Alert tone="progress" title="Your stake comes back">
          Nobody finishing on your date kept their goal, so there is nothing to
          share out and every stake is returned in full.
        </Alert>
      );
    case "forfeited":
      return (
        <Alert tone="attention" title="The stake is gone">
          {formatRupees(outcome.stakeLost)} has gone to the people who kept
          their goals. What you saved still comes back in full.
        </Alert>
      );
    case "settled":
      return null;
  }
}

function line(
  entry: { kind: string; amount?: bigint; count?: number },
  name: string
): string {
  switch (entry.kind) {
    case "created":
      return `You started ${name}`;
    case "added":
      return `You put in ${formatRupees(entry.amount ?? 0n)}${
        entry.count && entry.count > 1 ? ` over ${entry.count} top-ups` : ""
      }`;
    case "habit":
      return "You marked the habit as kept";
    case "closed":
      return "The goal was closed, and you met it";
    case "forfeited":
      return "The goal was closed, and it was missed";
    case "settled":
      return "The money was shared out";
    default:
      return "Something happened";
  }
}

function Skeletons() {
  return (
    <div className="space-y-3">
      <div className="h-32 animate-pulse rounded-lg bg-muted" />
      <div className="h-40 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}

"use client";

/**
 * Start a savings goal.
 *
 * ──────────────── the stake is the whole point, so it is shown ────────────────
 *
 * A goal here is not a piggy bank. Ten percent of the target is put at risk on
 * top of what is saved, and it only comes back if the habit is kept. A form
 * that collected a target and a date without ever naming that number would be
 * taking money off somebody on the strength of a word they skimmed.
 *
 * So the stake appears the moment a target is typed, recalculated as they
 * type, in its own line that says what happens to it either way. It is not in
 * a tooltip and not in small print under the button.
 *
 * ──────────────── why the date is the last question ────────────────
 *
 * Deadlines group people: everybody who picks the same date shares whatever
 * the people who missed their goals forfeited. That is explained next to the
 * field rather than discovered afterwards, because "you are in a pool with
 * strangers" is the sort of thing somebody should get to decline.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell, StickyBar } from "@/components/app-shell";
import { LoginGate } from "@/components/login-gate";
import {
  AmountField,
  ChoiceGroup,
  DateField,
  NumberField,
  TextField,
} from "@/components/feature/fields";
import { SavingsNotSetUp, SelfReportedNote } from "@/components/feature/savings/notes";
import { Alert, StatRow, TestMoneyNote } from "@/components/feature/primitives";
import { ActionButton } from "@/components/feature/action-button";
import { ready, BEHAVIOUR_SAVINGS_ADDRESS } from "@/lib/contracts";
import {
  dateInputDaysAhead,
  deadlineFromDateInput,
  habitOptions,
  stakeFor,
  type HabitKind,
} from "@/lib/features/savings-state";
import {
  savingsError,
  useCreateGoal,
  useExternalSignalReady,
} from "@/lib/features/savings";
import { formatRupees, rupeesToPaise } from "@/lib/money";
import { useTokenState } from "@/lib/token";

export default function NewGoalPage() {
  return (
    <AppShell back="/savings" title="Start a goal">
      <LoginGate>
        <NewGoal />
      </LoginGate>
    </AppShell>
  );
}

function NewGoal() {
  const router = useRouter();
  const create = useCreateGoal();
  const { data: signalReady } = useExternalSignalReady();
  const { data: token } = useTokenState(BEHAVIOUR_SAVINGS_ADDRESS);

  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [habit, setHabit] = useState<HabitKind>("consistent");
  const [dailyTarget, setDailyTarget] = useState(8000);
  const [date, setDate] = useState(dateInputDaysAhead(30));

  if (!ready.savings) return <SavingsNotSetUp />;

  const options = habitOptions(Boolean(signalReady));
  const chosen = options.find((o) => o.kind === habit);

  let targetPaise = 0n;
  try {
    targetPaise = target.trim() ? rupeesToPaise(target) : 0n;
  } catch {
    targetPaise = 0n;
  }
  const stake = targetPaise > 0n ? stakeFor(targetPaise) : 0n;

  const valid =
    name.trim().length > 0 && targetPaise > 0n && date.trim().length > 0;

  const submit = () => {
    if (!name.trim()) return toast.error("Give the goal a name.");
    if (targetPaise <= 0n) return toast.error("Set how much you want to save.");

    let deadline: bigint;
    try {
      deadline = deadlineFromDateInput(date);
    } catch {
      return toast.error("Pick a date.");
    }

    create.mutate(
      {
        name: name.trim(),
        targetPaise,
        deadline,
        habit,
        dailyTarget: chosen?.dailyTarget ? dailyTarget : undefined,
        allowance: token?.allowance ?? 0n,
      },
      {
        onSuccess: ({ goalId }) => {
          toast.success("Your goal is set.");
          router.push(`/savings/${goalId}`);
        },
        onError: (err) => toast.error(savingsError(err)),
      }
    );
  };

  return (
    <div className="space-y-8 pb-4">
      <TextField
        label="What are you saving for?"
        value={name}
        onChange={setName}
        placeholder="New laptop"
      />

      <AmountField
        label="How much do you want to save?"
        value={target}
        onChange={setTarget}
        hint="You get all of this back when the goal ends, whatever happens."
      />

      <ChoiceGroup
        label="What habit are you keeping?"
        value={habit}
        onChange={setHabit}
        options={options.map((o) => ({
          value: o.kind,
          title: o.title,
          body: o.available ? o.body : o.unavailableBecause,
        }))}
      />

      {chosen?.dailyTarget ? (
        <NumberField
          label="Steps a day"
          value={dailyTarget}
          onChange={setDailyTarget}
          min={1000}
          max={50000}
          hint="A note to yourself, not a rule the software checks."
        />
      ) : null}

      <DateField
        label="Finish by"
        value={date}
        onChange={setDate}
        min={dateInputDaysAhead(7)}
        max={dateInputDaysAhead(365)}
        hint="Anyone finishing on the same date shares what the people who miss their goals leave behind."
      />

      {/* The consequence, in money, as soon as there is a number to show. */}
      {stake > 0n ? (
        <Alert tone="attention" title="What you are putting at risk">
          <StatRow label="You save">{formatRupees(targetPaise)}</StatRow>
          <StatRow label="You also stake">{formatRupees(stake)}</StatRow>
          <p className="mt-3">
            The {formatRupees(targetPaise)} always comes back. The{" "}
            {formatRupees(stake)} only comes back if you keep the habit — if you
            do not, it goes to the people who did.
          </p>
        </Alert>
      ) : null}

      {chosen?.selfReported ? <SelfReportedNote /> : null}
      <TestMoneyNote />

      <StickyBar>
        <ActionButton
          disabled={!valid}
          pending={create.isPending}
          pendingLabel="Setting it up…"
          onClick={submit}
        >
          {stake > 0n ? `Start, and stake ${formatRupees(stake)}` : "Start a goal"}
        </ActionButton>
      </StickyBar>

      <p className="text-center text-caption text-text-tertiary">
        <Link href="/savings" className="underline underline-offset-4">
          Back to your goals
        </Link>
      </p>
    </div>
  );
}

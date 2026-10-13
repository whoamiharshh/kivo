"use client";

/**
 * Start a group commitment.
 *
 * ──────────────── the rule is shown as a sentence, not as fields ────────────────
 *
 * "Required days" and "grace days" are two numbers that mean nothing apart and
 * everything together. A form that collected them as separate inputs would let
 * somebody build a rule they never intended — 30 required with 29 grace reads
 * as a month of effort and is actually one day. So the two fields are followed
 * by `ruleSentence()`, which says the rule back in the words the pool will
 * enforce, and it updates as they type.
 *
 * ──────────────── the stake is named before the button ────────────────
 *
 * Everybody puts in the same amount and it is genuinely at risk. The screen
 * shows that number and what happens to it either way, immediately above the
 * action, because this is the part somebody will be angry about if they missed
 * it.
 */

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
import { ActionButton } from "@/components/feature/action-button";
import { Alert, StatRow, TestMoneyNote } from "@/components/feature/primitives";
import { ACCOUNTABILITY_POOL_ADDRESS, ready } from "@/lib/contracts";
import {
  EARLIEST_DEADLINE_DAYS,
  LATEST_DEADLINE_DAYS,
  MAX_MEMBERS,
  METRICS,
  MIN_MEMBERS,
  readablePoolError,
  ruleSentence,
  useCreatePool,
  type BehaviourMetric,
} from "@/lib/features/pool";
import { dateInputDaysAhead, deadlineFromDateInput } from "@/lib/features/savings-state";
import { formatRupees, rupeesToPaise } from "@/lib/money";
import { useTokenState } from "@/lib/token";

export default function NewPoolPage() {
  return (
    <AppShell back="/pools" title="Start a commitment">
      <LoginGate>
        <NewPool />
      </LoginGate>
    </AppShell>
  );
}

function NewPool() {
  const router = useRouter();
  const create = useCreatePool();
  const { data: token } = useTokenState(ACCOUNTABILITY_POOL_ADDRESS);

  const [commitment, setCommitment] = useState("");
  const [metric, setMetric] = useState<BehaviourMetric>("steps");
  const [stake, setStake] = useState("");
  const [date, setDate] = useState(dateInputDaysAhead(14));
  const [requiredDays, setRequiredDays] = useState(10);
  const [graceDays, setGraceDays] = useState(2);
  const [maxMembers, setMaxMembers] = useState(5);
  const [myName, setMyName] = useState("");

  if (!ready.pools) {
    return (
      <Alert tone="attention" title="Not set up yet">
        Group commitments need one more address in this app&apos;s settings.
      </Alert>
    );
  }

  let stakePaise = 0n;
  try {
    stakePaise = stake.trim() ? rupeesToPaise(stake) : 0n;
  } catch {
    stakePaise = 0n;
  }

  // Grace can never reach required: that would be a rule with nothing in it.
  const grace = Math.min(graceDays, Math.max(0, requiredDays - 1));
  const valid = commitment.trim().length > 0 && stakePaise > 0n;

  const submit = () => {
    if (!commitment.trim()) {
      toast.error("Say what the group is agreeing to.");
      return;
    }
    if (stakePaise <= 0n) {
      toast.error("Set a stake above zero.");
      return;
    }

    let deadline: bigint;
    try {
      deadline = deadlineFromDateInput(date);
    } catch {
      toast.error("Pick a date.");
      return;
    }

    create.mutate(
      {
        commitment: commitment.trim(),
        metric,
        stakePaise,
        deadline,
        requiredDays,
        graceDays: grace,
        maxMembers,
        myName: myName.trim(),
        allowance: token?.allowance ?? 0n,
      },
      {
        onSuccess: (poolId) => {
          toast.success("Your commitment is live. Share it with the group.");
          router.push(`/pools/${poolId}`);
        },
        onError: (err) => toast.error(readablePoolError(err)),
      }
    );
  };

  return (
    <div className="space-y-8 pb-4">
      <TextField
        label="What is the group agreeing to?"
        value={commitment}
        onChange={setCommitment}
        placeholder="Run every morning before class"
      />

      <ChoiceGroup
        label="What does everyone report each day?"
        value={metric}
        onChange={setMetric}
        options={METRICS.map((m) => ({
          value: m.value,
          title: m.title,
          body: m.body,
        }))}
      />

      <AmountField
        label="What does each person stake?"
        value={stake}
        onChange={setStake}
        hint="Everybody puts in the same amount."
      />

      <DateField
        label="Last day"
        value={date}
        onChange={setDate}
        min={dateInputDaysAhead(EARLIEST_DEADLINE_DAYS)}
        max={dateInputDaysAhead(LATEST_DEADLINE_DAYS)}
      />

      <NumberField
        label="Days each person must mark"
        value={requiredDays}
        onChange={setRequiredDays}
        min={1}
        max={365}
      />

      <NumberField
        label="Days they are allowed to miss"
        value={grace}
        onChange={setGraceDays}
        min={0}
        max={Math.max(0, requiredDays - 1)}
      />

      {/* The two numbers above, said back as the rule they actually make. */}
      <Alert tone="progress" title="The rule">
        {ruleSentence({ requiredDays, graceDays: grace })}
      </Alert>

      <NumberField
        label="How many people can join?"
        value={maxMembers}
        onChange={setMaxMembers}
        min={MIN_MEMBERS}
        max={MAX_MEMBERS}
      />

      <TextField
        label="Your name, for the others"
        value={myName}
        onChange={setMyName}
        placeholder="Your first name"
      />

      {stakePaise > 0n ? (
        <Alert tone="attention" title="What you are putting at risk">
          <StatRow label="Your stake">{formatRupees(stakePaise)}</StatRow>
          <p className="mt-3">
            Keep the rule and it comes back, with a share of whatever the people
            who missed it left behind. Miss it and your stake goes to the people
            who kept it.
          </p>
        </Alert>
      ) : null}

      <TestMoneyNote />

      <StickyBar>
        <ActionButton
          disabled={!valid}
          pending={create.isPending}
          pendingLabel="Starting…"
          onClick={submit}
        >
          {stakePaise > 0n
            ? `Start, and stake ${formatRupees(stakePaise)}`
            : "Start a commitment"}
        </ActionButton>
      </StickyBar>
    </div>
  );
}

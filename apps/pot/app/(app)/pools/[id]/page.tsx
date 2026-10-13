"use client";

/**
 * One group commitment.
 *
 * ──────────────── the leaderboard is the screen ────────────────
 *
 * The thing that makes a pool work is seeing where everybody else is. Not as a
 * scoreboard with winners at the top — that rewards whoever started earliest —
 * but as a plain list of who has marked how many days, with the signed-in
 * person's own row in it like anybody else's. Shame is not the mechanism here;
 * the stake is. The list just has to be honest.
 *
 * ──────────────── one action, chosen by the contract's state ────────────────
 *
 * Join, mark today, settle, claim. Exactly one of those is ever available, and
 * `pendingAction` — the same pure function the list screen uses — decides
 * which. The two screens therefore cannot disagree about whose turn it is.
 *
 * Settling is worth a word: once the last day passes somebody has to tally the
 * pool before anybody can take money out, and the contract lets anyone do it.
 * So the button appears for whoever opens the screen first, and it is
 * described as a job rather than a reward.
 */

import { Suspense, use, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { LoginGate } from "@/components/login-gate";
import { ActionButton, StickyAction } from "@/components/feature/action-button";
import { AmountField, TextField } from "@/components/feature/fields";
import {
  Alert,
  Amount,
  Card,
  MemberRow,
  Section,
  StatRow,
  StatusBadge,
  TestMoneyNote,
} from "@/components/feature/primitives";
import { ProgressBar } from "@/components/feature/progress-bar";
import { ACCOUNTABILITY_POOL_ADDRESS, ready } from "@/lib/contracts";
import {
  daysLeftToMark,
  describePool,
  memberStateLabel,
  metricInfo,
  pendingAction,
  poolTitle,
  readablePoolError,
  ruleSentence,
  useClaimPool,
  useJoinPool,
  useMarkToday,
  usePool,
  useSettlePool,
} from "@/lib/features/pool";
import { formatRupees } from "@/lib/money";
import { useNowSeconds } from "@/lib/now";
import { useTokenState } from "@/lib/token";

export default function PoolPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <AppShell back="/pools" title="Group commitment">
      <LoginGate>
        <Suspense fallback={<Skeletons />}>
          <PoolRoute params={params} />
        </Suspense>
      </LoginGate>
    </AppShell>
  );
}

function PoolRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const poolId = Number(id);

  if (!ready.pools) {
    return (
      <Alert tone="attention" title="Not set up yet">
        Group commitments need one more address in this app&apos;s settings.
      </Alert>
    );
  }
  if (!Number.isSafeInteger(poolId) || poolId < 0) {
    return (
      <Alert tone="over" title="No such commitment">
        That link does not point at a group commitment.
      </Alert>
    );
  }
  return <PoolDetail poolId={poolId} />;
}

function PoolDetail({ poolId }: { poolId: number }) {
  const nowSeconds = useNowSeconds(60_000);
  const { data, isLoading } = usePool(poolId);
  const { data: token } = useTokenState(ACCOUNTABILITY_POOL_ADDRESS);

  const join = useJoinPool();
  const mark = useMarkToday();
  const settle = useSettlePool();
  const claim = useClaimPool();

  const [myName, setMyName] = useState("");
  const [value, setValue] = useState("");

  if (isLoading) return <Skeletons />;
  if (!data) {
    return (
      <Alert tone="over" title="No such commitment">
        This commitment does not exist.
      </Alert>
    );
  }

  const { view, members } = data;
  const { status, tone } = describePool(view, nowSeconds);
  const action = pendingAction(view, nowSeconds);
  const metric = metricInfo(view.metric);
  const left = daysLeftToMark(view.deadline, nowSeconds);
  const needed = view.requiredDays - view.graceDays;
  const pending =
    join.isPending || mark.isPending || settle.isPending || claim.isPending;

  return (
    <div className="space-y-6 pb-4">
      <div className="flex items-start justify-between gap-3">
        <h1 className="min-w-0 flex-1 text-h1 text-foreground">
          {poolTitle(view)}
        </h1>
        <StatusBadge tone={tone}>{status}</StatusBadge>
      </div>

      <Card>
        <p className="text-small text-muted-foreground">In the pool</p>
        <div className="mt-1">
          <Amount paise={view.pot} size="display" />
        </div>

        {view.me.joined ? (
          <>
            <ProgressBar
              className="mt-4"
              value={Math.min(view.me.daysAttested, needed)}
              max={needed > 0 ? needed : 1}
              label={`Your progress: ${view.me.daysAttested} of ${needed} days marked`}
            />
            <div className="mt-3 flex items-center justify-between">
              <span className="text-small text-muted-foreground">
                You have marked {view.me.daysAttested} of {needed}
              </span>
              <span className="text-small text-muted-foreground">
                {left === 0
                  ? "Last day has passed"
                  : left === 1
                    ? "1 day left"
                    : `${left} days left`}
              </span>
            </div>
          </>
        ) : null}

        <TestMoneyNote className="mt-4" />
      </Card>

      <Card>
        <StatRow label="Stake each">{formatRupees(view.stakePerMember)}</StatRow>
        <StatRow label="People">
          {view.memberCount} of {view.maxMembers}
        </StatRow>
        <StatRow label="Reported each day">{metric.title}</StatRow>
      </Card>

      <Alert tone="progress" title="The rule">
        {ruleSentence(view)}
      </Alert>

      <Section title="Who is in it">
        <div className="divide-y rounded-lg border bg-card px-5">
          {members.map((member) => {
            const label = memberStateLabel(view, member, nowSeconds);
            return (
              <MemberRow
                key={member.address}
                name={member.isYou ? `${member.name} (you)` : member.name}
                detail={`${member.daysAttested} of ${needed} days`}
                state={label.state}
                stateLabel={label.label}
              />
            );
          })}
        </div>
      </Section>

      {/* Marking is a tap, and the screen never pretends otherwise. */}
      {action === "mark" ? (
        <Section title="Mark today">
          <Alert tone="attention" title="This is self-reported">
            Nothing here checks whether you did it. The others are trusting you.
          </Alert>
          <div className="mt-4">
            <AmountField
              label={metric.fieldLabel}
              value={value}
              onChange={setValue}
              size="body"
            />
          </div>
          <div className="mt-4">
            <ActionButton
              pending={mark.isPending}
              pendingLabel="Marking…"
              onClick={() =>
                mark.mutate(
                  {
                    poolId,
                    metric: view.metric,
                    value: Number(value.replace(/[^\d]/g, "")) || 0,
                  },
                  {
                    onSuccess: () => {
                      toast.success("Today is marked.");
                      setValue("");
                    },
                    onError: (err) => toast.error(readablePoolError(err)),
                  }
                )
              }
            >
              Mark today
            </ActionButton>
          </div>
        </Section>
      ) : null}

      {action === "join" ? (
        <Section title="Join this commitment">
          <TextField
            label="Your name, for the others"
            value={myName}
            onChange={setMyName}
            placeholder="Your first name"
          />
          <div className="mt-4">
            <Alert tone="attention" title="What you are putting at risk">
              <StatRow label="Your stake">
                {formatRupees(view.stakePerMember)}
              </StatRow>
              <p className="mt-3">{ruleSentence(view)}</p>
            </Alert>
          </div>
        </Section>
      ) : null}

      {action ? (
        <StickyAction>
          <ActionButton
            pending={pending}
            pendingLabel={
              action === "join"
                ? "Joining…"
                : action === "settle"
                  ? "Working it out…"
                  : "Collecting…"
            }
            onClick={() => {
              if (action === "join") {
                join.mutate(
                  {
                    poolId,
                    stakePaise: view.stakePerMember,
                    allowance: token?.allowance ?? 0n,
                    myName: myName.trim(),
                  },
                  {
                    onSuccess: () => toast.success("You are in."),
                    onError: (err) => toast.error(readablePoolError(err)),
                  }
                );
              } else if (action === "settle") {
                settle.mutate(poolId, {
                  onSuccess: () =>
                    toast.success("Worked out. Money can be collected."),
                  onError: (err) => toast.error(readablePoolError(err)),
                });
              } else if (action === "claim") {
                claim.mutate(poolId, {
                  onSuccess: () => toast.success("Collected."),
                  onError: (err) => toast.error(readablePoolError(err)),
                });
              }
            }}
          >
            {action === "join"
              ? `Join, and stake ${formatRupees(view.stakePerMember)}`
              : action === "settle"
                ? "Work out who kept it"
                : `Collect ${formatRupees(
                    view.claimableStake + view.claimableBonus
                  )}`}
          </ActionButton>
        </StickyAction>
      ) : null}
    </div>
  );
}

function Skeletons() {
  return (
    <div className="space-y-3">
      <div className="h-32 animate-pulse rounded-lg bg-muted" />
      <div className="h-44 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}

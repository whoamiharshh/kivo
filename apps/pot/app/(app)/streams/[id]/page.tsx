"use client";

/**
 * One arrangement, ticking.
 *
 * ──────────────── the number has to move ────────────────
 *
 * Being paid by the second is only meaningfully different from being paid
 * monthly if you can watch it happen. So the headline figure is recomputed
 * every second from the rate and the clock, using `project()` — the same pure
 * function the list screen uses and the contract's own `earned` agrees with.
 *
 * This is interpolation between contract reads, not a guess: the rate is
 * fixed, so the figure between two reads is arithmetic rather than optimism.
 * The contract stays the source of truth and the query refetches underneath.
 *
 * ──────────────── two people, two different screens ────────────────
 *
 * The payer sees what is still theirs and how long the money lasts. The person
 * earning sees what is ready to take. `pendingAction()` decides which single
 * action is on offer, so this screen and the list cannot disagree.
 *
 * Stopping the clock is deliberately quiet. It takes nothing from anybody and
 * either side may do it, so it sits below the main action rather than
 * competing with it.
 */

import { Suspense, use, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { LoginGate } from "@/components/login-gate";
import { ActionButton, StickyAction } from "@/components/feature/action-button";
import { AmountField } from "@/components/feature/fields";
import {
  Alert,
  Amount,
  Card,
  Section,
  StatRow,
  StatusBadge,
  TestMoneyNote,
} from "@/components/feature/primitives";
import { SALARY_STREAM_ADDRESS, ready } from "@/lib/contracts";
import {
  StreamState,
  describe,
  momentLabel,
  pendingAction,
  project,
  spanLabel,
  streamError,
  useAddStreamFunds,
  useCloseStream,
  usePauseStream,
  useResumeStream,
  useStream,
  useStreamActivity,
  useWithdrawPay,
} from "@/lib/features/stream";
import { formatRupees, rupeesToPaise } from "@/lib/money";
import { useNowSeconds } from "@/lib/now";
import { useTokenState } from "@/lib/token";

export default function StreamPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <AppShell back="/streams" title="Pay as it earns">
      <LoginGate>
        <Suspense fallback={<Skeletons />}>
          <StreamRoute params={params} />
        </Suspense>
      </LoginGate>
    </AppShell>
  );
}

function StreamRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const streamId = Number(id);

  if (!ready.streams) {
    return (
      <Alert tone="attention" title="Not set up yet">
        This needs one more address in the app&apos;s settings.
      </Alert>
    );
  }
  if (!Number.isSafeInteger(streamId) || streamId < 0) {
    return (
      <Alert tone="over" title="Nothing here">
        That link does not point at an arrangement.
      </Alert>
    );
  }
  return <StreamDetail streamId={streamId} />;
}

function StreamDetail({ streamId }: { streamId: number }) {
  // Once a second: this figure is the feature.
  const nowSeconds = useNowSeconds(1000);
  const { data: stream, isLoading } = useStream(streamId);
  const { data: history } = useStreamActivity(streamId);
  const { data: token } = useTokenState(SALARY_STREAM_ADDRESS);

  const addFunds = useAddStreamFunds();
  const withdraw = useWithdrawPay();
  const pause = usePauseStream();
  const resume = useResumeStream();
  const close = useCloseStream();

  const [topUp, setTopUp] = useState("");

  if (isLoading) return <Skeletons />;
  if (!stream) {
    return (
      <Alert tone="over" title="Nothing here">
        This arrangement does not exist, or it was never yours.
      </Alert>
    );
  }

  const f = project(stream, nowSeconds);
  const { status, tone } = describe(stream, nowSeconds);
  const action = pendingAction(stream, nowSeconds);
  const pending =
    addFunds.isPending ||
    withdraw.isPending ||
    pause.isPending ||
    resume.isPending ||
    close.isPending;

  return (
    <div className="space-y-6 pb-4">
      <div className="flex items-start justify-between gap-3">
        <h1 className="min-w-0 flex-1 text-h1 text-foreground">
          {stream.paying
            ? `Paying ${stream.otherName}`
            : `From ${stream.otherName}`}
        </h1>
        <StatusBadge tone={tone}>{status}</StatusBadge>
      </div>

      <Card>
        <p className="text-small text-muted-foreground">
          {stream.paying ? "Still yours" : "Ready to take"}
        </p>
        <div className="mt-1">
          <Amount
            paise={stream.paying ? f.stillFunded : f.withdrawable}
            size="display"
          />
        </div>
        <p className="tabular mt-2 text-body text-muted-foreground">
          {formatRupees(f.perDay)} a day
          {f.accruing ? ", building up right now" : ""}
        </p>
        <TestMoneyNote className="mt-4" />
      </Card>

      <Card>
        <StatRow label="Built up so far">{formatRupees(f.earned)}</StatRow>
        <StatRow label="Already taken">{formatRupees(f.withdrawn)}</StatRow>
        {stream.paying ? (
          <StatRow label="Money put in">{formatRupees(stream.funded)}</StatRow>
        ) : null}
        {f.accruing && f.fundingSecondsLeft > 0 ? (
          <StatRow label="Money lasts">
            {spanLabel(f.fundingSecondsLeft)}
          </StatRow>
        ) : null}
        <StatRow label="Term ends">
          {momentLabel(Number(stream.endTime))}
        </StatRow>
      </Card>

      {/* The one state worth interrupting about: nothing is building up. */}
      {f.dry ? (
        <Alert tone="attention" title="Nothing is building up">
          {stream.paying
            ? "The money you put in has all been earned. Add more to keep it going."
            : `${stream.otherName} has not put in enough to keep this going. What you have already earned is still yours to take.`}
        </Alert>
      ) : null}

      {stream.paying && f.lowRunway && !f.ended && !f.dry ? (
        <Alert tone="attention" title="Running low">
          At this rate the money you put in lasts about{" "}
          {spanLabel(f.fundingSecondsLeft)}.
        </Alert>
      ) : null}

      {stream.paying ? (
        <Section title="Put more in">
          <AmountField
            label="How much?"
            value={topUp}
            onChange={setTopUp}
            size="body"
          />
          <div className="mt-4">
            <ActionButton
              pending={addFunds.isPending}
              pendingLabel="Adding…"
              disabled={!topUp.trim()}
              onClick={() => {
                let amountPaise = 0n;
                try {
                  amountPaise = rupeesToPaise(topUp);
                } catch {
                  toast.error("Enter an amount first.");
                  return;
                }
                addFunds.mutate(
                  { streamId, amountPaise, allowance: token?.allowance ?? 0n },
                  {
                    onSuccess: () => {
                      toast.success(`${formatRupees(amountPaise)} added`);
                      setTopUp("");
                    },
                    onError: (err) => toast.error(streamError(err)),
                  }
                );
              }}
            >
              Add money
            </ActionButton>
          </div>
        </Section>
      ) : null}

      {history && history.length > 0 ? (
        <Section title="What happened">
          <div className="divide-y rounded-lg border bg-card px-5">
            {history.map((entry) => (
              <p key={entry.key} className="py-3 text-body text-foreground">
                {line(entry, stream.paying, stream.otherName)}
              </p>
            ))}
          </div>
          <p className="mt-2 text-caption text-text-tertiary">
            In the order it happened. Exact times aren&apos;t recorded.
          </p>
        </Section>
      ) : null}

      {/* Quiet, below the main action: it takes nothing from anybody. */}
      {stream.state !== StreamState.Cancelled ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            const paused = stream.state === StreamState.Paused;
            const m = paused ? resume : pause;
            m.mutate(streamId, {
              onSuccess: () =>
                toast.success(paused ? "Started again." : "Stopped for now."),
              onError: (err) => toast.error(streamError(err)),
            });
          }}
          className="text-small font-semibold text-muted-foreground underline underline-offset-4"
        >
          {stream.state === StreamState.Paused
            ? "Start it again"
            : "Stop the clock for now"}
        </button>
      ) : null}

      {action ? (
        <StickyAction>
          <ActionButton
            pending={pending}
            pendingLabel={action === "withdraw" ? "Taking…" : "Closing…"}
            onClick={() => {
              if (action === "withdraw") {
                withdraw.mutate(streamId, {
                  onSuccess: () =>
                    toast.success(`${formatRupees(f.withdrawable)} is now yours`),
                  onError: (err) => toast.error(streamError(err)),
                });
              } else if (action === "collect") {
                close.mutate(streamId, {
                  onSuccess: () =>
                    toast.success("Closed, and the rest is back."),
                  onError: (err) => toast.error(streamError(err)),
                });
              }
            }}
          >
            {action === "withdraw"
              ? `Take ${formatRupees(f.withdrawable)}`
              : action === "collect"
                ? `Close, and take back ${formatRupees(f.stillFunded)}`
                : "Add money"}
          </ActionButton>
        </StickyAction>
      ) : null}
    </div>
  );
}

function line(
  entry: { kind: string; amount?: bigint; returned?: bigint },
  paying: boolean,
  otherName: string
): string {
  switch (entry.kind) {
    case "started":
      return paying
        ? `You set this up and put in ${formatRupees(entry.amount ?? 0n)}`
        : `${otherName} set this up`;
    case "added":
      return paying
        ? `You put in ${formatRupees(entry.amount ?? 0n)}`
        : `${otherName} put more in`;
    case "withdrawn":
      return paying
        ? `${otherName} has taken ${formatRupees(entry.amount ?? 0n)}`
        : `You have taken ${formatRupees(entry.amount ?? 0n)}`;
    case "paused":
      return "The clock was stopped";
    case "resumed":
      return "The clock was started again";
    case "closed":
      return `It was closed. ${formatRupees(
        entry.returned ?? 0n
      )} went back to the payer.`;
    default:
      return "Something happened";
  }
}

function Skeletons() {
  return (
    <div className="space-y-3">
      <div className="h-36 animate-pulse rounded-lg bg-muted" />
      <div className="h-40 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}

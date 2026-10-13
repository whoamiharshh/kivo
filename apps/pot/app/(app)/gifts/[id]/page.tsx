"use client";

/**
 * One gift.
 *
 * ──────────────── three people, one screen ────────────────
 *
 * A gift is read by the giver, by the recipient, and sometimes by a third
 * person who has to confirm something. Each of them can do exactly one thing,
 * and `pendingAction()` — the same pure function the list uses — decides
 * which. The list and this screen therefore cannot disagree about whose turn
 * it is.
 *
 * ──────────────── the escape hatch is named up front ────────────────
 *
 * The obvious objection to "somebody confirms it" is: what if they never do?
 * The contract answers with a timeout, after which the recipient can take the
 * gift anyway. That is shown while the gift is still waiting, not discovered
 * later by somebody who had already given up. A promise with a visible floor
 * is worth more than one that quietly has one.
 */

import { Suspense, use, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { LoginGate } from "@/components/login-gate";
import { ActionButton, StickyAction } from "@/components/feature/action-button";
import { TextField } from "@/components/feature/fields";
import {
  Alert,
  Amount,
  Card,
  Section,
  StatRow,
  StatusBadge,
  TestMoneyNote,
} from "@/components/feature/primitives";
import { ready } from "@/lib/contracts";
import {
  CONFIRMER_DISCLOSURE,
  ConditionType,
  dayLabel,
  describeGift,
  giftError,
  giftTitle,
  pendingAction,
  secondsUntilTimeout,
  useCancelGift,
  useClaimGift,
  useConfirmGift,
  useGift,
  useReleaseGift,
  waitLabel,
} from "@/lib/features/gift";
import { formatRupees } from "@/lib/money";
import { useNowSeconds } from "@/lib/now";
import { useAppWallet } from "@/lib/tx";

export default function GiftPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <AppShell back="/gifts" title="Gift">
      <LoginGate>
        <Suspense fallback={<Skeletons />}>
          <GiftRoute params={params} />
        </Suspense>
      </LoginGate>
    </AppShell>
  );
}

function GiftRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const giftId = Number(id);

  if (!ready.gifts) {
    return (
      <Alert tone="attention" title="Not set up yet">
        Gifts need one more address in this app&apos;s settings.
      </Alert>
    );
  }
  if (!Number.isSafeInteger(giftId) || giftId < 0) {
    return (
      <Alert tone="over" title="Nothing here">
        That link does not point at a gift.
      </Alert>
    );
  }
  return <GiftDetail giftId={giftId} />;
}

function GiftDetail({ giftId }: { giftId: number }) {
  const nowSeconds = useNowSeconds(60_000);
  const { address } = useAppWallet();
  const { data: gift, isLoading } = useGift(giftId);

  const claim = useClaimGift();
  const cancel = useCancelGift();
  const confirm = useConfirmGift();
  const release = useReleaseGift();

  const [evidence, setEvidence] = useState("");

  if (isLoading) return <Skeletons />;
  if (!gift) {
    return (
      <Alert tone="over" title="Nothing here">
        This gift does not exist, or it was never yours to see.
      </Alert>
    );
  }

  const { status, tone } = describeGift(gift, nowSeconds);
  const action = pendingAction(gift, address, nowSeconds);
  const isDate = gift.conditionType === ConditionType.Time;
  const untilTimeout = secondsUntilTimeout(gift, nowSeconds);
  const pending =
    claim.isPending ||
    cancel.isPending ||
    confirm.isPending ||
    release.isPending;

  return (
    <div className="space-y-6 pb-4">
      <div className="flex items-start justify-between gap-3">
        <h1 className="min-w-0 flex-1 text-h1 text-foreground">
          {gift.sending ? `For ${gift.otherName}` : `From ${gift.otherName}`}
        </h1>
        <StatusBadge tone={tone}>{status}</StatusBadge>
      </div>

      <Card>
        <div>
          <Amount paise={gift.amount} size="display" />
        </div>
        {gift.message.trim() ? (
          <p className="mt-2 text-body text-muted-foreground">
            {giftTitle(gift)}
          </p>
        ) : null}
        <TestMoneyNote className="mt-4" />
      </Card>

      <Card>
        <StatRow label="Unlocks">
          {isDate
            ? `on ${dayLabel(Number(gift.releaseTime))}`
            : "when it is confirmed"}
        </StatRow>
        <StatRow label="Can the giver take it back?">
          {gift.irrevocable
            ? "No, it was promised firmly"
            : "Yes, while waiting"}
        </StatRow>
        <StatRow label="Set aside on">
          {dayLabel(Number(gift.createdAt))}
        </StatRow>
      </Card>

      {!isDate ? (
        <Alert tone="attention" title="How this gets confirmed">
          <p>{CONFIRMER_DISCLOSURE}</p>
          {untilTimeout > 0 ? (
            <p className="mt-3">
              If nobody confirms it, {gift.sending ? gift.otherName : "you"} can
              take it anyway {waitLabel(untilTimeout)}.
            </p>
          ) : (
            <p className="mt-3">
              Nobody confirmed it in time, so it can be taken anyway now.
            </p>
          )}
        </Alert>
      ) : null}

      {action === "confirm" ? (
        <Section title="Confirm it happened">
          <Alert tone="attention" title="You were picked for this">
            Both of them trusted you to say whether this happened. Nothing here
            checks it for you.
          </Alert>
          <div className="mt-4">
            <TextField
              label="What are you confirming? (optional)"
              value={evidence}
              onChange={setEvidence}
              placeholder="Saw the results today"
            />
          </div>
        </Section>
      ) : null}

      {action ? (
        <StickyAction>
          <ActionButton
            pending={pending}
            pendingLabel={
              action === "confirm"
                ? "Confirming…"
                : action === "cancel"
                  ? "Taking it back…"
                  : "Taking…"
            }
            onClick={() => {
              if (action === "claim") {
                claim.mutate(giftId, {
                  onSuccess: () =>
                    toast.success(`${formatRupees(gift.amount)} is yours`),
                  onError: (err) => toast.error(giftError(err)),
                });
              } else if (action === "release") {
                release.mutate(giftId, {
                  onSuccess: () =>
                    toast.success(`${formatRupees(gift.amount)} is yours`),
                  onError: (err) => toast.error(giftError(err)),
                });
              } else if (action === "cancel") {
                cancel.mutate(giftId, {
                  onSuccess: () => toast.success("Taken back."),
                  onError: (err) => toast.error(giftError(err)),
                });
              } else if (action === "confirm") {
                confirm.mutate(
                  { giftId, evidence },
                  {
                    onSuccess: () => {
                      toast.success("Confirmed. They can take it now.");
                      setEvidence("");
                    },
                    onError: (err) => toast.error(giftError(err)),
                  }
                );
              }
            }}
          >
            {action === "claim" || action === "release"
              ? `Take ${formatRupees(gift.amount)}`
              : action === "cancel"
                ? "Take it back"
                : "Yes, it happened"}
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
      <div className="h-40 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}

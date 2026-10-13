"use client";

/**
 * One policy.
 *
 * ──────────────── what is offered, and what is deliberately not ────────────────
 *
 * Every button here is one the signed-in person can really press and have work:
 * take the premium back once the wait is over, record a claim on cover that is
 * in force, close cover that ended unclaimed. Each is permissionless or limited
 * to the person it is shown to, and none needs the insurer.
 *
 * What is *not* here: binding a policy, declining to bind one, topping up the
 * payout reserve, and deciding a claim. Those are the insurer's, and on this
 * deployment the insurer's keys are the two that are treated as compromised and
 * switched off. They are not hidden — a policy that can never be taken on has to
 * say why — they are explained in words (`INSURER_UNAVAILABLE`) and given no
 * button. The "stand-in insurer" hooks in `lib/features/cover.ts` are not called
 * from this file: a decision "made" by a button is a payout that never
 * happened, and this screen will not show one.
 */

import { Suspense, use, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { LoginGate } from "@/components/login-gate";
import { ActionButton, StickyAction } from "@/components/feature/action-button";
import { CoverTerms } from "@/components/feature/cover/cover-terms";
import {
  CoverNotSetUpNotice,
  NoEvidenceStoreNote,
  NotCoveredYetNotice,
  NotInsuranceNotice,
} from "@/components/feature/cover/cover-notices";
import { TextField } from "@/components/feature/fields";
import {
  Alert,
  Section,
  StatRow,
  StatusBadge,
} from "@/components/feature/primitives";
import { ready } from "@/lib/contracts";
import {
  coverError,
  useCloseEndedCover,
  usePolicy,
  usePolicyActivity,
  useRaiseClaim,
  useTakeBackPremium,
  type ActivityEntry,
} from "@/lib/features/cover";
import {
  COVER_SHAPES,
  ClaimState,
  INSURER_UNAVAILABLE,
  PolicyState,
  coverInForce,
  describe,
  momentLabel,
  pendingAction,
  refundOpensAt,
  relativeLabel,
  shortAddress,
} from "@/lib/features/cover-state";
import { formatRupees } from "@/lib/money";
import { useNowSeconds } from "@/lib/now";

export default function PolicyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <AppShell back="/cover" title="Cover">
      <LoginGate>
        <Suspense fallback={<Skeletons />}>
          <PolicyRoute params={params} />
        </Suspense>
      </LoginGate>
    </AppShell>
  );
}

function PolicyRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const policyId = Number(id);

  if (!ready.policies) return <CoverNotSetUpNotice />;
  // Policies are numbered from 1; there is no policy 0.
  if (!Number.isSafeInteger(policyId) || policyId < 1) {
    return (
      <Alert tone="over" title="Nothing here">
        That link does not point at a policy.
      </Alert>
    );
  }
  return <PolicyDetail policyId={policyId} />;
}

const ACTIVITY_LABEL: Record<ActivityEntry["kind"], string> = {
  created: "The premium was put in holding",
  activated: "An insurer took on the risk",
  refunded: "The premium was returned",
  claimed: "A claim was recorded",
  paid: "The claim was paid",
  declined: "The claim was declined",
  closed: "This cover was closed",
};

function PolicyDetail({ policyId }: { policyId: number }) {
  const nowSeconds = useNowSeconds(60_000);
  const { data: policy, isLoading } = usePolicy(policyId);
  const { data: activity } = usePolicyActivity(policyId);

  const takeBack = useTakeBackPremium();
  const raiseClaim = useRaiseClaim();
  const closeCover = useCloseEndedCover();

  const [account, setAccount] = useState("");

  if (isLoading) return <Skeletons />;
  if (!policy) {
    return (
      <Alert tone="over" title="Nothing here">
        This cover does not exist, or it was never yours to see.
      </Alert>
    );
  }

  const { status, tone } = describe(policy, nowSeconds);
  const action = pendingAction(policy, nowSeconds);
  const inForce = coverInForce(policy, nowSeconds);
  const escrowed = policy.state === PolicyState.Escrowed;
  const claimWaiting = policy.claim.state === ClaimState.Submitted;
  const busy =
    takeBack.isPending || raiseClaim.isPending || closeCover.isPending;

  // Nothing about the kind of cover is stored, so the generic exclusions are
  // the honest ones to show: "nothing is measured".
  const cannotCheck =
    COVER_SHAPES.find((s) => s.id === "other")?.cannotCheck ?? [];

  const waitsUntil = refundOpensAt(policy);

  return (
    <div className="space-y-6 pb-4">
      <NotInsuranceNotice />

      <div className="flex items-start justify-between gap-3">
        <h1 className="min-w-0 flex-1 text-h1 text-foreground">
          {policy.insuredIsMe ? "Your cover" : `Cover for ${shortAddress(policy.insured)}`}
        </h1>
        <StatusBadge tone={tone}>{status}</StatusBadge>
      </div>

      {escrowed ? <NotCoveredYetNotice /> : null}

      <CoverTerms
        terms={policy.terms}
        premiumPaise={policy.premium}
        coveragePaise={policy.coverage}
        startSeconds={Number(policy.startTime)}
        endSeconds={Number(policy.endTime)}
        cannotCheck={cannotCheck}
        nowSeconds={nowSeconds}
        inForce={inForce}
      />

      {!policy.payerIsMe || !policy.insuredIsMe ? (
        <div className="rounded-lg border bg-card px-5 py-2">
          <StatRow label="Paid for by">
            {policy.payerIsMe ? "You" : shortAddress(policy.payer)}
          </StatRow>
          <StatRow label="Covers">
            {policy.insuredIsMe ? "You" : shortAddress(policy.insured)}
          </StatRow>
        </div>
      ) : null}

      {/* What cannot happen here, said where it would matter. */}
      {escrowed ? (
        <Alert tone="attention" title="This can't start on this test setup">
          {INSURER_UNAVAILABLE.bind}
        </Alert>
      ) : null}

      {claimWaiting ? (
        <Alert tone="attention" title="This claim can't be decided here">
          {INSURER_UNAVAILABLE.decide}
        </Alert>
      ) : null}

      {escrowed && policy.payerIsMe && action !== "take-back-premium" ? (
        <Alert tone="progress" title="Taking the premium back">
          You can take {formatRupees(policy.premium)} back{" "}
          {nowSeconds >= waitsUntil
            ? "now"
            : `in ${relativeLabel(waitsUntil, nowSeconds)} (${momentLabel(waitsUntil)})`}
          . Nobody has to agree to it.
        </Alert>
      ) : null}

      {action === "claim" ? (
        <Section title="Record a claim">
          <TextField
            label="What happened?"
            value={account}
            onChange={setAccount}
            maxLength={200}
            placeholder="The screen cracked when my bag fell"
            hint="Only a fingerprint of this goes on record."
          />
          <div className="mt-3">
            <NoEvidenceStoreNote />
          </div>
          <Alert tone="attention" title="Recording is not being paid">
            {INSURER_UNAVAILABLE.decide}
          </Alert>
        </Section>
      ) : null}

      <Section title="What has happened">
        {activity && activity.length > 0 ? (
          <ol className="space-y-2">
            {activity.map((entry) => (
              <li
                key={entry.key}
                className="rounded-md border bg-card px-4 py-3 text-body text-foreground"
              >
                {ACTIVITY_LABEL[entry.kind]}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-small text-muted-foreground">
            Nothing yet beyond this being recorded.
          </p>
        )}
        <p className="mt-2 text-small text-muted-foreground">
          This is the order things happened in, not the times — the record keeps
          the order but not the hour.
        </p>
      </Section>

      {action === "take-back-premium" ||
      action === "close" ||
      (action === "claim" && account.trim()) ? (
        <StickyAction>
          <ActionButton
            pending={busy}
            pendingLabel={
              action === "take-back-premium"
                ? "Taking it back…"
                : action === "close"
                  ? "Closing…"
                  : "Recording…"
            }
            onClick={() => {
              if (action === "take-back-premium") {
                takeBack.mutate(policyId, {
                  onSuccess: () =>
                    toast.success(`${formatRupees(policy.premium)} is back with you`),
                  onError: (err) => toast.error(coverError(err)),
                });
              } else if (action === "close") {
                closeCover.mutate(policyId, {
                  onSuccess: () => toast.success("This cover is closed."),
                  onError: (err) => toast.error(coverError(err)),
                });
              } else if (action === "claim") {
                raiseClaim.mutate(
                  { policyId, account },
                  {
                    onSuccess: () => {
                      toast.success("Your claim is recorded. It has not been paid.");
                      setAccount("");
                    },
                    onError: (err) => toast.error(coverError(err)),
                  }
                );
              }
            }}
          >
            {action === "take-back-premium"
              ? `Take back ${formatRupees(policy.premium)}`
              : action === "close"
                ? "Close this cover"
                : "Record my claim"}
          </ActionButton>
        </StickyAction>
      ) : null}
    </div>
  );
}

function Skeletons() {
  return (
    <div className="space-y-4">
      <div className="h-32 animate-pulse rounded-lg bg-muted" />
      <div className="h-48 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}

"use client";

/**
 * One agreement.
 *
 * ──────────────── "recorded", never "paid" ────────────────
 *
 * IncomeShare holds no money and moves none, so a number on this screen means
 * "this much is on record", not "this much changed hands". Every label is chosen
 * to keep that true.
 *
 * ──────────────── what is offered, and what is not ────────────────
 *
 * The only action is closing an agreement whose cap is reached or whose term has
 * ended — permissionless, and a fact rather than a decision. There is no button
 * to declare income or record a repayment: that needs the contract's recorder, a
 * key that is switched off on this deployment, so the screen says so and offers
 * nothing that would pretend. See `RECORDING_UNAVAILABLE`.
 */

import { Suspense, use } from "react";
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
import { ready } from "@/lib/contracts";
import {
  AgreementState,
  RECORDING_UNAVAILABLE,
  agreementError,
  describe,
  explain,
  pendingAction,
  remainingToCap,
  useAgreement,
  useCloseAgreement,
  useRepayments,
} from "@/lib/features/agreement";
import { formatRupees } from "@/lib/money";
import { useNowSeconds } from "@/lib/now";

export default function AgreementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <AppShell back="/agreements" title="Agreement">
      <LoginGate>
        <Suspense fallback={<Skeletons />}>
          <AgreementRoute params={params} />
        </Suspense>
      </LoginGate>
    </AppShell>
  );
}

function AgreementRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const agreementId = Number(id);

  if (!ready.agreements) {
    return (
      <Alert tone="attention" title="Not set up yet">
        This needs one more address in the app&apos;s settings.
      </Alert>
    );
  }
  // Agreements are numbered from 0, so 0 is a real one.
  if (!Number.isSafeInteger(agreementId) || agreementId < 0) {
    return (
      <Alert tone="over" title="Nothing here">
        That link does not point at an agreement.
      </Alert>
    );
  }
  return <AgreementDetail agreementId={agreementId} />;
}

function dayOf(seconds: bigint): string {
  return new Date(Number(seconds) * 1000).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function AgreementDetail({ agreementId }: { agreementId: number }) {
  const nowSeconds = useNowSeconds(60_000);
  const { data: agreement, isLoading } = useAgreement(agreementId);
  const { data: repayments } = useRepayments(
    agreementId,
    agreement?.repaymentCount ?? 0
  );
  const close = useCloseAgreement();

  if (isLoading) return <Skeletons />;
  if (!agreement) {
    return (
      <Alert tone="over" title="Nothing here">
        This agreement does not exist, or you are not one of the two people in
        it.
      </Alert>
    );
  }

  const { status, tone } = describe(agreement, nowSeconds);
  const action = pendingAction(agreement, nowSeconds);
  const active = agreement.state === AgreementState.Active;

  return (
    <div className="space-y-6 pb-4">
      <div className="flex items-start justify-between gap-3">
        <h1 className="min-w-0 flex-1 text-h1 text-foreground">
          {agreement.role === "funder"
            ? `${agreement.recipientName} repays you`
            : `You repay ${agreement.funderName}`}
        </h1>
        <StatusBadge tone={tone}>{status}</StatusBadge>
      </div>

      <p className="text-body text-muted-foreground">
        {explain(agreement, nowSeconds)}
      </p>

      <Card>
        <p className="text-small text-muted-foreground">On record as repaid</p>
        <Amount paise={agreement.totalRepaid} size="display" />
        <TestMoneyNote className="mt-1" />
        <div className="mt-4 border-t pt-2">
          <StatRow label="Funded">{formatRupees(agreement.fundingAmount)}</StatRow>
          <StatRow label="Share of income">{`${agreement.repaymentPercent}%`}</StatRow>
          <StatRow label="Most that can be repaid">
            {formatRupees(agreement.cap)}
          </StatRow>
          <StatRow label="Still possible to record">
            {formatRupees(remainingToCap(agreement))}
          </StatRow>
          <StatRow label="Repayments stop on" emphasis>
            {dayOf(agreement.termEnd)}
          </StatRow>
        </div>
      </Card>

      <Alert tone="attention" title="A record, not money">
        <p>
          No money moves through this app and none is held by it. The funding and
          every repayment happen between the two people, somewhere else.
        </p>
        {active ? <p className="mt-2">{RECORDING_UNAVAILABLE}</p> : null}
      </Alert>

      <Section title="The wording">
        {agreement.terms ? (
          <>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border bg-card p-4 text-small text-foreground">
              {agreement.terms}
            </pre>
            {agreement.termsMatch === true ? (
              <p className="mt-2 text-small text-muted-foreground">
                This wording matches the fingerprint on record.
              </p>
            ) : (
              <Alert tone="over" title="This wording does not match the record">
                The text stored here does not produce the fingerprint that was
                recorded when the agreement was made. Do not rely on it.
              </Alert>
            )}
          </>
        ) : (
          <p className="text-small text-muted-foreground">
            This device doesn&apos;t have the wording. Only its fingerprint is on
            record, so it can be checked against a copy but not read from here.
          </p>
        )}
      </Section>

      <Section title="Repayments on record">
        {repayments && repayments.length > 0 ? (
          <ol className="space-y-2">
            {repayments.map((r, i) => (
              <li
                key={i}
                className="rounded-md border bg-card px-4 py-3 text-body text-foreground"
              >
                <span className="font-semibold">{formatRupees(r.amount)}</span>{" "}
                recorded on {dayOf(r.recordedAt)}
                <span className="block text-small text-muted-foreground">
                  on a declared income of {formatRupees(r.income)}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-small text-muted-foreground">
            None yet.
          </p>
        )}
      </Section>

      {action === "close" ? (
        <StickyAction>
          <ActionButton
            pending={close.isPending}
            pendingLabel="Closing out…"
            onClick={() =>
              close.mutate(agreementId, {
                onSuccess: () => toast.success("This agreement is closed out."),
                onError: (err) => toast.error(agreementError(err)),
              })
            }
          >
            Close this out
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

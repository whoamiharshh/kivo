"use client";

/**
 * Share what you earn — the list.
 *
 * Two things are said before the list, because they correct the assumptions a
 * person brings to a screen that mentions funding and repayment:
 *
 *  1. No money moves through here. The contract is a ledger; funding and every
 *     repayment happen between the two people, elsewhere.
 *  2. Recording a repayment can't be done on this test setup. The key that is
 *     allowed to record one is switched off.
 */

import Link from "next/link";
import { AppShell, StickyBar } from "@/components/app-shell";
import { LoginGate } from "@/components/login-gate";
import { FeatureCard } from "@/components/feature/feature-card";
import { Alert, EmptyState } from "@/components/feature/primitives";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ready } from "@/lib/contracts";
import {
  RECORDING_UNAVAILABLE,
  describe,
  useMyAgreements,
} from "@/lib/features/agreement";
import { useNowSeconds } from "@/lib/now";

export default function AgreementsPage() {
  return (
    <AppShell back="/" title="Share what you earn">
      <LoginGate>
        <Agreements />
      </LoginGate>
    </AppShell>
  );
}

function dayOf(seconds: bigint): string {
  return new Date(Number(seconds) * 1000).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function Agreements() {
  const nowSeconds = useNowSeconds(60_000);
  const { data, isLoading, isError, refetch } = useMyAgreements();

  if (!ready.agreements) {
    return (
      <Alert tone="attention" title="Not set up yet">
        This needs one more address in the app&apos;s settings.
      </Alert>
    );
  }

  return (
    <div className="space-y-6 pb-4">
      <p className="text-body text-muted-foreground">
        One person funds another now; the other repays a share of what they earn
        later, up to a limit. This keeps the record of what was agreed.
      </p>

      <Alert tone="attention" title="A record, not money">
        <p>
          No money moves through this app and none is held by it. The funding
          and every repayment happen between the two people, somewhere else.
        </p>
        <p className="mt-2">{RECORDING_UNAVAILABLE}</p>
      </Alert>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-32 w-full rounded-lg" />
          <Skeleton className="h-32 w-full rounded-lg" />
        </div>
      ) : isError ? (
        <Alert tone="over" title="Couldn't load your agreements">
          <p>Something went wrong reaching the network. Nothing has changed.</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => void refetch()}
          >
            Try again
          </Button>
        </Alert>
      ) : !data || data.length === 0 ? (
        <EmptyState
          title="No agreements yet"
          body="When you record one — as the person funding, or the person repaying — it shows up here."
        />
      ) : (
        <ul className="space-y-3">
          {data.map((a) => {
            const { status, tone } = describe(a, nowSeconds);
            return (
              <li key={a.id}>
                <FeatureCard
                  href={`/agreements/${a.id}`}
                  title={
                    a.role === "funder"
                      ? `${a.recipientName} repays you`
                      : `You repay ${a.funderName}`
                  }
                  status={status}
                  tone={tone}
                  paise={a.totalRepaid}
                  targetPaise={a.cap}
                  footerLeft={`${a.repaymentPercent}% of what is earned`}
                  footerRight={`ends ${dayOf(a.termEnd)}`}
                />
              </li>
            );
          })}
        </ul>
      )}

      <StickyBar>
        <Button
          size="lg"
          className="h-12 w-full text-base"
          render={<Link href="/agreements/new" />}
        >
          Record an agreement
        </Button>
      </StickyBar>
    </div>
  );
}

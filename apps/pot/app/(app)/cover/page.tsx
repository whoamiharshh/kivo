"use client";

/**
 * Cover — the list.
 *
 * The data layer and the card rendering live elsewhere
 * (`lib/features/cover.ts`, `components/feature/cover/policy-list.tsx`); this
 * screen is the piece that joins them to a signed-in person. `PolicyList`
 * stays presentational — an array and a time in — so the same component could
 * render a sample gallery without a branch in it.
 *
 * The disclosure is above the list rather than below it, because the list is
 * the thing being qualified: four cards each saying "pays out at most ₹5,000"
 * is a page that looks like an insurance app, and the correction has to be
 * read first.
 */

import Link from "next/link";
import { AppShell, StickyBar } from "@/components/app-shell";
import { LoginGate } from "@/components/login-gate";
import { Button } from "@/components/ui/button";
import {
  CoverNotSetUpNotice,
  NotInsuranceNotice,
} from "@/components/feature/cover/cover-notices";
import { PolicyList } from "@/components/feature/cover/policy-list";
import { EmptyState } from "@/components/feature/primitives";
import { ready } from "@/lib/contracts";
import { useMyPolicies } from "@/lib/features/cover";
import { useNowSeconds } from "@/lib/now";

export default function CoverPage() {
  return (
    <AppShell back="/" title="Cover">
      <LoginGate>
        <MyCover />
      </LoginGate>
    </AppShell>
  );
}

function MyCover() {
  // 60s rather than the default 30: the shortest period on offer is three
  // hours, so a minute is already finer than anything visible here.
  const nowSeconds = useNowSeconds(60_000);
  const { data, isLoading, isError, refetch } = useMyPolicies();

  if (!ready.policies) return <CoverNotSetUpNotice />;

  return (
    <div className="space-y-6 pb-4">
      <NotInsuranceNotice />

      {isLoading ? (
        // Two cards at roughly the real height, so nothing jumps when the
        // data lands under the disclosure.
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="h-[148px] animate-pulse rounded-lg border bg-muted/60"
            />
          ))}
        </div>
      ) : isError ? (
        <EmptyState
          title="Couldn't load your cover"
          body="The network didn't answer. Nothing has changed — no premium was taken and no claim was affected."
          action={
            <button
              type="button"
              onClick={() => void refetch()}
              className="h-11 rounded-md border bg-card px-4 text-small font-semibold text-foreground hover:border-primary"
            >
              Try again
            </button>
          }
        />
      ) : (
        <PolicyList policies={data ?? []} nowSeconds={nowSeconds} />
      )}

      <p className="text-center text-small text-muted-foreground">
        You can put a premium in holding and take it back after a day, or when
        the period ends if that comes first. Taking on
        the risk needs an insurer, and there isn&apos;t one on this test setup —
        so nothing here becomes cover.
      </p>

      <StickyBar>
        <Button
          size="lg"
          className="h-12 w-full text-base"
          render={<Link href="/cover/new" />}
        >
          Put a premium in holding
        </Button>
      </StickyBar>
    </div>
  );
}

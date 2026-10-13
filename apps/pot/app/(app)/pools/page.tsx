"use client";

/**
 * Keep each other to it.
 *
 * ──────────────── what this screen is for ────────────────
 *
 * A group agrees on something — run every morning, no phone after eleven — and
 * everybody puts the same stake in. Mark your days and your stake comes back,
 * plus a share of whatever the people who did not keep it left behind. Miss
 * more than the agreed number and your stake goes to the ones who managed it.
 *
 * The screen says all of that before it lists anything, because somebody who
 * skims and taps "Start a commitment" has agreed to the last sentence whether
 * or not they read it.
 *
 * ──────────────── the honesty note is not decoration ────────────────
 *
 * Nothing here checks whether anybody actually went running. A marked day is a
 * day somebody tapped a button. That is a real limitation of this build and it
 * belongs on the screen, not in a footnote nobody opens.
 */

import Link from "next/link";
import { AppShell, StickyBar } from "@/components/app-shell";
import { LoginGate } from "@/components/login-gate";
import { PoolList } from "@/components/feature/pools/pool-list";
import { Alert, TestMoneyNote } from "@/components/feature/primitives";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ready } from "@/lib/contracts";
import { useMyPools } from "@/lib/features/pool";
import { useNowSeconds } from "@/lib/now";

export default function PoolsPage() {
  return (
    <AppShell back="/" title="Keep each other to it">
      <LoginGate>
        <Pools />
      </LoginGate>
    </AppShell>
  );
}

function Pools() {
  // A minute is plenty: the shortest thing a pool counts down to is a day.
  const nowSeconds = useNowSeconds(60_000);
  const { data: pools, isLoading, isError, refetch } = useMyPools();

  if (!ready.pools) {
    return (
      <Alert tone="attention" title="Not set up yet">
        Group commitments need one more address in this app&apos;s settings.
      </Alert>
    );
  }

  return (
    <div className="space-y-6 pb-4">
      <p className="text-body text-muted-foreground">
        Agree something as a group and everybody puts in the same stake. Keep
        it and your stake comes back, with a share of what the others left
        behind.
      </p>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-36 w-full rounded-lg" />
          <Skeleton className="h-36 w-full rounded-lg" />
        </div>
      ) : isError ? (
        <Alert tone="over" title="Couldn't load your commitments">
          <p>Something went wrong reaching the network.</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => void refetch()}
          >
            Try again
          </Button>
        </Alert>
      ) : (
        <PoolList pools={pools ?? []} nowSeconds={nowSeconds} />
      )}

      {/* Said plainly, every time: a marked day is a tap, not a measurement. */}
      <Alert tone="attention" title="Marking a day is self-reported">
        Nothing in this app checks whether you did the thing. A marked day is a
        day somebody tapped a button, and everybody in the pool is trusting
        each other to be straight about it.
      </Alert>

      <TestMoneyNote />

      <StickyBar>
        <Button
          size="lg"
          className="h-12 w-full text-base"
          render={<Link href="/pools/new" />}
        >
          Start a commitment
        </Button>
      </StickyBar>
    </div>
  );
}

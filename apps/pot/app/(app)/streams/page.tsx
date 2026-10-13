"use client";

/**
 * Pay as it earns.
 *
 * ──────────────── what this screen is for ────────────────
 *
 * Instead of a lump at the end of the month, money builds up second by second
 * and whoever is earning it takes what they have earned whenever they need it.
 * The payer puts money in up front; it stays theirs until it is earned, and
 * whatever is never earned comes back to them.
 *
 * That last part is the bit people do not expect, so it is said on the screen
 * rather than left to be discovered when somebody closes an arrangement.
 */

import Link from "next/link";
import { AppShell, StickyBar } from "@/components/app-shell";
import { LoginGate } from "@/components/login-gate";
import { StreamList } from "@/components/feature/streams/stream-list";
import { Alert, TestMoneyNote } from "@/components/feature/primitives";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ready } from "@/lib/contracts";
import { useMyStreams } from "@/lib/features/stream";
import { useNowSeconds } from "@/lib/now";

export default function StreamsPage() {
  return (
    <AppShell back="/" title="Pay as it earns">
      <LoginGate>
        <Streams />
      </LoginGate>
    </AppShell>
  );
}

function Streams() {
  // Once a second: this is the one screen where the number genuinely moves,
  // and a slower tick would make a per-second arrangement look like a monthly
  // one — which is the entire difference the feature exists to show.
  const nowSeconds = useNowSeconds(1000);
  const { data: streams, isLoading, isError, refetch } = useMyStreams();

  if (!ready.streams) {
    return (
      <Alert tone="attention" title="Not set up yet">
        This needs one more address in the app&apos;s settings.
      </Alert>
    );
  }

  return (
    <div className="space-y-6 pb-4">
      <p className="text-body text-muted-foreground">
        Money that builds up by the second, taken whenever it is needed rather
        than once a month.
      </p>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-32 w-full rounded-lg" />
          <Skeleton className="h-32 w-full rounded-lg" />
        </div>
      ) : isError ? (
        <Alert tone="over" title="Couldn't load this">
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
        <StreamList streams={streams ?? []} nowSeconds={nowSeconds} />
      )}

      <TestMoneyNote />

      <StickyBar>
        <Button
          size="lg"
          className="h-12 w-full text-base"
          render={<Link href="/streams/new" />}
        >
          Set up pay
        </Button>
      </StickyBar>
    </div>
  );
}

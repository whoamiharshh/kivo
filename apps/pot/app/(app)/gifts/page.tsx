"use client";

/**
 * Give a gift.
 *
 * ──────────────── what this screen is for ────────────────
 *
 * Money set aside now that unlocks later: on a date, or when somebody the two
 * of you trust says the thing happened. "Here is ₹500 when you graduate",
 * promised in a way nobody has to remember or chase.
 *
 * ──────────────── the sentence that never comes off ────────────────
 *
 * Nothing here watches the real world. A gift that unlocks "when you
 * graduate" knows nothing about graduations — a person you both named says it
 * happened, and then the money moves. That is a real limitation and it
 * belongs on the screen, not in a document nobody opens. The wording lives in
 * `CONFIRMER_DISCLOSURE` so this screen can choose to show it but never
 * rephrase it into something softer.
 */

import Link from "next/link";
import { AppShell, StickyBar } from "@/components/app-shell";
import { LoginGate } from "@/components/login-gate";
import { GiftList } from "@/components/feature/gifts/gift-list";
import { Alert, TestMoneyNote } from "@/components/feature/primitives";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ready } from "@/lib/contracts";
import { CONFIRMER_DISCLOSURE, useMyGifts } from "@/lib/features/gift";
import { useNowSeconds } from "@/lib/now";
import { useAppWallet } from "@/lib/tx";

export default function GiftsPage() {
  return (
    <AppShell back="/" title="Give a gift">
      <LoginGate>
        <Gifts />
      </LoginGate>
    </AppShell>
  );
}

function Gifts() {
  // A minute is plenty: the soonest thing a gift waits for is a date.
  const nowSeconds = useNowSeconds(60_000);
  const { address } = useAppWallet();
  const { data: gifts, isLoading, isError, refetch } = useMyGifts();

  if (!ready.gifts) {
    return (
      <Alert tone="attention" title="Not set up yet">
        Gifts need one more address in this app&apos;s settings.
      </Alert>
    );
  }

  return (
    <div className="space-y-6 pb-4">
      <p className="text-body text-muted-foreground">
        Set money aside now that unlocks later — on a date, or when somebody
        you both trust says the thing happened.
      </p>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-32 w-full rounded-lg" />
          <Skeleton className="h-32 w-full rounded-lg" />
        </div>
      ) : isError ? (
        <Alert tone="over" title="Couldn't load your gifts">
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
        <GiftList gifts={gifts ?? []} me={address} nowSeconds={nowSeconds} />
      )}

      <Alert tone="attention" title="How a condition gets confirmed">
        {CONFIRMER_DISCLOSURE}
      </Alert>

      <TestMoneyNote />

      <StickyBar>
        <Button
          size="lg"
          className="h-12 w-full text-base"
          render={<Link href="/gifts/new" />}
        >
          Set a gift aside
        </Button>
      </StickyBar>
    </div>
  );
}

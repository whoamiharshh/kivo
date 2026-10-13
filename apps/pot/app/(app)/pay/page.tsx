"use client";

/**
 * Pay a person — the list.
 *
 * The data layer and the row rendering already existed (`lib/features/pay.ts`,
 * `components/feature/pay/payment-list.tsx`); this screen is the small piece
 * that joins them to a real signed-in person. `PaymentList` stays
 * presentational — it takes an array and a time — which is why the same
 * component is rendered with real payments here, and this screen
 * without a branch in it.
 */

import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { LoginGate } from "@/components/login-gate";
import { ActionButton, StickyAction } from "@/components/feature/action-button";
import { PaymentList } from "@/components/feature/pay/payment-list";
import { Alert, EmptyState } from "@/components/feature/primitives";
import { ready } from "@/lib/contracts";
import { useMyPayments } from "@/lib/features/pay";
import { useNowSeconds } from "@/lib/now";

export default function PayPage() {
  return (
    <AppShell back="/" title="Pay a person">
      <LoginGate>
        <Payments />
      </LoginGate>
    </AppShell>
  );
}

function Payments() {
  // 60s rather than the default 30: the shortest window this screen counts
  // down is an hour, so a minute is already finer than anything visible.
  const nowSeconds = useNowSeconds(60_000);
  const { data, isLoading, isError, refetch } = useMyPayments();

  if (!ready.pay) {
    return (
      <Alert tone="attention" title="Not set up yet">
        Paying a person needs one more address in the app&apos;s settings. The
        pots on the home screen work as normal.
      </Alert>
    );
  }

  if (isLoading) {
    // Three rows at the real row height, so nothing jumps when data lands.
    return (
      <div className="divide-y overflow-hidden rounded-lg border bg-card">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex min-h-[72px] items-start gap-3 p-5">
            <div className="size-9 shrink-0 animate-pulse rounded-full bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <EmptyState
        title="Couldn't load your payments"
        body="The network didn't answer. Your money is unaffected — nothing was sent."
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
    );
  }

  return (
    <>
      <PaymentList payments={data ?? []} nowSeconds={nowSeconds} />

      <StickyAction>
        <Link href="/pay/new" className="block">
          <ActionButton>Pay someone</ActionButton>
        </Link>
      </StickyAction>
    </>
  );
}

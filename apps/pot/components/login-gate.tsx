"use client";

import { usePrivy } from "@privy-io/react-auth";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { contractsConfigured } from "@/lib/contracts";
import { SetupNotice } from "@/components/setup-notice";
import { useAppWallet } from "@/lib/tx";

/**
 * Nothing in the app renders until the person is signed in and their account
 * is ready. They see one button; the account is made for them in the
 * background.
 */
export function LoginGate({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, login } = usePrivy();
  const { ready: walletReady } = useAppWallet();

  if (!contractsConfigured) return <SetupNotice missing="contracts" />;

  if (!ready) {
    return (
      <div className="space-y-3 pt-6">
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="flex min-h-[70dvh] flex-col justify-center gap-8">
        <div className="space-y-3">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight">
            The shared money box for your group.
          </h1>
          <p className="text-[15px] leading-relaxed text-muted-foreground">
            Everyone puts money in. The pot repays whoever paid, under rules you
            agree up front. Whatever is left comes back to each person
            automatically — and no one has to hold the group&apos;s money.
          </p>
        </div>

        <ul className="space-y-3 text-[15px]">
          {[
            "No one friend holds the cash",
            "Repayments follow the group's own limit",
            "Leftover money returns in proportion to what you put in",
          ].map((line) => (
            <li key={line} className="flex gap-3">
              <span
                aria-hidden="true"
                className="mt-[7px] size-1.5 shrink-0 rounded-full bg-primary"
              />
              <span className="text-muted-foreground">{line}</span>
            </li>
          ))}
        </ul>

        <Button size="lg" className="h-12 text-base" onClick={() => login()}>
          Continue with Google
        </Button>
      </div>
    );
  }

  if (!walletReady) {
    return (
      <div className="flex min-h-[50dvh] flex-col items-center justify-center gap-3 text-center">
        <Skeleton className="size-10 rounded-full" />
        <p className="text-sm text-muted-foreground">
          Setting up your account…
        </p>
      </div>
    );
  }

  return <>{children}</>;
}

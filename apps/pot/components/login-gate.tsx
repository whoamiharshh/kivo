"use client";

/**
 * Nothing renders until the person is signed in and their account is ready.
 *
 * ──────────────── the sign-in screen is the whole pitch ────────────────
 *
 * It is the only screen somebody sees before deciding whether to bother. So
 * it does not explain the product with a feature list — it states the problem
 * the reader already has, in their own words, and then offers one button.
 *
 * "Nobody has to hold everyone's money" is the entire idea. Anybody who has
 * collected for a trip knows the feeling of sitting on ₹18,000 of other
 * people's money, and everybody else knows the feeling of wondering where it
 * went. Naming that is more persuasive than a list of what the software does.
 *
 * The three supporting lines are consequences, not features, set quietly
 * underneath as questions and answers. No ticks beside them: a tick would
 * turn a plain truth into marketing.
 */

import { usePrivy } from "@privy-io/react-auth";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { contractsConfigured } from "@/lib/contracts";
import { SetupNotice } from "@/components/setup-notice";
import { useAppWallet } from "@/lib/tx";

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

  if (!authenticated) return <SignIn onSignIn={() => login()} />;

  if (!walletReady) {
    return (
      <div className="flex min-h-[50dvh] flex-col items-center justify-center gap-4 text-center">
        <span className="size-10 animate-pulse rounded-full bg-muted" />
        <p className="text-body text-muted-foreground">
          Setting up your account…
        </p>
      </div>
    );
  }

  return <>{children}</>;
}

function SignIn({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div className="flex min-h-[78dvh] flex-col">
      <div className="flex flex-1 flex-col justify-center">
        {/* The object the product is named after, filled, at rest. */}
        <FullPot />

        <h1 className="mt-8 max-w-[300px] text-h1 leading-[1.15] text-foreground">
          Nobody has to hold everyone&apos;s money.
        </h1>

        <p className="mt-4 max-w-[300px] text-body leading-relaxed text-muted-foreground">
          Put money in together for a trip, the groceries, a club. It sits
          where no one person controls it, and whatever is left comes back to
          each of you.
        </p>

        <dl className="mt-8 space-y-4">
          <Line
            term="Paid for something?"
            detail="Take it back out, under the limit the group agreed."
          />
          <Line
            term="Didn't fill up?"
            detail="Everyone gets back exactly what they put in."
          />
          <Line
            term="Worried about the money?"
            detail="Nobody can quietly move it. Not even whoever made the pot."
          />
        </dl>
      </div>

      <div className="space-y-3 pt-10">
        <Button size="lg" className="h-12 w-full text-base" onClick={onSignIn}>
          Continue with Google
        </Button>
        <p className="text-balance text-center text-small text-muted-foreground">
          No app to install and nothing to set up. Your account is created the
          first time you sign in.
        </p>
        <p className="text-center text-caption text-muted-foreground">
          This is a test app. The money in it has no real value.
        </p>
      </div>
    </div>
  );
}

/**
 * One consequence, as a question somebody is already asking.
 *
 * A description list rather than bullets: each of these is a question and its
 * answer, and the markup should say so. The question carries the weight,
 * because that is the part a reader recognises as their own.
 */
function Line({ term, detail }: { term: string; detail: string }) {
  return (
    <div>
      <dt className="text-body font-semibold text-foreground">{term}</dt>
      <dd className="mt-0.5 max-w-[320px] text-body text-muted-foreground">
        {detail}
      </dd>
    </div>
  );
}

/** The pot, full — the same object the cards inside the app stand for. */
function FullPot() {
  return (
    <svg viewBox="0 0 64 64" className="size-16" fill="none" aria-hidden="true">
      <defs>
        <clipPath id="pot-body">
          <path d="M13 24h38l-3.2 24.6A5 5 0 0 1 42.8 53H21.2a5 5 0 0 1-5-4.4Z" />
        </clipPath>
      </defs>
      {/* The money inside, clipped to the body of the pot. */}
      <rect
        x="13"
        y="32"
        width="38"
        height="21"
        className="fill-primary-subtle"
        clipPath="url(#pot-body)"
      />
      <g
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-foreground"
      >
        <path d="M13 24h38l-3.2 24.6A5 5 0 0 1 42.8 53H21.2a5 5 0 0 1-5-4.4Z" />
        <path d="M24 24v-6a8 8 0 0 1 16 0v6" />
        <path d="M9 24h46" />
      </g>
    </svg>
  );
}

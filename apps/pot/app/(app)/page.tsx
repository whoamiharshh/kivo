"use client";

/**
 * Home: the pots, and what you have left to put in them.
 *
 * ──────────────── what this screen is actually about ────────────────
 *
 * The first version led with a big card showing the person's own balance, the
 * way a bank app does. That was the wrong subject. This is not a wallet — it
 * is a shared money box, and the interesting thing on the screen is a pot
 * filling up with several people's money, not how much one person happens to
 * be holding.
 *
 * So the balance is demoted to a single line with its top-up beside it, and
 * the pots are the page. The pots are also the only place colour or movement
 * happens; everything else is deliberately quiet so the eye lands there.
 *
 * ──────────────── on the greeting ────────────────
 *
 * A name rather than a logo, because this app gets opened between classes to
 * see whether anybody has put their share in, not admired. The name comes
 * from Google and the first word is what a friend would use.
 */

import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { toast } from "sonner";
import { AppShell, StickyBar } from "@/components/app-shell";
import { BalanceRow } from "@/components/balance-row";
import { HomeNav } from "@/components/home-nav";
import { LoginGate } from "@/components/login-gate";
import { Dashboard } from "@/components/dashboard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMyPots } from "@/lib/queries";

export default function HomePage() {
  return (
    <AppShell>
      <LoginGate>
        <Home />
      </LoginGate>
    </AppShell>
  );
}

/**
 * The name to greet somebody by.
 *
 * Google gives a full name; the first word is what a friend would say. If the
 * person signed in some other way, or Google gave nothing, the greeting drops
 * the name rather than leaving an empty space after "Hi,".
 */
function useFirstName(): string | null {
  const { user } = usePrivy();
  const full = user?.google?.name?.trim();
  if (!full) return null;
  return full.split(/\s+/)[0] ?? null;
}

function Home() {
  const firstName = useFirstName();
  const { data: pots, isLoading, isError, refetch } = useMyPots();

  return (
    <div className="space-y-7 pb-4">
      <header className="flex items-center justify-between gap-4 pt-1">
        <h1 className="min-w-0 truncate text-h2 text-foreground">
          {firstName ? `Hi, ${firstName}` : "Your pots"}
        </h1>
        <Avatar name={firstName} />
      </header>

      <BalanceRow />

      <section>
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-44 w-full rounded-lg" />
            <Skeleton className="h-44 w-full rounded-lg" />
          </div>
        ) : isError ? (
          <ErrorState onRetry={refetch} />
        ) : !pots || pots.length === 0 ? (
          <EmptyState />
        ) : (
          <Dashboard pots={pots} />
        )}
      </section>

      {!pots || pots.length === 0 ? <HomeNav /> : null}

      {/* Said once, at the bottom, on every screen that shows a balance. */}
      <p className="pt-2 text-center text-caption text-text-tertiary">
        Test app. Balances have no real value.
      </p>

      <StickyBar>
        <Button
          size="lg"
          className="h-12 w-full text-base"
          render={<Link href="/create" />}
        >
          Create a pot
        </Button>
      </StickyBar>
    </div>
  );
}

/** The person, as a circle with their initial. No photo is ever fetched. */
function Avatar({ name }: { name: string | null }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-small font-semibold text-neutral-strong"
    >
      {name ? name.charAt(0).toUpperCase() : "·"}
    </span>
  );
}

/**
 * Nothing here yet.
 *
 * Drawn as the empty vessel that a filled card is a full one, so the first pot
 * somebody makes is visibly the same object they were just looking at. The
 * copy names a real occasion rather than explaining a feature: people make a
 * pot for a trip, not to "start pooling funds".
 */
function EmptyState() {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed bg-card/60 px-6 py-12 text-center">
      <EmptyPot />
      <p className="mt-5 text-h3 text-foreground">No pots yet</p>
      <p className="mt-2 max-w-[260px] text-body text-muted-foreground">
        Make one for a trip, this month&apos;s groceries or a club, and send the
        link to your friends.
      </p>
      <ol className="mt-6 w-full space-y-3 text-left">
        {[
          "Get some test money, above.",
          "Create a pot and name it.",
          "Share the invite link on WhatsApp.",
        ].map((step, i) => (
          <li key={step} className="flex items-center gap-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-caption font-bold text-primary-strong">
              {i + 1}
            </span>
            <span className="text-body text-foreground">{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => unknown }) {
  return (
    <div className="space-y-2 rounded-lg border bg-card px-5 py-8 text-center">
      <p className="text-body text-foreground">Couldn&apos;t load your pots.</p>
      <p className="text-small text-muted-foreground">
        The list is unavailable or still being prepared. Nothing has changed.
      </p>
      <Button
        variant="outline"
        size="sm"
        className="mt-3"
        onClick={() => {
          void onRetry();
          toast.message("Trying again…");
        }}
      >
        Try again
      </Button>
    </div>
  );
}

/** An empty box with a lid — the same object the filled cards stand for. */
function EmptyPot() {
  return (
    <svg
      viewBox="0 0 48 48"
      className="size-12 text-border"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 18h28l-2.4 18.4A4 4 0 0 1 31.6 40H16.4a4 4 0 0 1-4-3.6Z" />
      <path d="M18 18v-5a6 6 0 0 1 12 0v5" />
      <path d="M7 18h34" />
    </svg>
  );
}

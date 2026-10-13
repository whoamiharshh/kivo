"use client";

import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { Button } from "@/components/ui/button";

/**
 * The frame every screen sits in.
 *
 * One centred column at every width. This is a thumb-sized product — a few
 * numbers and one or two actions per screen — so on a laptop the right design
 * is the same focused column with room around it, not a stretched dashboard.
 * The header spans the page so the brand and sign-out stay anchored while the
 * content stays readable.
 */
export function AppShell({
  children,
  back,
  title,
}: {
  children: React.ReactNode;
  back?: string;
  title?: string;
}) {
  const { authenticated, logout } = usePrivy();

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-xl items-center gap-3 px-4">
          {back ? (
            <Link
              href={back}
              aria-label="Go back"
              className="-ml-2 flex size-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <svg
                viewBox="0 0 24 24"
                className="size-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </Link>
          ) : (
            <Link
              href="/"
              aria-label="Pot home"
              className="flex items-center gap-2 rounded-lg font-heading text-lg font-semibold tracking-tight"
            >
              <Mark />
              Pot
            </Link>
          )}
          <span className="flex-1 truncate font-heading text-base font-semibold">
            {title}
          </span>
          {authenticated ? (
            <Button
              variant="ghost"
              size="sm"
              className="-mr-2 text-muted-foreground"
              onClick={() => void logout()}
            >
              Sign out
            </Button>
          ) : null}
        </div>
      </header>

      <main className="mx-auto w-full max-w-xl px-4 pb-32 pt-5 md:pt-8">
        {children}
      </main>
    </div>
  );
}

/** The lidded box the product is named after, as a small mark. */
function Mark() {
  return (
    <svg
      viewBox="0 0 28 28"
      className="size-6 text-primary"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M6 11h16l-1.4 10.2A2.5 2.5 0 0 1 18.1 23.4H9.9a2.5 2.5 0 0 1-2.5-2.2Z"
        fill="currentColor"
        fillOpacity="0.14"
      />
      <g
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6 11h16l-1.4 10.2A2.5 2.5 0 0 1 18.1 23.4H9.9a2.5 2.5 0 0 1-2.5-2.2Z" />
        <path d="M10 11V8.5a4 4 0 0 1 8 0V11" />
        <path d="M4 11h20" />
      </g>
    </svg>
  );
}

/** Pinned action bar so the main action is always under the thumb. */
export function StickyBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-10 border-t bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <div className="mx-auto w-full max-w-xl px-4 py-3">{children}</div>
    </div>
  );
}

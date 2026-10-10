"use client";

import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { Button } from "@/components/ui/button";

/** Mobile-first frame. Everything lives in a single thumb-width column. */
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
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b bg-background/85 px-4 py-3 backdrop-blur">
        {back ? (
          <Link
            href={back}
            aria-label="Go back"
            className="-ml-1 rounded-md p-1 text-muted-foreground hover:text-foreground"
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
          <Link href="/" className="font-semibold tracking-tight">
            Pot
          </Link>
        )}
        <span className="flex-1 truncate text-sm font-medium">{title}</span>
        {authenticated ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => void logout()}
          >
            Sign out
          </Button>
        ) : null}
      </header>

      <main className="flex-1 px-4 pb-28 pt-4">{children}</main>
    </div>
  );
}

/** Pinned action bar so the main action is always under the thumb. */
export function StickyBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-10 border-t bg-background/90 backdrop-blur">
      <div className="mx-auto w-full max-w-md px-4 py-3">{children}</div>
    </div>
  );
}

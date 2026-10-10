import Link from "next/link";

/**
 * The screen gallery.
 *
 * Everything under /preview renders a real screen component with sample data,
 * no sign-in and no chain. It exists because the screens are built before the
 * integrations they will eventually read from, and a design nobody can look at
 * cannot be reviewed.
 *
 * Two things keep it honest:
 *
 *  - The components here are the same files the live routes use. If a screen
 *    looks right in the gallery it looks right in the app, because there is no
 *    second implementation to drift.
 *  - The banner never comes off. A screen full of plausible names and amounts
 *    is indistinguishable from real data at a glance, and mistaking one for
 *    the other during a demo would be much worse than a visible strip.
 */
export default function PreviewLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
      <div className="sticky top-0 z-30 border-b border-warning-ring bg-warning-bg px-4 py-2">
        <p className="text-caption font-semibold text-warning-strong">
          Preview — sample data, nothing is connected
        </p>
      </div>

      <main className="flex-1 px-4 pb-28 pt-5">{children}</main>

      <footer className="border-t px-4 py-3">
        <Link
          href="/preview"
          className="text-small font-semibold text-primary-strong"
        >
          All screens
        </Link>
      </footer>
    </div>
  );
}

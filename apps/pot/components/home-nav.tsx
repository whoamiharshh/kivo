/**
 * The way to the rest of the app.
 *
 * ──────────────── why a list and not a tab bar ────────────────
 *
 * A phone tab bar holds four things comfortably, and this app has more than
 * four. A tab bar would have to hide the rest behind a "More" tab, which is
 * the worst of both: permanent chrome on every screen *and* a hidden menu. A
 * list on the home screen costs nothing elsewhere and names each feature in
 * the words the feature itself uses.
 *
 * ──────────────── what is shown, and what is not ────────────────
 *
 * The list comes from `lib/nav/routes.ts`, never from this file, so a row can
 * never outlive the screen it points at. Three cases, deliberately different:
 *
 *  - Screen exists, contract configured → a pressable row.
 *  - Screen exists, contract missing → a dimmed row saying "Not set up yet".
 *    Worth showing: it is a deployment problem somebody can fix, and hiding it
 *    would make a half-configured install look like a smaller product.
 *  - Screen not written yet → nothing at all. A row for a screen that does not
 *    exist is a promise the app cannot keep, and the 404 behind it was the
 *    single worst thing about this menu.
 *
 * A Server Component: it reads compile-time constants and holds no state, so
 * it ships no JavaScript.
 */
import Link from "next/link";
import { ready } from "@/lib/contracts";
import { FEATURE_ROUTES } from "@/lib/nav/routes";

export function HomeNav() {
  // Unbuilt screens are dropped here rather than rendered as a disabled row:
  // see the header. What survives is everything with a real screen behind it.
  const rows = FEATURE_ROUTES.filter((route) => route.built);

  if (rows.length === 0) return null;

  return (
    <section className="mt-6">
      <h2 className="mb-3 text-sm font-medium text-muted-foreground">
        More ways to use Pot
      </h2>

      <div className="divide-y overflow-hidden rounded-xl border bg-card">
        {rows.map((route) =>
          ready[route.requiresFeature] ? (
            <Link
              key={route.href}
              href={route.href}
              prefetch
              className="flex min-h-[68px] items-center gap-3 px-5 py-4 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 active:bg-muted/60"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium text-foreground">
                  {route.label}
                </span>
                {/* Not truncated: each of these is a whole sentence, and
                    cutting it at "get paid out if something …" tells somebody
                    less than showing nothing would. Two lines fit at 390px. */}
                <span className="mt-0.5 block text-sm leading-snug text-muted-foreground">
                  {route.body}
                </span>
              </span>
              <Chevron />
            </Link>
          ) : (
            <div
              key={route.href}
              // Not a button and not a link: there is nothing to press. The
              // words "not set up yet" carry the state, not the dimming.
              className="flex min-h-[68px] items-center gap-3 px-5 py-3"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium text-muted-foreground">
                  {route.label}
                </span>
                <span className="block truncate text-sm text-muted-foreground">
                  Not set up yet
                </span>
              </span>
            </div>
          )
        )}
      </div>
    </section>
  );
}

function Chevron() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4 shrink-0 text-muted-foreground"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

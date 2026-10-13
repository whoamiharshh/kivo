/**
 * Every feature the app offers, and whether its screens actually exist.
 *
 * ──────────────── why this file is the only list ────────────────
 *
 * The home screen used to carry its own hardcoded list of seven features. Five
 * of them pointed at screens nobody had built yet, so the app advertised doors
 * that opened onto a 404. A list that lives next to the markup that renders it
 * drifts the moment somebody adds or removes a screen, and nothing catches it.
 *
 * So the list lives here, once, and two separate facts are kept apart:
 *
 *  - `requiresFeature` asks whether the *contract* is configured for this
 *    deployment (`ready.<key>` in lib/contracts.ts). A deployment missing an
 *    address has that feature switched off.
 *  - `built` says whether the *screens* exist in `app/(app)/`.
 *
 * Both must be true for a row to be pressable. They are genuinely different
 * failures — "not deployed here" versus "not written yet" — and collapsing
 * them hides which one you are looking at.
 *
 * ──────────────── why `built` is written down, not detected ────────────────
 *
 * Reading the filesystem to see whether `app/(app)/savings/page.tsx` exists
 * works on your laptop and fails in production: the deployed bundle contains
 * compiled output, not the source tree, so every check would come back false
 * and the whole menu would silently empty itself. A nav that vanishes in
 * production and works in development is a worse bug than the one being fixed.
 *
 * Instead the flag is declared here and `routes.test.ts` reads the real
 * filesystem and fails if any flag disagrees with it. The guarantee is the
 * same — a flag cannot drift from reality — but it is enforced where the
 * source tree genuinely exists, and production just reads a constant.
 */

import { ready } from "@/lib/contracts";

export type FeatureRoute = {
  /** The words on the row. The feature's own language, never the chain's. */
  label: string;
  /** One line underneath, saying what it is for. */
  body: string;
  /** Where it goes. Also its key in the route registry. */
  href: string;
  /** Which contract has to be configured for this to work at all. */
  requiresFeature: keyof typeof ready;
  /**
   * Whether `app/(app)/<href>/page.tsx` exists today.
   *
   * Flip this to `true` in the same commit that adds the screen —
   * `routes.test.ts` fails if you forget, and fails if you flip it early.
   */
  built: boolean;
};

/**
 * Pots are deliberately absent: they are the home screen itself, listed above
 * this nav. A row pointing at the screen you are already on is noise.
 */
export const FEATURE_ROUTES: FeatureRoute[] = [
  {
    label: "Pay a person",
    body: "Money is held until they say they got it.",
    href: "/pay",
    requiresFeature: "pay",
    built: true,
  },
  {
    label: "Cover a small risk",
    body: "Pay a little now, get paid out if something happens.",
    href: "/cover",
    requiresFeature: "policies",
    built: true,
  },
  {
    label: "Give a gift",
    body: "Money that unlocks when a condition is met.",
    href: "/gifts",
    requiresFeature: "gifts",
    built: true,
  },
  {
    label: "Save towards something",
    body: "Put money aside and stake on reaching a goal.",
    href: "/savings",
    requiresFeature: "savings",
    built: true,
  },
  {
    label: "Keep each other to it",
    body: "The group stakes on a shared commitment.",
    href: "/pools",
    requiresFeature: "pools",
    built: true,
  },
  {
    label: "Pay as it earns",
    body: "Pay that builds up over time, withdrawn as it does.",
    href: "/streams",
    requiresFeature: "streams",
    built: true,
  },
  {
    label: "Share what you earn",
    body: "Funded now, repaid as a share of income later.",
    href: "/agreements",
    requiresFeature: "agreements",
    built: true,
  },
];

/** The rows a person can actually press: screens that exist and are deployed. */
export function visibleRoutes(): FeatureRoute[] {
  return FEATURE_ROUTES.filter((r) => r.built && ready[r.requiresFeature]);
}

/** Does this path belong to a feature that exists but has no screens yet? */
export function isUnbuiltRoute(pathname: string): FeatureRoute | undefined {
  return FEATURE_ROUTES.find((r) => !r.built && pathname.startsWith(r.href));
}

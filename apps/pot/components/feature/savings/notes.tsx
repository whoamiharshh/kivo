/**
 * The three things this feature has to keep saying.
 *
 * ──────────────── why these are components and not sentences ────────────────
 *
 * Each of them is a claim about what the software does and does not know, and
 * each is the kind of claim that gets softened by accident — a word dropped
 * here, a hedge added there, until "you typed this in" has become "verified".
 * Putting them behind three components means the wording lives in exactly one
 * place (`savings-state.ts`) and a screen can only choose whether to show it,
 * never how to phrase it.
 *
 * The honesty requirements they serve, in full, are in
 * `docs/limitations.md` — "Device integrity and goal verification" and "Where
 * the money comes from" — and `docs/trust-layer.md` section 3. The short
 * version:
 *
 *   - Nothing in this build reads a step count, health data or screen time.
 *     There is no attestation module. A figure is a figure somebody typed.
 *   - No screen may say "verified", on your device or anywhere else.
 *   - A bonus is funded by other savers missing their goals, and by nothing
 *     else, so "no bonus" is a normal result and not a failure.
 *
 * Server Components: static text, no state, no JavaScript shipped.
 */
import {
  BONUS_SOURCE,
  SELF_REPORTED_CONSEQUENCE,
  SELF_REPORTED_DISCLOSURE,
} from "@/lib/features/savings-state";
import { Alert } from "../primitives";

/**
 * Shown wherever a self-reported habit is chosen, submitted or displayed.
 *
 * Two paragraphs rather than one because they say different things and people
 * reliably believe the second is not true: the first says nobody checks the
 * number, the second says the number does not even have to meet your own
 * target for the habit to count. Both are facts about this build.
 */
export function SelfReportedNote({ heading }: { heading?: string }) {
  return (
    <Alert tone="attention" title={heading ?? "You report this yourself"}>
      <p>{SELF_REPORTED_DISCLOSURE}</p>
      <p className="mt-2">{SELF_REPORTED_CONSEQUENCE}</p>
    </Alert>
  );
}

/** Shown wherever a bonus is mentioned, promised or paid. */
export function BonusSourceNote() {
  return (
    <p className="mt-3 text-small text-muted-foreground">{BONUS_SOURCE}</p>
  );
}

/**
 * The feature's own "not set up yet", inline.
 *
 * Inline rather than a full-page takeover on purpose: the rest of the app is
 * fine, this one contract's address is missing, and replacing the whole screen
 * would read as the app being broken.
 */
export function SavingsNotSetUp() {
  return (
    <Alert tone="attention" title="Not set up yet">
      Saving towards something needs one more address in the app&apos;s
      settings. Everything else on the home screen works as normal.
    </Alert>
  );
}

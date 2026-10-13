/**
 * The things this feature is not allowed to leave off a screen.
 *
 * ──────────────── why these are components and not sentences ────────────────
 *
 * Three screens have to carry the same disclosures. Written out by hand on
 * each one they would drift, and the screen that drifted would be the one that
 * quietly promised cover — so the wording lives in `DISCLOSURE` in
 * `cover-state.ts` and these components are the only way it reaches a screen.
 *
 * Nothing here is a dismissible banner, a tooltip or a collapsed "learn more".
 * A disclosure a person can close before reading is decoration. These sit in
 * the flow of the screen, above the amounts they qualify.
 *
 * All Server Components: no state, no events, no browser APIs, so none of this
 * ships JavaScript to the phone.
 */
import { DISCLOSURE } from "@/lib/features/cover-state";
import { Alert } from "../primitives";

/**
 * The headline disclosure. Every screen in this feature opens with it.
 *
 * `tone="attention"` rather than a quiet grey note, deliberately: the claim it
 * corrects — that paying a premium buys insurance — is the one a person brings
 * with them, and a footnote does not correct an assumption that strong.
 */
export function NotInsuranceNotice() {
  return (
    <Alert tone="attention" title="A demonstration, not insurance">
      <p>{DISCLOSURE.notInsurance}</p>
      <p className="mt-2">{DISCLOSURE.whoDecides}</p>
    </Alert>
  );
}

/**
 * Said where a premium has been taken and no cover exists.
 *
 * This is the most dangerous state in the feature: money has left, which feels
 * exactly like having bought something, and nothing is covered. So it gets a
 * block of its own with the word "not" in the title, rather than a status
 * badge that a person has to interpret.
 */
export function NotCoveredYetNotice({ children }: { children?: React.ReactNode }) {
  return (
    <Alert tone="attention" title="You are not covered yet">
      <p>{DISCLOSURE.notCoveredYet}</p>
      {children ? <div className="mt-2">{children}</div> : null}
    </Alert>
  );
}

/** Said next to the trigger itself, where the press actually happens. */
export function PressedButtonNotice() {
  return (
    <Alert tone="attention" title="This decision is a button">
      <p>{DISCLOSURE.pressedButton}</p>
      <p className="mt-2">
        What is recorded is honest about itself: the decision is stored as
        simulated, and that cannot be edited later to look like a real feed.
      </p>
    </Alert>
  );
}

/** Said wherever a person is asked to describe what happened. */
export function NoEvidenceStoreNote() {
  return (
    <p className="text-small text-muted-foreground">
      {DISCLOSURE.noEvidenceStore}
    </p>
  );
}

/**
 * Shown instead of the feature when the address it needs is not configured.
 *
 * Inline rather than the full-screen `SetupNotice`, because the rest of the app
 * is fine and a whole-page takeover would suggest otherwise. The copy names
 * what a person can still do, so a half-configured demo does not read as a
 * broken app.
 */
export function CoverNotSetUpNotice() {
  return (
    <Alert tone="attention" title="Not set up yet">
      Cover needs one more address in the app&apos;s settings before these
      screens can do anything. Everything else — pots, paying a person — works
      as normal in the meantime.
    </Alert>
  );
}

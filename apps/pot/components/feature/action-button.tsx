"use client";

import { motion } from "motion/react";
import { DURATION, EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * The one primary action on a screen.
 *
 * Every screen in this app has exactly one of these, full width, under the
 * thumb. If a screen seems to need two, the second one is a link in the body,
 * not a second button down here — a person should never have to choose between
 * two equally-weighted buttons while holding money in their hand.
 *
 * ──────────────── the three states, and what they mean ────────────────
 *
 * `disabled` means the form is not yet valid. The button says what it will do
 * and stays visible rather than hiding, so the goal is clear while you work
 * towards it.
 *
 * `pending` means the request is in flight and the outcome is genuinely
 * unknown. This is the one place in the app a spinner is allowed: there is no
 * predictable result to show optimistically, because money either moved or it
 * did not. The label changes to a present participle ("Adding money…") so the
 * spinner is not the only indication.
 *
 * Neither state is clickable, and `pending` also blocks a second submission —
 * a double tap on a money button must not produce two payments.
 */
export function ActionButton({
  children,
  onClick,
  disabled,
  pending,
  pendingLabel,
  type = "button",
  tone = "primary",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  pending?: boolean;
  /** Shown while in flight. Defaults to "Working…", but a specific verb is
   *  always better: "Adding money…", "Sending…". */
  pendingLabel?: string;
  type?: "button" | "submit";
  /** `danger` is for the few irreversible actions, like closing a pot. */
  tone?: "primary" | "danger";
}) {
  const blocked = disabled || pending;

  return (
    <motion.button
      type={type}
      onClick={onClick}
      disabled={blocked}
      whileTap={blocked ? undefined : { scale: 0.98 }}
      transition={{ duration: DURATION.micro, ease: EASE }}
      aria-busy={pending || undefined}
      className={cn(
        "flex h-[52px] w-full items-center justify-center gap-2.5 rounded-md text-[16px] font-semibold",
        "transition-colors duration-150",
        blocked
          ? "cursor-not-allowed bg-muted text-tertiary"
          : tone === "danger"
            ? "bg-danger text-primary-foreground hover:bg-danger-strong"
            : "bg-primary text-primary-foreground hover:bg-primary-hover"
      )}
    >
      {pending ? (
        <>
          <Spinner />
          {pendingLabel ?? "Working…"}
        </>
      ) : (
        children
      )}
    </motion.button>
  );
}

/**
 * Pinned to the bottom of the screen, above the home indicator.
 *
 * The safe-area inset keeps the button clear of the gesture area on a notched
 * phone, which is where a full-width button would otherwise sit and become
 * unpressable.
 */
export function StickyAction({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/92 backdrop-blur">
      <div className="mx-auto w-full max-w-md px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 shadow-md">
        {children}
      </div>
    </div>
  );
}

/** A spinner, drawn with a border so it costs no SVG and no extra request. */
function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70"
    />
  );
}

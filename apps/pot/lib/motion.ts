/**
 * One easing curve and three durations for the whole app.
 *
 * Why it is centralised: two easings read as two products. A card that settles
 * differently from the sheet above it is the kind of detail nobody can name
 * but everybody feels, and it is the difference between "designed" and
 * "assembled".
 *
 * The same curve is declared as `--ease-out-expo` in globals.css for the
 * CSS-driven transitions. If one changes, change both.
 *
 * ──────────────── what may be animated ────────────────
 *
 * `transform`, `opacity` and `filter` only. Those are composited on the GPU,
 * so a 60fps animation costs no layout work. Animating `width`, `height`,
 * `top`, `left`, `margin` or `padding` forces the browser to re-lay-out every
 * frame, which on a mid-range Android phone is the difference between smooth
 * and visibly janky.
 *
 * The one deliberate exception is the progress bar, which animates `width`
 * because a scaled-up 8px bar blurs its own rounded ends. It is a single
 * 8px-tall element with nothing below it in the layout, so the re-layout is
 * confined to one row and costs nothing measurable.
 */

/** cubic-bezier(0.16, 1, 0.3, 1) — fast out, long gentle settle. */
export const EASE = [0.16, 1, 0.3, 1] as const;

/** Durations in seconds, which is what `motion` expects. */
export const DURATION = {
  /** Press feedback, toggles, anything that must feel instant. */
  micro: 0.15,
  /** The default: fades, slides, list items appearing. */
  standard: 0.2,
  /** Sheets and dialogs, which travel further and need the extra time. */
  sheet: 0.3,
  /** Progress fills and count-ups, where the movement IS the information. */
  progress: 0.6,
} as const;

/** A tap that feels like a physical button. Used on every pressable card. */
export const PRESS = {
  whileTap: { scale: 0.99 },
  transition: { duration: DURATION.micro, ease: EASE },
} as const;

/** The same, slightly deeper, for primary buttons. */
export const PRESS_BUTTON = {
  whileTap: { scale: 0.98 },
  transition: { duration: DURATION.micro, ease: EASE },
} as const;

/** Content arriving: up and in, never scaling from nothing. */
export const RISE = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: DURATION.standard, ease: EASE },
} as const;

/** A sheet from the bottom of the screen. */
export const SHEET = {
  initial: { y: "100%" },
  animate: { y: 0 },
  exit: { y: "100%" },
  transition: { duration: DURATION.sheet, ease: EASE },
} as const;

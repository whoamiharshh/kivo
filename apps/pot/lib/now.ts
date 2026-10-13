"use client";

/**
 * The current time, as a number that changes on purpose.
 *
 * ──────────────── why a hook and not Date.now() ────────────────
 *
 * Almost every screen in this app shows something that expires: a payment the
 * other person has four hours to accept, a pot that closes on Friday, a goal
 * whose deadline decides whether the money comes back. Two things go wrong if
 * each of those calls the clock directly.
 *
 * First, hydration. A Server Component renders "4 hours to accept" at one
 * instant and the browser re-renders at another; React compares the two and
 * reports a mismatch. Passing the time *in* as a value makes the server and
 * the first client render agree by construction, which is why every helper in
 * the feature modules takes `nowSeconds` as a parameter instead of reading the
 * clock itself.
 *
 * Second, staleness. A person leaves the app open, a window closes, and the
 * screen still says "2 hours left" next to a button that now reverts. A
 * ticking value keeps the label and the button agreeing with the contract.
 *
 * Seconds rather than milliseconds, because every deadline on the chain is
 * unix seconds and converting in one place is one fewer division to get wrong.
 */

import { useEffect, useState } from "react";

/**
 * Unix seconds, re-rendering on an interval.
 *
 * The default of 30 seconds is deliberate: the shortest thing any screen
 * counts down is measured in hours, so a faster tick would re-render a list
 * for no visible change and cost battery. A screen that genuinely shows
 * seconds can ask for 1000.
 *
 * The first value is read during the initial render rather than in an effect,
 * so there is no frame where a deadline label is blank or wrong. That is safe
 * because this hook is client-only — a Server Component must pass its own
 * value down instead of calling this.
 */
export function useNowSeconds(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const id = setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      intervalMs
    );
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}

/**
 * Pay as it earns — the types and the arithmetic, with no client dependency.
 *
 * ──────────────── why this is a separate file ────────────────
 *
 * `stream.ts` carries "use client" because it holds React Query hooks and a
 * wagmi client, and that directive applies to the whole module: a pure
 * function exported from it becomes a client export, and a Server Component
 * calling one gets "Attempted to call project() from the server". The same
 * split `pay.ts` / `pay-state.ts` makes, for the same reason — the list and
 * history components here take data as props and never ship JavaScript.
 *
 * ──────────────── the accrual rule, mirrored line for line ────────────────
 *
 * `project()` below is a transcription of `SalaryStream._settledAsOfNow`, not
 * an approximation of it. That matters more here than anywhere else in the app:
 * the figure on screen ticks every second, so reading it from the chain is not
 * an option, and a client-side formula that drifts from the contract would
 * promise money the contract will not pay.
 *
 * Everything is `bigint`. The contract's accrual path is one multiplication
 * (`ratePerSecond × secondsElapsed`) and one cap, with no division anywhere, so
 * an employee is owed an exact number of paise at every instant. Routing that
 * through a float to save a few keystrokes would invent the rounding error the
 * contract was written to avoid.
 *
 * ──────────────── the two numbers that must never merge ────────────────
 *
 * Money that has built up and not been taken, and money that is funded but not
 * yet earned, are different things that both look like "the balance":
 *
 *   earned        — credited to the person being paid. Theirs, whatever happens
 *                   next. Survives a pause and survives a close.
 *   stillFunded   — the payer's money, sitting in the contract, which will
 *                   become earned only as time passes.
 *
 * When `stillFunded` hits zero, accrual STOPS — it does not go negative and it
 * does not accrue a debt. So "running out of money" is not a warning about a
 * future shortfall; it is the moment pay stops building up. Both figures are
 * returned separately and every screen shows both.
 */

/** Mirrors SalaryStream.State. Index matters: it is the on-chain enum. */
export const StreamState = {
  None: 0,
  Active: 1,
  Paused: 2,
  Cancelled: 3,
} as const;
export type StreamStateValue = (typeof StreamState)[keyof typeof StreamState];

/**
 * Mirrors SalaryStream.Stream. Amounts are paise; times are unix seconds.
 *
 * `uint64` decodes as a bigint through viem, so the three time fields are
 * bigints too — converted at the edge of the arithmetic rather than mixed.
 */
export type Stream = {
  employer: `0x${string}`;
  employee: `0x${string}`;
  /** Paise per second. A whole number, always — see `ratePerSecondFor`. */
  ratePerSecond: bigint;
  /** Everything the payer has put in. */
  funded: bigint;
  /** Credited to the person being paid, as of `lastAccrualAt`. */
  settled: bigint;
  /** Already taken by the person being paid. */
  withdrawn: bigint;
  startTime: bigint;
  endTime: bigint;
  /** The instant `settled` is accurate up to. */
  lastAccrualAt: bigint;
  state: StreamStateValue;
};

/** A stream plus everything the UI needs that is not on the chain. */
export type StreamView = Stream & {
  id: number;
  /** True when the signed-in person is the one funding it. Decides every
   *  label on screen — see `describe`. */
  paying: boolean;
  /** The other party's saved name, or a stable friendly tag. */
  otherName: string;
  otherAddress: `0x${string}`;
};

/* ═══════════════════════════ the contract's bounds ═══════════════════════════ */

const HOUR = 60 * 60;
export const DAY_SECONDS = 24 * HOUR;

/** `SalaryStream.LOW_RUNWAY` — under this, anyone may stop the clock. */
export const LOW_RUNWAY_SECONDS = 7 * DAY_SECONDS;
/** `SalaryStream.MIN_DURATION` / `MAX_DURATION`. */
export const MIN_DURATION_SECONDS = HOUR;
export const MAX_DURATION_SECONDS = 3650 * DAY_SECONDS;

/**
 * The periods a person may state pay in.
 *
 * A month is 30 days flat. Calendar months are 28–31 days and the contract
 * holds a rate per second, so no choice of month length makes the figure exact
 * for every month; 30 days is the one that is easy to say out loud and easy to
 * check. The screen shows the resulting figure rather than claiming the typed
 * one — see `perPeriod`.
 */
export const PERIODS = {
  day: DAY_SECONDS,
  week: 7 * DAY_SECONDS,
  month: 30 * DAY_SECONDS,
} as const;
export type PeriodKey = keyof typeof PERIODS;

/** "a day" / "a week" / "a month", for sentences like "₹500 a day". */
export const PERIOD_WORD: Record<PeriodKey, string> = {
  day: "a day",
  week: "a week",
  month: "a month",
};

/* ═══════════════════════════ rate arithmetic ═══════════════════════════ */

/**
 * Paise per second from an amount per period.
 *
 * The contract holds a whole number of paise per second, so most stated
 * salaries cannot be represented exactly: ₹50,000 a month is 1.929… paise a
 * second. Rounding DOWN would quietly pay 48% of a ₹50,000 salary, so this
 * rounds to the nearest whole paisa — `floor(x + 0.5)`, done in bigint as
 * `(2a + p) / 2p` so no float ever touches money.
 *
 * The caller must then show `perPeriod(rate, period)` and not the typed figure.
 * The difference is small but it is real, and the person paying is entitled to
 * see the number that will actually be paid.
 */
export function ratePerSecondFor(
  amountPaise: bigint,
  periodSeconds: number
): bigint {
  const p = BigInt(periodSeconds);
  if (p <= 0n || amountPaise <= 0n) return 0n;
  return (amountPaise * 2n + p) / (2n * p);
}

/** What a rate actually pays over a period. The honest headline figure. */
export function perPeriod(ratePerSecond: bigint, periodSeconds: number): bigint {
  return ratePerSecond * BigInt(periodSeconds);
}

/** What it costs to fund a stretch of time at this rate. */
export function costOfSeconds(ratePerSecond: bigint, seconds: number): bigint {
  return ratePerSecond * BigInt(Math.max(0, Math.floor(seconds)));
}

/* ═══════════════════════════ projection ═══════════════════════════ */

export type StreamFigures = {
  /** Built up so far, taken or not. Capped at what was funded. */
  earned: bigint;
  /** Built up and not yet taken. What the withdraw button pays. */
  withdrawable: bigint;
  /** Already taken. */
  withdrawn: bigint;
  /** Funded by the payer and NOT yet earned. Still the payer's money. */
  stillFunded: bigint;
  /** Is the figure actually moving right now? */
  accruing: boolean;
  /** Active, inside its term, and out of funded money: nothing is building up. */
  dry: boolean;
  /** Under the contract's seven-day line, so the clock can be stopped by
   *  anyone. Shown as "running low", never as a failure. */
  lowRunway: boolean;
  /** The term's end has passed, so accrual has stopped by itself. */
  ended: boolean;
  /** Pay per day at this rate — the plainest way to state a per-second rate. */
  perDay: bigint;
  /** How much longer the funded money lasts at this rate. */
  fundingSecondsLeft: number;
  /** When the funded money runs out, or null when nothing is accruing. */
  dryAt: number | null;
  /** Unix seconds the agreement ends. */
  endsAt: number;
  /** The money runs out before the agreed end date — the one warning this
   *  feature exists to give. */
  runsDryBeforeEnd: boolean;
};

/**
 * Everything the screens need, from a stream and an instant.
 *
 * `nowSeconds` is a parameter rather than a call to the clock so the same
 * inputs always produce the same answer: a server render and the browser render
 * that follows must agree or the whole row flickers on hydration, and a
 * screenshot of a sample stream has to be stable.
 *
 * The browser's clock may sit a second or two from the chain's, so the figure
 * can differ from `withdrawable()` on chain by that much. It does not matter:
 * the withdraw call pays whatever the chain computes at the moment it lands,
 * and the button never claims otherwise.
 */
export function project(s: Stream, nowSeconds: number): StreamFigures {
  const now = BigInt(Math.max(0, Math.floor(nowSeconds)));

  const earned = settledAsOf(s, now);
  const withdrawable = earned > s.withdrawn ? earned - s.withdrawn : 0n;
  const stillFunded = s.funded > earned ? s.funded - earned : 0n;

  const ended = now >= s.endTime;
  const accruing =
    s.state === StreamState.Active && !ended && stillFunded > 0n;

  const fundingSecondsLeft =
    s.ratePerSecond > 0n ? Number(stillFunded / s.ratePerSecond) : 0;
  const secondsToEnd = ended ? 0 : Number(s.endTime - now);

  // `runwayIsLow` on the contract also answers true for a stream whose term
  // has simply finished with money left in it. That is accurate for the
  // contract's purpose — pausing — and wrong as a sentence on screen, because
  // nothing is at risk: the pay has ended and the remainder goes back to the
  // payer. So "running low" here means running low while still paying.
  const lowRunway =
    accruing && stillFunded < s.ratePerSecond * BigInt(LOW_RUNWAY_SECONDS);

  return {
    earned,
    withdrawable,
    withdrawn: s.withdrawn,
    stillFunded,
    accruing,
    dry: s.state === StreamState.Active && !ended && stillFunded === 0n,
    lowRunway,
    ended,
    perDay: s.ratePerSecond * BigInt(DAY_SECONDS),
    fundingSecondsLeft,
    dryAt: accruing ? Number(now) + fundingSecondsLeft : null,
    endsAt: Number(s.endTime),
    runsDryBeforeEnd: accruing && fundingSecondsLeft < secondsToEnd,
  };
}

/**
 * `SalaryStream._settledAsOfNow`, transcribed.
 *
 * Paused and closed streams return `settled` untouched: paused time is not
 * paid for, and a closed stream keeps what was earned withdrawable forever.
 * Accrual runs only forward from `lastAccrualAt` and only to `endTime`, and the
 * cap at `funded` is the contract's guarantee that nothing accrues unpayably.
 */
function settledAsOf(s: Stream, now: bigint): bigint {
  if (s.state !== StreamState.Active) return s.settled;

  const upTo = now > s.endTime ? s.endTime : now;
  if (upTo <= s.lastAccrualAt) return s.settled;

  const fresh = s.ratePerSecond * (upTo - s.lastAccrualAt);
  const headroom = s.funded > s.settled ? s.funded - s.settled : 0n;
  return s.settled + (fresh > headroom ? headroom : fresh);
}

/* ═══════════════════════════ the chain's own answer ═══════════════════════════ */

/**
 * What the contract itself said, at one instant.
 *
 * `project()` is a faithful transcription of the accrual rule, but it is still
 * a copy, and the figure a person is about to tap "take out" on should be the
 * original. So the detail screen reads `earned()` and `withdrawable()` and
 * treats them as the truth, keeping the transcription for the seconds in
 * between — see `carriedForward`.
 */
export type StreamReading = {
  /** `earned(streamId)`. */
  earned: bigint;
  /** `withdrawable(streamId)` — what the take-out action would actually pay. */
  withdrawable: bigint;
  /** `runwaySeconds(streamId)`: how much longer the funded money lasts, by the
   *  chain's own clock rather than the browser's. */
  runwaySeconds: number;
  /** `runwayIsLow(streamId)`. */
  lowRunway: boolean;
  /** `LOW_RUNWAY` — the line the contract draws for "running low", so the
   *  sentence on screen quotes the rule instead of a mirrored constant. */
  lowRunwayThresholdSeconds: number;
  /** The instant the read happened, unix seconds. Recorded at the read rather
   *  than inferred later, because it is the anchor the ticking is measured
   *  from and a guess would make the figure drift. */
  readAtSeconds: number;
};

/**
 * The chain's figures, carried forward to this instant.
 *
 * ──────────────── why not simply project from the struct ────────────────
 *
 * A balance that ticks cannot be read from the chain every second, and a
 * balance that only changes when a read lands does not tick at all. So the
 * figure on screen is the contract's own answer plus however much has accrued
 * since that answer was given: the anchor is always the original, and the
 * seconds in between are filled by `project()`, which is the same arithmetic
 * the contract will do when the take-out lands.
 *
 * Only the *advance* is taken from the transcription, never the level. If the
 * browser's clock sits a second behind the chain's, the number is a second's
 * worth of pay short and then catches up on the next read — it never jumps
 * backwards, and it never claims more than the chain has already credited plus
 * what has demonstrably accrued since.
 */
export function carriedForward(
  s: Stream,
  reading: StreamReading,
  nowSeconds: number
): { earned: bigint; withdrawable: bigint } {
  const atRead = project(s, reading.readAtSeconds);
  const atNow = project(s, nowSeconds);

  const advance =
    atNow.earned > atRead.earned ? atNow.earned - atRead.earned : 0n;

  return {
    earned: reading.earned + advance,
    withdrawable: reading.withdrawable + advance,
  };
}

/* ═══════════════════════════ words ═══════════════════════════ */

/**
 * The word and tone for a stream, from the signed-in person's point of view.
 *
 * One stream is two situations. The same `Active` row with eleven days of money
 * left is "building up" to the person being paid and "running low, add more" to
 * the person paying; the same `Cancelled` row is "yours to take" to one and
 * "closed" to the other. Branching on `paying` in each component would let the
 * list and the detail screen drift apart, so both ask this.
 */
export function describe(
  v: StreamView,
  nowSeconds: number
): { status: string; tone: "progress" | "good" | "attention" | "over" } {
  const f = project(v, nowSeconds);

  switch (v.state) {
    case StreamState.Paused:
      return { status: "Paused", tone: "over" };

    case StreamState.Cancelled:
      return f.withdrawable > 0n && !v.paying
        ? { status: "Yours to take", tone: "attention" }
        : { status: "Closed", tone: "over" };

    case StreamState.Active: {
      if (f.ended) {
        if (f.withdrawable > 0n && !v.paying) {
          return { status: "Yours to take", tone: "attention" };
        }
        if (v.paying && f.stillFunded > 0n) {
          return { status: "Money to return", tone: "attention" };
        }
        return { status: "Finished", tone: "over" };
      }
      if (f.dry) return { status: "Out of money", tone: "attention" };
      if (f.lowRunway) return { status: "Running low", tone: "attention" };
      return v.paying
        ? { status: "Paying", tone: "progress" }
        : { status: "Building up", tone: "progress" };
    }

    default:
      return { status: "Unknown", tone: "over" };
  }
}

/**
 * The one thing this person can do about this stream right now.
 *
 * "withdraw" is never offered to the payer and "add" is never offered to the
 * person being paid, because neither is allowed to do the other's action: the
 * contract refuses with `NotEmployee` / `NotEmployer`, and offering a button
 * that cannot work is worse than offering none.
 */
export function pendingAction(
  v: StreamView,
  nowSeconds: number
): "withdraw" | "add" | "collect" | null {
  const f = project(v, nowSeconds);

  if (!v.paying) return f.withdrawable > 0n ? "withdraw" : null;

  // Past the end date with money left over: closing is how the payer gets the
  // unearned remainder back. Nothing expires and nothing is lost by waiting,
  // so this is an action, not an alarm.
  if (v.state === StreamState.Active && f.ended && f.stillFunded > 0n) {
    return "collect";
  }
  if (v.state === StreamState.Active && (f.dry || f.lowRunway)) return "add";
  return null;
}

/* ═══════════════════════════ history ═══════════════════════════ */

export type StreamEventKind =
  | "started"
  | "added"
  | "withdrawn"
  | "paused"
  | "resumed"
  | "closed";

/**
 * One line of a stream's history, read back out of the stream itself.
 *
 * ──────────────── what the struct can and cannot say ────────────────
 *
 * These lines used to be flattened out of the six events. They are now derived
 * from the row — see `useStreamActivity` for why — and the struct is a summary
 * rather than a diary, so three things are genuinely not knowable and no line
 * here pretends otherwise:
 *
 *  - **No times.** The row knows the current state, not when it was reached.
 *    The history is ordered, never dated, exactly as the pot's own feed is.
 *  - **Top-ups are a total.** `funded` is the sum of the opening deposit and
 *    every later addition, so three taps read back as one line with the right
 *    amount and the wrong number of taps.
 *  - **A resumed stream is invisible.** Once the clock is running again the row
 *    looks exactly like one that was never stopped, so "resumed" is a kind this
 *    type still carries and the derivation can never produce.
 *
 * `key` is therefore a stable string per kind rather than a block-and-log
 * position: one line of each kind is all the row can support.
 */
export type StreamHistoryEntry = {
  kind: StreamEventKind;
  key: string;
  /** Paise, where the line carries an amount. */
  amount?: bigint;
  /** Who acted, where the row implies it beyond doubt — the payer put the
   *  money in, the person being paid took it out. Left unset for a pause,
   *  because the row does not record who stopped the clock. */
  by?: `0x${string}`;
  /** For "closed": what went back to the payer. */
  returned?: bigint;
};

/* ═══════════════════════════ plain language ═══════════════════════════ */

/** "3 hours", "12 days", "4 months" — a span, in the roundest honest unit. */
export function spanLabel(seconds: number): string {
  if (seconds < HOUR) return "under an hour";
  if (seconds < 2 * DAY_SECONDS) {
    const hours = Math.floor(seconds / HOUR);
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  const days = Math.floor(seconds / DAY_SECONDS);
  if (days < 60) return `${days} days`;
  const months = Math.floor(days / 30);
  return `${months} months`;
}

/** "22 Oct" — a date a person reads. Pure: no clock, only the input. */
export function dayLabel(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
}

/** "22 Oct, 6:00 pm", for the moment the money runs out. */
export function momentLabel(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

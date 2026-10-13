/**
 * Save towards something — the types and the rules, with no client dependency.
 *
 * ──────────────── why this is a separate file ────────────────
 *
 * Same reason as `pay-state.ts`: `savings.ts` carries "use client" because it
 * holds React Query hooks and a wagmi client, and that directive applies to the
 * whole module. A Server Component that imported `describeGoal` from there
 * would be told the function is on the client. So: enums, shapes and pure
 * functions here; hooks and contract calls in `savings.ts`, which re-exports
 * these so client code still has one import.
 *
 * ──────────────── what this feature actually is ────────────────
 *
 * A commitment contract with a savings wrapper. Two pots of money, and the
 * whole UI stands or falls on keeping them apart:
 *
 *   savings (principal)  Comes back in full, met goal or missed. Never at risk.
 *   stake                10% of the target, taken when the goal is created.
 *                        Kept if you meet the goal, forfeited if you miss it.
 *
 * A forfeited stake is shared among the people who *did* meet their goal and
 * who picked the same deadline — their "cohort". That is the only source of a
 * bonus. There is no sponsor, no fund and no interest, so if everybody in a
 * cohort succeeds there is no bonus at all. Every sentence this feature shows
 * has to survive that arithmetic rather than imply a return appears from
 * somewhere.
 *
 * ──────────────── and what it does not verify ────────────────
 *
 * `BehaviourType.SaveConsistently` is the honest one: reaching the target
 * across at least `MIN_DEPOSITS` separate top-ups is a fact in contract
 * storage, checked by the contract itself, with nobody to trust.
 *
 * `BehaviourType.ExternalSignal` takes a signature from a verifier the admin
 * appointed. Behind that verifier is a server that bounds-checks a number a
 * person typed into a box. Nothing reads a pedometer, a health store, Play
 * Integrity or App Attest — see `docs/limitations.md`, "Device integrity and
 * goal verification". Two consequences the copy must carry, not soften:
 *
 *   - the figure is self-reported, and
 *   - submitting one marks the habit as kept *whatever the number is*. The
 *     contract records that the verifier signed; it never compares the figure
 *     with the daily goal. The daily goal is a note to yourself.
 *
 * Screen time is worse off still: reading it needs an iOS entitlement and a
 * native build that does not exist here, so it is offered as unavailable
 * rather than as a self-report path wearing a verification badge.
 */

import { keccak256, stringToHex } from "viem";
import type { Tone } from "@/components/feature/primitives";

/* ═══════════════════════════ the contract's own shapes ═══════════════════════════ */

/** Mirrors BehaviourSavings.BehaviourType. Index matters: it goes on the wire. */
export const BehaviourType = {
  SaveConsistently: 0,
  ExternalSignal: 1,
} as const;
export type BehaviourTypeValue =
  (typeof BehaviourType)[keyof typeof BehaviourType];

/** Mirrors BehaviourSavings.State. */
export const GoalState = {
  None: 0,
  Open: 1,
  Finalised: 2,
  Settled: 3,
} as const;
export type GoalStateValue = (typeof GoalState)[keyof typeof GoalState];

/**
 * Mirrors BehaviourSavings.Goal. Amounts are paise; `deadline` is unix seconds.
 *
 * `depositCount` is a `uint32` and arrives as a JavaScript number, while
 * `deadline` is a `uint64` and arrives as a bigint. Keeping each at the width
 * viem gives it avoids a conversion nobody would remember to make.
 */
export type Goal = {
  user: `0x${string}`;
  /** Who may sign an external signal. Zero for a save-consistently goal. */
  verifier: `0x${string}`;
  target: bigint;
  /** At risk. Never taken out of `saved`. */
  stake: bigint;
  /** Principal. Always returned in full. */
  saved: bigint;
  deadline: bigint;
  depositCount: number;
  behaviour: BehaviourTypeValue;
  behaviourVerified: boolean;
  /** Only meaningful once the goal has been closed. */
  succeeded: boolean;
  state: GoalStateValue;
};

/** Mirrors BehaviourSavings.Cohort — everybody who picked the same deadline. */
export type Cohort = {
  goalCount: number;
  finalisedCount: number;
  winnersRemaining: number;
  forfeitedPool: bigint;
  poolRemaining: bigint;
  winningStakeTotal: bigint;
};

/* ═══════════════════════════ the contract's own constants ═══════════════════════════ */

/** STAKE_BPS = 1000: the stake is 10% of the target. */
export const STAKE_BPS = 1000n;
const BPS_DENOMINATOR = 10_000n;

/** MIN_DEPOSITS: how many separate top-ups "saving consistently" takes. */
export const MIN_DEPOSITS = 4;

/**
 * The contract accepts a deadline 1–365 days out. The picker offers 3–360.
 *
 * Not timidity: the deadline is taken as midnight UTC (see
 * `deadlineFromDateInput`), so a date chosen at the very edge of the contract's
 * window can slip outside it between the tap and the transfer settling, and
 * `DurationOutOfRange` is a terrible way to learn that. Three days in is
 * comfortably clear of the boundary in every timezone.
 */
export const MIN_DAYS_AHEAD = 3;
export const MAX_DAYS_AHEAD = 360;

/** What the stake will be for a target. The contract's own arithmetic. */
export function stakeFor(targetPaise: bigint): bigint {
  return (targetPaise * STAKE_BPS) / BPS_DENOMINATOR;
}

/**
 * Midnight UTC on a YYYY-MM-DD, as unix seconds.
 *
 * Deliberately UTC rather than local. Redistribution only happens between
 * goals whose deadlines are *identical to the second*, so two people who both
 * picked 1 November have to land on the same number or they are strangers to
 * each other as far as the contract is concerned. Local midnight would split a
 * cohort along timezone lines; UTC midnight is the same instant for everyone.
 */
export function deadlineFromDateInput(value: string): bigint {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) throw new Error("Pick a date.");
  const [, y, m, d] = match;
  const ms = Date.UTC(Number(y), Number(m) - 1, Number(d));
  if (Number.isNaN(ms)) throw new Error("Pick a date.");
  return BigInt(Math.floor(ms / 1000));
}

/** A YYYY-MM-DD this many days from now, for the picker's bounds. */
export function dateInputDaysAhead(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/* ═══════════════════════════ the habit, as a person picks it ═══════════════════════════ */

/**
 * What a person chooses on the create screen.
 *
 * Three options for two contract behaviours, because "a daily step count" and
 * "daily screen time" are the same thing to the contract — an external signal —
 * and completely different things to a person. The kind is kept offchain with
 * the goal's name so the detail screen can say which habit was meant.
 */
export type HabitKind = "consistent" | "steps" | "screen_time";

export type HabitOption = {
  kind: HabitKind;
  title: string;
  /** The consequence, spelled out. Shown next to the radio, not in help text. */
  body: string;
  behaviour: BehaviourTypeValue;
  /** Can it be picked in this version at all? */
  available: boolean;
  /** Why not, when it cannot. Rendered as the option's body instead. */
  unavailableBecause?: string;
  /** True when the figure comes from a person typing it in. */
  selfReported: boolean;
  /** Does it ask for a daily number? */
  dailyTarget: boolean;
};

/**
 * The options, in the order they are offered.
 *
 * `externalSignalReady` is not a style choice: an external-signal goal is
 * assigned the verifier the admin has appointed on-chain, and when none is
 * appointed `createSavingsGoal` reverts with `VerifierRequired`. Offering the
 * option in that state would be offering a guaranteed failure, so it is shown
 * as switched off instead.
 */
export function habitOptions(externalSignalReady: boolean): HabitOption[] {
  return [
    {
      kind: "consistent",
      title: "Save a bit at a time",
      body: `Reach your target across at least ${MIN_DEPOSITS} separate top-ups. This one is checked for you — it is simply what you did.`,
      behaviour: BehaviourType.SaveConsistently,
      available: true,
      selfReported: false,
      dailyTarget: false,
    },
    {
      kind: "steps",
      title: "Daily steps",
      body: "You report the number yourself. Nothing here reads your phone, and submitting a figure counts the habit as kept whatever it says.",
      behaviour: BehaviourType.ExternalSignal,
      available: externalSignalReady,
      unavailableBecause:
        "Not switched on yet. Until it is, pick saving a bit at a time.",
      selfReported: true,
      dailyTarget: true,
    },
    {
      kind: "screen_time",
      title: "Daily screen time",
      body: "",
      behaviour: BehaviourType.ExternalSignal,
      available: false,
      unavailableBecause:
        "Coming soon. Reading screen time needs the phone app, which isn't built yet — and a figure you typed in yourself wouldn't be the same thing.",
      selfReported: true,
      dailyTarget: true,
    },
  ];
}

/** The one sentence that has to appear wherever a self-reported habit does. */
export const SELF_REPORTED_DISCLOSURE =
  "You type this number in yourself. Nothing checks it against your phone — there is no step counter, no health data and no device check in this version. It is your own word, recorded as your own word.";

/** And the part people get wrong even after reading the sentence above. */
export const SELF_REPORTED_CONSEQUENCE =
  "Submitting a figure marks the habit as kept, whatever the figure says. Your daily number is never compared with it. The part that is really enforced is the money: you still have to reach your target by the date.";

/** Where a bonus comes from, in the only words that are true. */
export const BONUS_SOURCE =
  "A bonus comes from savers who missed their own goal, and from nothing else. If everyone who picked your date meets their goal, there is no bonus — nothing was forfeited.";

/* ═══════════════════════════ a goal, as the UI needs it ═══════════════════════════ */

/** Kept offchain beside the goal, keyed by a hash of its id. */
export type GoalMeta = {
  name: string;
  habit: HabitKind;
  /** Steps a day the person set themselves. A note, not a rule — see above. */
  dailyTarget?: number;
};

/**
 * Where a goal's name and habit live.
 *
 * The contract stores neither, and it should not: a goal called "Macbook fund"
 * is personal information and has no business being public forever. So the
 * name goes in the same offchain hash-to-text store the repayment memos use
 * (`lib/store.ts`), keyed by a hash of the goal id rather than of the text —
 * the text is what we want to look up, so it cannot also be the key.
 */
export function goalMetaHash(goalId: number): `0x${string}` {
  return keccak256(stringToHex(`savings-goal:${goalId}`));
}

export function encodeGoalMeta(meta: GoalMeta): string {
  return JSON.stringify(meta);
}

/**
 * Read a stored meta back, tolerating anything.
 *
 * The store is shared with repayment memos, which are plain text, and a goal
 * whose name was never saved reads as nothing at all. Both have to produce a
 * usable goal rather than an exception, because a missing name must never be
 * the reason a person cannot see their money.
 */
export function decodeGoalMeta(
  text: string | undefined,
  behaviour: BehaviourTypeValue
): GoalMeta {
  const fallback: GoalMeta = {
    name: "Savings goal",
    habit: behaviour === BehaviourType.ExternalSignal ? "steps" : "consistent",
  };
  if (!text) return fallback;

  try {
    const parsed = JSON.parse(text) as Partial<GoalMeta>;
    if (parsed && typeof parsed.name === "string" && parsed.name.trim()) {
      return {
        name: parsed.name.trim(),
        habit: parsed.habit ?? fallback.habit,
        dailyTarget:
          typeof parsed.dailyTarget === "number" && parsed.dailyTarget > 0
            ? parsed.dailyTarget
            : undefined,
      };
    }
    return fallback;
  } catch {
    // Not JSON: an older row, or a memo. The whole string is the name.
    return { ...fallback, name: text.trim() || fallback.name };
  }
}

/** A goal plus the offchain half the screens need. */
export type GoalView = Goal & { id: number } & GoalMeta;

/* ═══════════════════════════ progress, in both currencies ═══════════════════════════ */

/**
 * Whether the goal would count as met if the date were today.
 *
 * The same arithmetic as the contract's `onTrack` view, deliberately
 * duplicated: the list screen holds twenty goals, and twenty extra calls to
 * learn something already present in the struct it just read is twenty round
 * trips for nothing. The detail screen, which reads one goal, asks the
 * contract instead — so the copy of the rule is checked against the original
 * every time anybody opens a goal.
 */
export function isOnTrack(g: Goal): boolean {
  if (g.saved < g.target) return false;
  return g.behaviour === BehaviourType.SaveConsistently
    ? g.depositCount >= MIN_DEPOSITS
    : g.behaviourVerified;
}

/** How much is still to save. Never negative. */
export function amountLeft(g: Goal): bigint {
  return g.saved >= g.target ? 0n : g.target - g.saved;
}

/** How many more separate top-ups a save-consistently goal needs. */
export function depositsLeft(g: Goal): number {
  if (g.behaviour !== BehaviourType.SaveConsistently) return 0;
  return Math.max(0, MIN_DEPOSITS - g.depositCount);
}

/**
 * The habit half of the progress, which is not about money.
 *
 * Top-ups out of top-ups required for a save-consistently goal; a single
 * yes-or-no for an external signal, because the contract records exactly one
 * submission per goal and a second one reverts.
 */
export function habitProgress(g: GoalView): {
  value: number;
  max: number;
  /** For the bar's screen-reader label. */
  label: string;
  /** For a footer or a row. Short enough to sit beside a date. */
  short: string;
  done: boolean;
} {
  if (g.behaviour === BehaviourType.SaveConsistently) {
    const made = Math.min(g.depositCount, MIN_DEPOSITS);
    return {
      value: made,
      max: MIN_DEPOSITS,
      label: `${g.name}: ${made} of ${MIN_DEPOSITS} top-ups made`,
      short: `${made} of ${MIN_DEPOSITS} top-ups`,
      done: g.depositCount >= MIN_DEPOSITS,
    };
  }
  return {
    value: g.behaviourVerified ? 1 : 0,
    max: 1,
    label: g.behaviourVerified
      ? `${g.name}: habit marked as kept`
      : `${g.name}: habit not submitted yet`,
    short: g.behaviourVerified ? "Habit submitted" : "Habit not submitted",
    done: g.behaviourVerified,
  };
}

/* ═══════════════════════════ status and what to do next ═══════════════════════════ */

/**
 * The word and the tone for a goal.
 *
 * `nowSeconds` is a parameter rather than a call to the clock so a server
 * render and the browser render that follows it agree — otherwise the badge
 * flickers on hydration, which on a list of goals is the whole screen moving.
 *
 * "Needs closing" rather than "Over" for a goal past its date: the money is
 * sitting there waiting for somebody to press a button, and that is a job, not
 * a state.
 */
export function describeGoal(
  g: Goal,
  nowSeconds: number
): { status: string; tone: Tone } {
  switch (g.state) {
    case GoalState.Open: {
      if (nowSeconds >= Number(g.deadline)) {
        return { status: "Needs closing", tone: "attention" };
      }
      return isOnTrack(g)
        ? { status: "On track", tone: "progress" }
        : { status: "Saving", tone: "progress" };
    }
    case GoalState.Finalised:
      return g.succeeded
        ? { status: "Goal met", tone: "good" }
        : { status: "Goal missed", tone: "attention" };
    case GoalState.Settled:
      return { status: "Finished", tone: "over" };
    default:
      return { status: "Unknown", tone: "over" };
  }
}

/**
 * What this person can do about this goal right now.
 *
 * The cohort matters here and is optional, because the list screen has not
 * read it: a goal that has been closed can be in two completely different
 * places depending on whether everybody who picked the same date has closed
 * theirs, and the list honestly cannot tell which. Without a cohort the answer
 * is `"wait-for-others"`, which is the safe reading — it never offers a button
 * that would revert.
 */
export type NextStep =
  /** Still short of the target, or short of the top-ups it takes. */
  | "add-money"
  /** External signal, not yet submitted. */
  | "submit-habit"
  /** The date has passed and nobody has closed it. */
  | "close"
  /** Closed, cohort complete, there is money to collect. */
  | "claim"
  /** Closed, but somebody in the cohort has not closed theirs yet. */
  | "wait-for-others"
  /** Closed and missed, while somebody else met theirs: the stake is gone. */
  | "nothing-to-claim"
  /** On track, nothing to do until the date. */
  | "wait-for-date"
  /** Settled. Over. */
  | "done";

export function nextStep(
  g: Goal,
  nowSeconds: number,
  cohort?: Cohort
): NextStep {
  if (g.state === GoalState.Settled) return "done";

  if (g.state === GoalState.Open) {
    if (nowSeconds >= Number(g.deadline)) return "close";
    if (g.saved < g.target) return "add-money";
    if (g.behaviour === BehaviourType.SaveConsistently) {
      return g.depositCount < MIN_DEPOSITS ? "add-money" : "wait-for-date";
    }
    return g.behaviourVerified ? "wait-for-date" : "submit-habit";
  }

  // Finalised. `claimOutcome` reverts unless the whole cohort is closed, so
  // the button is not offered until we know it is.
  if (!cohort || cohort.finalisedCount < cohort.goalCount) {
    return "wait-for-others";
  }
  if (g.succeeded) return "claim";
  // Missed. The stake only comes back when nobody in the cohort met theirs;
  // otherwise it has already gone to the people who did.
  return cohort.winningStakeTotal === 0n ? "claim" : "nothing-to-claim";
}

/* ═══════════════════════════ the cohort's arithmetic ═══════════════════════════ */

/**
 * What a closed goal is owed, and why.
 *
 * This repeats `claimOutcome`'s arithmetic so the screen can show the figure
 * before the button is pressed rather than after. It is exact given the cohort
 * as it stands — including the rule that the last winner to claim sweeps the
 * remainder, so no paisa is stranded by rounding.
 */
export type Outcome =
  | { kind: "waiting"; closed: number; total: number }
  | { kind: "won"; stakeBack: bigint; bonus: bigint; nobodyMissed: boolean }
  | { kind: "refunded"; stakeBack: bigint }
  | { kind: "forfeited"; stakeLost: bigint }
  | { kind: "settled" };

export function outcomeFor(g: Goal, cohort: Cohort | undefined): Outcome {
  if (g.state === GoalState.Settled) return { kind: "settled" };
  if (!cohort || cohort.finalisedCount < cohort.goalCount) {
    return {
      kind: "waiting",
      closed: cohort?.finalisedCount ?? 0,
      total: cohort?.goalCount ?? 0,
    };
  }

  if (g.succeeded) {
    let bonus = 0n;
    if (cohort.winnersRemaining === 1) {
      bonus = cohort.poolRemaining;
    } else if (cohort.winningStakeTotal > 0n) {
      bonus = (cohort.forfeitedPool * g.stake) / cohort.winningStakeTotal;
    }
    return {
      kind: "won",
      stakeBack: g.stake,
      bonus,
      nobodyMissed: cohort.forfeitedPool === 0n,
    };
  }

  return cohort.winningStakeTotal === 0n
    ? { kind: "refunded", stakeBack: g.stake }
    : { kind: "forfeited", stakeLost: g.stake };
}

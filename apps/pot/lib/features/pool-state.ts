/**
 * Keep each other to it — the types and the state logic, with no client
 * dependency.
 *
 * ──────────────── why this is a separate file ────────────────
 *
 * Same reason as `pay-state.ts`: `pool.ts` carries "use client" because it
 * holds React Query hooks and a wagmi client, and that directive applies to the
 * whole module. A Server Component importing a pure helper from it gets
 *
 *   Attempted to call describePool() from the server but describePool is on
 *   the client.
 *
 * so the enums, shapes and pure functions live here, where both sides can
 * import them, and `pool.ts` re-exports them for client code that wants one
 * import.
 *
 * ──────────────── what this feature actually is ────────────────
 *
 * A closed group stakes the same amount on a shared commitment. Each day a
 * member marks that they did the thing. At the deadline the pool is tallied:
 * whoever marked enough days gets their stake back plus a share of the stakes
 * of whoever did not. **That is the only source of a payout — there is no
 * sponsor, no yield and no outside money.** If everybody keeps it, everybody
 * gets exactly their stake back and nobody gains a paisa. If nobody keeps it,
 * every stake goes home. Both of those are honest arithmetic rather than
 * failures, and the screens have to say so in those words.
 *
 * ──────────────── the honesty rule this file encodes ────────────────
 *
 * Nothing in this repository verifies that anybody did anything. A "marked"
 * day is a number typed into a box, bounds-checked and signed by a server that
 * is taking the person's word for it (`docs/trust-layer.md` §3,
 * `docs/limitations.md`). So the vocabulary below never says "verified",
 * "confirmed" or "proved". It says **marked**, and the screens carry the
 * sentence that says who marked it.
 */

/** Mirrors AccountabilityPool.State. Index matters: it is the on-chain enum. */
export const PoolState = {
  None: 0,
  Open: 1,
  Finalised: 2,
} as const;
export type PoolStateValue = (typeof PoolState)[keyof typeof PoolState];

/**
 * Mirrors AccountabilityPool.Pool.
 *
 * The number/bigint split is not a style choice: viem decodes uint32 as a
 * `number` and uint64 upwards as a `bigint`, so `requiredDays` is a number and
 * `deadline` is not. Writing them the other way round compiles and then fails
 * at the first comparison.
 */
export type Pool = {
  creator: `0x${string}`;
  /** What every member puts in, in paise. The same for everyone. */
  stakePerMember: bigint;
  /** Everything the pool is holding, in paise. */
  pot: bigint;
  /** Forfeited stakes still waiting to be handed out. Zero until settled. */
  forfeited: bigint;
  /** The stakes of everyone who kept it, used to work out each share. */
  winningStakeTotal: bigint;
  /** Unix seconds, EXCLUSIVE: days can be marked strictly before this. */
  deadline: bigint;
  requiredDays: number;
  /** How many of the required days you are allowed to miss. */
  graceDays: number;
  maxMembers: number;
  /** How many kept it. Zero until settled. */
  winners: number;
  /** How many of them have not claimed yet. Zero until settled. */
  unclaimed: number;
  state: PoolStateValue;
};

/** Mirrors AccountabilityPool.Member. */
export type Member = {
  joined: boolean;
  /** Only meaningful once the pool is settled. */
  succeeded: boolean;
  claimed: boolean;
  daysAttested: number;
};

/** One person in the pool, with the name they chose. */
export type PoolMember = Member & {
  address: `0x${string}`;
  /** Their saved name, or a stable friendly tag. Never an address. */
  name: string;
  /** True for the signed-in person, so the row can say "You". */
  isYou: boolean;
};

/** A pool plus everything the UI needs that is not on the chain. */
export type PoolView = Pool & {
  id: number;
  /** What the group committed to. Offchain text; "" if it was never saved. */
  commitment: string;
  /** Which number members report each day. Offchain, chosen at creation. */
  metric: BehaviourMetric;
  memberCount: number;
  /** The signed-in person's row. `joined: false` when they are not in it. */
  me: Member;
  /** Whether the signed-in person has already marked today. */
  recordedToday: boolean;
  /** What `claim` would pay them right now. Both zero until settled. */
  claimableStake: bigint;
  claimableBonus: bigint;
};

/* ═══════════════════════════ the contract's own bounds ═══════════════════════════ */

/** AccountabilityPool.MAX_MEMBERS_CAP. */
export const MAX_MEMBERS = 20;
/** `maxMembers < 2` is rejected: a pool of one has nobody to be accountable to. */
export const MIN_MEMBERS = 2;
/** MIN_DURATION / MAX_DURATION, in days. */
export const MIN_DURATION_DAYS = 1;
export const MAX_DURATION_DAYS = 365;

/**
 * The first deadline date the create screen offers, in days from today.
 *
 * The contract wants `deadline >= block.timestamp + 1 day`, measured when the
 * transaction *mines* rather than when the form was filled in. A deadline set
 * to the end of tomorrow is exactly 24 hours away at the moment of typing and
 * slightly less by the time it lands, which reverts with InvalidParams and
 * looks to the person like the date was simply refused. Two days is the first
 * choice that cannot fail for that reason.
 */
export const EARLIEST_DEADLINE_DAYS = 2;
/** One day inside MAX_DURATION, for the same mining-latency reason. */
export const LATEST_DEADLINE_DAYS = MAX_DURATION_DAYS - 1;

/* ═══════════════════════════ the daily signal ═══════════════════════════ */

/**
 * The two numbers a member can report. These are the metrics
 * `app/api/trust/attest-day/route.ts` accepts, and the bounds are its bounds —
 * a value above them is refused by the server with a sentence, not clamped,
 * because silently capping a typo would let a day count on a number nobody
 * meant.
 */
export type BehaviourMetric = "steps" | "screen_time_minutes";

export const METRICS: {
  value: BehaviourMetric;
  /** The option title on the create screen. */
  title: string;
  /** The consequence, spelled out next to the option. */
  body: string;
  /** The field label when a day is being marked. */
  fieldLabel: string;
  /** Plural unit, for "8,000 steps". */
  unit: string;
  /** The server's upper bound for this metric. */
  max: number;
}[] = [
  {
    value: "steps",
    title: "Steps walked",
    body: "Everyone types the number of steps they walked that day.",
    fieldLabel: "How many steps today?",
    unit: "steps",
    max: 50_000,
  },
  {
    value: "screen_time_minutes",
    title: "Minutes on your phone",
    body: "Everyone types how many minutes of screen time they had that day.",
    fieldLabel: "How many minutes on your phone today?",
    unit: "minutes",
    max: 1440,
  },
];

export function metricInfo(metric: BehaviourMetric) {
  return METRICS.find((m) => m.value === metric) ?? METRICS[0]!;
}

/* ═══════════════════════════ the offchain note ═══════════════════════════ */

/**
 * What the group committed to, and which number they report.
 *
 * Neither is on the chain — AccountabilityPool stores no text at all — so both
 * live in the same offchain key/value store the pot names and repayment memos
 * use (`lib/store.ts`). One row per pool, holding both fields as JSON, because
 * a second store for one extra word would be a second thing to keep honest.
 *
 * Decoding is deliberately forgiving: a row written by an older build, or by
 * hand, comes back as the commitment text with the default metric rather than
 * throwing and taking the whole screen down with it.
 */
export type PoolNote = { commitment: string; metric: BehaviourMetric };

export function encodePoolNote(note: PoolNote): string {
  return JSON.stringify({ v: 1, commitment: note.commitment, metric: note.metric });
}

export function decodePoolNote(raw: string | undefined | null): PoolNote {
  if (!raw) return { commitment: "", metric: "steps" };
  try {
    const parsed = JSON.parse(raw) as Partial<PoolNote>;
    const metric: BehaviourMetric =
      parsed.metric === "screen_time_minutes" ? "screen_time_minutes" : "steps";
    return {
      commitment: typeof parsed.commitment === "string" ? parsed.commitment : "",
      metric,
    };
  } catch {
    // Not JSON: an earlier plain-text note. Keep the words, guess the metric.
    return { commitment: raw, metric: "steps" };
  }
}

/** The title a screen shows when nobody saved what the group committed to. */
export function poolTitle(view: { id: number; commitment: string }): string {
  return view.commitment.trim() || `Group commitment #${view.id}`;
}

/* ═══════════════════════════ days ═══════════════════════════ */

const DAY_MS = 86_400_000;
const DAY_SECONDS = 86_400;

/**
 * Whole days since the epoch, for the calendar date a person is living in.
 *
 * This has to agree with the server, which computes `dayNumber("2026-10-11")`
 * by parsing that date at UTC midnight (`lib/server/trust-signer.ts`). The
 * browser sends its own *local* date, so the day number is the local calendar
 * date reinterpreted as UTC — which is exactly what `Date.UTC` below produces.
 * Using `ms / DAY_MS` directly would file a Delhi evening as tomorrow.
 */
export function localDayNumber(ms: number): number {
  const d = new Date(ms);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
}

/** Today where the person is, as YYYY-MM-DD. Mirrors `localToday()`. */
export function localDayString(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The last calendar day a member can still mark.
 *
 * The deadline is exclusive, so a pool ending at midnight on the 18th can be
 * marked on the 17th and not the 18th. One second back from the deadline lands
 * in the last day that is genuinely usable.
 */
export function lastMarkableDay(deadline: bigint): number {
  return localDayNumber((Number(deadline) - 1) * 1000);
}

/** How many days are left to mark, today included. Never negative. */
export function daysLeftToMark(deadline: bigint, nowSeconds: number): number {
  const left = lastMarkableDay(deadline) - localDayNumber(nowSeconds * 1000) + 1;
  return left > 0 ? left : 0;
}

/** Days between now and the deadline, for a create-screen sanity check. */
export function daysBetween(fromSeconds: number, toSeconds: number): number {
  return Math.floor((toSeconds - fromSeconds) / DAY_SECONDS);
}

/**
 * How many more days this member needs. Zero means they are already safe.
 *
 * The grace rule, in the contract's own form: you succeed when
 * `daysAttested + graceDays >= requiredDays`. Written as an addition rather
 * than a subtraction for the same reason the contract does it that way — it
 * cannot underflow.
 */
export function daysStillNeeded(
  pool: Pick<Pool, "requiredDays" | "graceDays">,
  daysAttested: number
): number {
  const have = daysAttested + pool.graceDays;
  return have >= pool.requiredDays ? 0 : pool.requiredDays - have;
}

/** Would this member keep it if the pool were tallied right now? */
export function onTrack(
  pool: Pick<Pool, "requiredDays" | "graceDays">,
  daysAttested: number
): boolean {
  return daysStillNeeded(pool, daysAttested) === 0;
}

/**
 * True when there are no longer enough days left for this member to get there.
 *
 * The contract does not know this and does not need to — it simply tallies at
 * the deadline. A screen that stays quiet about it, though, shows somebody a
 * progress bar and a "keep going" button for a stake that is already gone.
 */
export function outOfTime(
  pool: Pick<Pool, "requiredDays" | "graceDays" | "deadline">,
  daysAttested: number,
  nowSeconds: number
): boolean {
  const needed = daysStillNeeded(pool, daysAttested);
  return needed > 0 && needed > daysLeftToMark(pool.deadline, nowSeconds);
}

/** The rule, in one sentence, with the grace spelled out rather than implied. */
export function ruleSentence(
  pool: Pick<Pool, "requiredDays" | "graceDays">
): string {
  const { requiredDays: required, graceDays: grace } = pool;
  if (grace === 0) {
    return `Mark all ${required} days. Miss one and your stake goes to the others.`;
  }
  return `Mark ${required} days, and you may miss ${grace}. So ${
    required - grace
  } marked days is enough.`;
}

/* ═══════════════════════════ status and actions ═══════════════════════════ */

export type PoolTone = "progress" | "good" | "attention" | "over";

/**
 * The word and tone for a pool, from the signed-in person's point of view.
 *
 * One pool is several different situations depending on who is looking: a
 * stranger sees something they could join, a member who is behind sees
 * something that needs them today, and a member whose stake is already lost
 * must not be shown "On track". Getting this wrong is not cosmetic — it is the
 * difference between somebody acting today and finding out at the deadline.
 *
 * `nowSeconds` is a parameter rather than a call to the clock so a server
 * render and the browser render that follows it agree by construction.
 */
export function describePool(
  view: PoolView,
  nowSeconds: number
): { status: string; tone: PoolTone } {
  if (view.state === PoolState.Finalised) {
    const everybodyFailed = view.winners === 0;
    if (view.me.joined && !view.me.claimed) {
      if (view.claimableStake + view.claimableBonus > 0n) {
        return { status: "Money to take back", tone: "attention" };
      }
      // Joined, settled, nothing to take: they missed it while others kept it.
      return { status: "You missed it", tone: "over" };
    }
    if (everybodyFailed) return { status: "Nobody kept it", tone: "over" };
    return { status: "Settled", tone: "over" };
  }

  // Open, but the last day has passed: somebody has to tally it before anyone
  // can take money back. Permissionless, so this is nobody's fault but it is
  // also nobody's job until a person taps.
  if (nowSeconds >= Number(view.deadline)) {
    return { status: "Ready to settle", tone: "attention" };
  }

  if (!view.me.joined) {
    return view.memberCount >= view.maxMembers
      ? { status: "Full", tone: "over" }
      : { status: "Open to join", tone: "progress" };
  }

  if (outOfTime(view, view.me.daysAttested, nowSeconds)) {
    return { status: "Can't be met now", tone: "attention" };
  }
  if (!view.recordedToday) return { status: "Mark today", tone: "attention" };
  if (onTrack(view, view.me.daysAttested)) {
    return { status: "On track", tone: "good" };
  }
  return { status: "Running", tone: "progress" };
}

/** The one thing this person can do about this pool right now, if anything. */
export type PoolAction = "join" | "mark" | "settle" | "claim" | null;

export function pendingAction(view: PoolView, nowSeconds: number): PoolAction {
  if (view.state === PoolState.Finalised) {
    // Offered only when there is money in it. A member who missed it *can*
    // call claim — it marks them claimed and pays nothing — and putting that
    // on a button would be asking somebody to tap for zero.
    if (
      view.me.joined &&
      !view.me.claimed &&
      view.claimableStake + view.claimableBonus > 0n
    ) {
      return "claim";
    }
    return null;
  }

  if (view.state !== PoolState.Open) return null;

  if (nowSeconds >= Number(view.deadline)) return "settle";
  if (!view.me.joined) {
    return view.memberCount >= view.maxMembers ? null : "join";
  }
  return view.recordedToday ? null : "mark";
}

/** The state label on a member's row. Carries a word, never a colour alone. */
export function memberStateLabel(
  pool: PoolView,
  member: Member,
  nowSeconds: number
): { state: "done" | "waiting"; label: string } {
  if (pool.state === PoolState.Finalised) {
    return member.succeeded
      ? { state: "done", label: "Kept it" }
      : { state: "waiting", label: "Missed it" };
  }
  if (onTrack(pool, member.daysAttested)) {
    return { state: "done", label: "On track" };
  }
  if (outOfTime(pool, member.daysAttested, nowSeconds)) {
    return { state: "waiting", label: "Out of days" };
  }
  return { state: "waiting", label: "Behind" };
}

/* ═══════════════════════════ the settlement arithmetic ═══════════════════════════ */

/**
 * Which of the three honest endings this pool reached.
 *
 * Named rather than inferred at the point of rendering, because two of the
 * three read like something went wrong and the copy has to be written for each
 * one deliberately:
 *
 *   everyone-kept  nothing was forfeited, so nobody gains. Not a failed return.
 *   nobody-kept    there was nobody to redistribute to, so every stake goes
 *                  home. The contract keeps nothing it has no rule for.
 *   mixed          the only case where anybody gains, and what they gain came
 *                  out of a named friend's pocket.
 */
export type Settlement = "everyone-kept" | "nobody-kept" | "mixed";

export function settlementShape(view: PoolView): Settlement {
  if (view.winners === 0) return "nobody-kept";
  if (view.winners >= view.memberCount) return "everyone-kept";
  return "mixed";
}

/** How many members did not keep it, once the pool is settled. */
export function missedCount(view: PoolView): number {
  return Math.max(0, view.memberCount - view.winners);
}

/* ═══════════════════════════ the feed ═══════════════════════════ */

/**
 * One thing that happened in a pool, flattened out of the logs.
 *
 * Deliberately one shape with optional fields rather than a six-way union: a
 * feed row needs a kind, a place in the order, whoever it concerns and at most
 * one number, and a union would push six log types into every component that
 * renders a line.
 */
export type PoolActivityEntry = {
  kind: "created" | "joined" | "marked" | "settled" | "claimed" | "forfeited";
  blockNumber: bigint;
  logIndex: number;
  /** Whoever the event names, when it names somebody. */
  member?: `0x${string}`;
  /** Days marked so far, on a "marked" entry. */
  daysAttested?: number;
  /** Paise: the stake, the stake back, or the stake forfeited. */
  amount?: bigint;
  /** Paise gained from other people's forfeited stakes, on a "claimed" entry. */
  bonus?: bigint;
  /** How many kept it, on a "settled" entry. */
  winners?: number;
};

/**
 * One line of history, phrased for a person rather than restating the event.
 *
 * `nameOf` resolves an address to the name that person chose, so the feed never
 * shows an address. Amounts are left to the caller to format — this module
 * knows nothing about rupees.
 */
export function poolActivityLine(
  entry: PoolActivityEntry,
  nameOf: (address: `0x${string}`) => string
): string {
  const who = entry.member ? nameOf(entry.member) : "Somebody";
  switch (entry.kind) {
    case "created":
      return "The pool was started";
    case "joined":
      return `${who} joined and put their stake in`;
    case "marked":
      return entry.daysAttested !== undefined
        ? `${who} marked a day — ${entry.daysAttested} so far`
        : `${who} marked a day`;
    case "settled":
      return entry.winners === 0
        ? "Settled: nobody met the rule, so every stake goes back"
        : `Settled: ${entry.winners} ${
            entry.winners === 1 ? "person" : "people"
          } kept it`;
    case "claimed":
      return `${who} took their money back`;
    case "forfeited":
      return `${who} did not keep it, so their stake goes to the others`;
  }
}

/* ═══════════════════════════ people ═══════════════════════════ */

/**
 * "Friend A91C" — recognisable, stable, and not an address on a screen.
 *
 * The same formula as `friendlyTag` in `lib/people.ts`, restated rather than
 * imported because that module is "use client" and this one must stay usable
 * from a Server Component.
 */
export function friendlyName(address: string): string {
  return `Friend ${address.slice(2, 6).toUpperCase()}`;
}

/* ═══════════════════════════ errors ═══════════════════════════ */

/**
 * Turns a revert from AccountabilityPool into something a person can act on.
 *
 * Kept here rather than added to `readableError` in `lib/tx.ts` so this
 * feature's vocabulary stays in this feature's files. It falls through to the
 * same shape of generic messages, and it passes a trust-layer error straight
 * through: those already arrive as finished sentences from the server, and
 * replacing "You have already submitted for that day." with "Something went
 * wrong" would throw away the only useful thing in the response.
 */
export function readablePoolError(err: unknown): string {
  const raw =
    err instanceof Error ? `${err.message}` : typeof err === "string" ? err : "";

  // TrustCallError (lib/trust/client.ts) is already a sentence for a person.
  // Matched by name rather than by `instanceof` so this module needs no import.
  if (err instanceof Error && err.name === "TrustCallError" && err.message) {
    return err.message;
  }

  const map: Record<string, string> = {
    InvalidParams: "Please check the details and try again.",
    PoolNotFound: "We couldn't find that pool.",
    WrongState: "This pool isn't running any more.",
    AlreadyMember: "You're already in this pool.",
    NotMember: "Only people in this pool can do that.",
    PoolFull: "This pool is already full.",
    DeadlinePassed: "The last day for this pool has passed.",
    DeadlineNotReached: "The last day hasn't passed yet.",
    AlreadyAttested: "You've already marked that day.",
    BadAttestation: "We couldn't record that day. Please try again.",
    AlreadyClaimed: "You've already taken your money back.",
    ZeroAddress: "This isn't set up properly yet.",
    ERC20InsufficientBalance:
      "You don't have enough test money. Collect some first.",
    ERC20InsufficientAllowance:
      "Couldn't move your test money — please try again.",
  };

  for (const [name, message] of Object.entries(map)) {
    if (raw.includes(name)) return message;
  }
  if (/user rejected|denied/i.test(raw)) return "Cancelled.";
  if (/insufficient funds/i.test(raw)) {
    return "Fees aren't being covered right now — check fee sponsorship is on.";
  }
  return "Something went wrong. Please try again.";
}

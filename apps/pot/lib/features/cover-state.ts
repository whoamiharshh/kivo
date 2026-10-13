/**
 * Small-ticket cover — the types, the state logic and the disclosures, with no
 * client dependency.
 *
 * ──────────────── why this is a separate file ────────────────
 *
 * `cover.ts` carries "use client" because it holds React Query hooks and a
 * wagmi client, and that directive applies to the whole module: a pure
 * function exported from it becomes a client export, and a Server Component
 * calling one gets "Attempted to call describe() from the server but describe
 * is on the client." Rather than make a whole screen interactive to borrow one
 * switch statement, the parts with no client dependency live here, where both
 * sides can import them. Same split, same reason, as `pay-state.ts`.
 *
 * ──────────────── why the disclosure copy lives here too ────────────────
 *
 * Three screens have to say the same three things: this is not insurance, the
 * trigger is a pressed button, and the insurer decides a claim. If each screen
 * wrote its own sentence they would drift, and the screen that drifted would be
 * the one that quietly promised cover. So the wording is a constant imported by
 * all three, and changing it changes every screen at once.
 */

/** Mirrors MicroCover.PolicyState. Index matters: it is the on-chain enum. */
export const PolicyState = {
  None: 0,
  /** Premium held. **No cover exists yet.** */
  Escrowed: 1,
  /** The insurer bound the risk. Cover is in force between start and end. */
  Active: 2,
  /** Nobody bound it; the premium went back to whoever paid. */
  Refunded: 3,
  /** Settled, declined, or ended with no claim. */
  Closed: 4,
} as const;
export type PolicyStateValue = (typeof PolicyState)[keyof typeof PolicyState];

/** Mirrors MicroCover.ClaimState. */
export const ClaimState = {
  None: 0,
  Submitted: 1,
  Paid: 2,
  Declined: 3,
} as const;
export type ClaimStateValue = (typeof ClaimState)[keyof typeof ClaimState];

/** Mirrors MicroCover.Policy. Amounts are paise; times are unix seconds. */
export type Policy = {
  /** Who the cover is for. The only address a payout can reach. */
  insured: `0x${string}`;
  /** Who paid the premium. A refund goes here, which need not be the insured. */
  payer: `0x${string}`;
  premium: bigint;
  /** The most this cover can ever pay out. */
  coverage: bigint;
  startTime: bigint;
  endTime: bigint;
  createdAt: bigint;
  /** Fingerprint of the cover wording. Fixed at creation, forever. */
  policyTermsHash: `0x${string}`;
  state: PolicyStateValue;
};

/** Mirrors MicroCover.Claim. */
export type Claim = {
  evidenceHash: `0x${string}`;
  payout: bigint;
  submittedAt: bigint;
  settledAt: bigint;
  state: ClaimStateValue;
};

/** A policy plus its claim and everything the UI needs that is not on-chain. */
export type PolicyView = Policy & {
  id: number;
  claim: Claim;
  /** What the cover says, recovered by its fingerprint. Empty if never saved. */
  terms: string;
  /** What the claim said, recovered the same way. Empty if there is no claim. */
  evidence: string;
  /** True when the signed-in person is the one covered. */
  insuredIsMe: boolean;
  /** True when the signed-in person paid the premium. Decides who may refund. */
  payerIsMe: boolean;
};

/* ═══════════════════════ the contract's own bounds ═══════════════════════ */

/** `MicroCover.CLAIM_WINDOW` — how long after cover ends a claim may be made. */
export const CLAIM_WINDOW_SECONDS = 30 * 24 * 60 * 60;
/** `MicroCover.BIND_WINDOW` — how long the insurer has before a refund opens. */
export const BIND_WINDOW_SECONDS = 24 * 60 * 60;
/** `MicroCover.MIN_DURATION` / `MAX_DURATION`. */
export const MIN_DURATION_SECONDS = 10 * 60;
export const MAX_DURATION_SECONDS = 365 * 24 * 60 * 60;

/* ═══════════════════════ what has to be said out loud ═══════════════════════ */

/**
 * The three sentences this feature is not allowed to leave off a screen.
 *
 * Every one of them is a quotation of something already true in this
 * repository rather than a softened version of it: `MicroCover.sol`'s own
 * header says the contract is not an insurer and provides no cover;
 * `docs/limitations.md` says the risk-bearing entity must be IRDAI-licensed
 * and that none exists here; the `oracle_events` table comment says in so many
 * words that the trigger is a button somebody pressed.
 *
 * They are long for UI copy. That is the point — a short version of "this is
 * not insurance" is how a person ends up believing it is.
 */
export const DISCLOSURE = {
  /** The headline. Goes above the fold on all three screens. */
  notInsurance:
    "This is not insurance. Nobody here is a licensed insurer, no cover wording has been filed with the IRDAI, and nothing on these screens creates cover anyone is obliged to honour. What it is, exactly: a demonstration of how cover would settle.",

  /** Who decides, in the plainest form. Never softened to "the system". */
  whoDecides:
    "A claim is decided by the insurer — never by this app, and never by the people who built it. On this test setup there is no insurer, so the decision is a button somebody presses, and it is recorded as simulated for good.",

  /** Said next to the trigger itself, where the press actually happens. */
  pressedButton:
    "The trigger is a button, pressed here. There is no weather feed, no flight data, no claims assessor and no insurer on the other end of it. A real product replaces this with the insurer's own feed or a decentralised source.",

  /** Said wherever a premium is taken but no cover exists yet. */
  notCoveredYet:
    "Paying the premium does not start the cover. The money is held until an insurer takes on the risk. Until that happens you are not covered, and if nobody takes it on you take the premium back.",

  /** Said wherever evidence is asked for. */
  noEvidenceStore:
    "This demonstration records only what you type. A real claim needs a photo, a repair bill or an assessor's report, and there is nowhere in this app to put one yet.",
} as const;

/**
 * What cannot be done on the current deployment, and why — in one place.
 *
 * Binding a policy and settling a claim are both insurer-only in `MicroCover`:
 * `activatePolicy` needs `msg.sender == insurer`, and `settleClaim` needs a
 * signature from `insurerSigner`. Both are immutable, and on this deployment
 * they are the deployer key and the trust-signer key — the two keys that are
 * treated as compromised and switched off. So neither can happen here, and the
 * screens say so rather than offering a button that either fails or, worse,
 * "succeeds" on something that did not happen.
 *
 * These lines are tied to *this deployment*. When fresh contracts with fresh
 * role keys are live, they should be revisited, not left to go stale.
 */
export const INSURER_UNAVAILABLE = {
  /** Why a policy stays "not covered" no matter how long you wait. */
  bind:
    "Starting cover needs an insurer's own key, and there is no insurer on this test setup. So no policy here can be taken on: it stays held, you stay not covered, and you can take the premium back after a day — or when the period ends, if that comes first.",
  /** Why a submitted claim can't be decided. */
  decide:
    "Deciding a claim needs an insurer's approval, and there is no insurer on this test setup, so a claim can be recorded but not paid or declined. Nothing is pretended: no decision button is offered.",
} as const;

/**
 * Every policy id that can exist, given how many have been made.
 *
 * `MicroCover` numbers policies from **1** (`policyId = ++policyCount`), and
 * `getPolicy(0)` reverts `PolicyNotFound`. Walking `0..count-1` therefore fails
 * the whole batched read as soon as one policy exists, and never reaches the
 * newest. Other contracts here number from 0 (SocialPay, Gift, SalaryStream,
 * BehaviourSavings, IncomeShare) and PotManager and AccountabilityPool, like
 * this one, from 1 — so the base has to be checked per contract, not assumed.
 */
export function allPolicyIds(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i + 1);
}

/* ═══════════════════════ the cover shapes on offer ═══════════════════════ */

/**
 * What a person can take out cover on, and what cannot be checked about it.
 *
 * ──────────────── why there is no catalogue, and no price ────────────────
 *
 * A real product is a filed product: `cover_products.sellable` cannot be set
 * without an `irdai_filing_reference`, and a database constraint enforces that
 * precisely so an unfiled product cannot quietly be sold. No insurer has
 * onboarded here, so that table holds nothing, so there is no premium and no
 * cover amount for this screen to read.
 *
 * Which leaves two options: invent prices, or ask. Inventing a premium would be
 * the single most dishonest thing this feature could do — it is the number a
 * licensed underwriter exists to produce — so the person sets both amounts
 * themselves and the screen says why.
 *
 * What is left in each shape below is the part this repository can actually
 * stand behind: how exposure would be measured, and what that measurement
 * cannot catch. Every `cannotCheck` line is `docs/limitations.md`, "How
 * exposure is measured, and what each measure cannot stop", in shorter words.
 */
export type CoverShape = {
  id: "device" | "journey" | "equipment" | "other";
  title: string;
  /** One line, for the picker. */
  summary: string;
  /** A starting point for the wording. The person edits it; nothing is fixed. */
  suggestedTerms: string;
  /** The honest exclusions. Shown as prominently as the cover amount. */
  cannotCheck: string[];
};

export const COVER_SHAPES: readonly CoverShape[] = [
  {
    id: "device",
    title: "A laptop or phone, for a few hours",
    summary: "You say what the thing is and how long to cover it for.",
    suggestedTerms:
      "Cover for my laptop against accidental damage while I carry it today.",
    cannotCheck: [
      "Nothing checks that the laptop exists, is yours, or was not already broken. There is no serial number anything here can read, and a photo of a sticker is only a photo.",
      "A check on your phone can say the phone is genuine. It says nothing about the laptop sitting next to it.",
    ],
  },
  {
    id: "journey",
    title: "A journey, for the hours you travel",
    summary: "Cover that starts now and ends when the trip does.",
    suggestedTerms:
      "Cover for my trip from the hostel to the station and back this evening.",
    cannotCheck: [
      "A phone's location can be faked from its developer settings, and a made-up route that looks plausible is not something this app can detect at all.",
      "Nothing here knows whether the journey happened, only what you say about it.",
    ],
  },
  {
    id: "equipment",
    title: "Equipment, for a set period",
    summary: "A camera, an instrument, kit borrowed for a fest.",
    suggestedTerms:
      "Cover for the camera I have borrowed for the fest, for the three days I have it.",
    cannotCheck: [
      "A photo can prove where and when it was taken and still show the wrong thing. Whether the equipment is yours, and whether the damage shown is the damage claimed, is not something a photo settles.",
      "Most phones attach no provenance to a photo at all, so the usual case is no proof either way.",
    ],
  },
  {
    id: "other",
    title: "Something else",
    summary: "Write the cover yourself.",
    suggestedTerms: "",
    cannotCheck: [
      "Nothing is measured. A claim would be decided from what you have written and nothing else.",
    ],
  },
] as const;

/**
 * True of every shape, so it is not buried in one of them.
 *
 * `docs/limitations.md` puts it in one sentence and it is the sentence an
 * underwriter would care about most, so it is quoted rather than paraphrased.
 */
export const EXPOSURE_CAVEAT =
  "The person describing what is covered is the person who would be paid for it. That is true of all of these.";

/** The periods offered, each well inside the contract's 10 minutes … 365 days. */
export const PERIODS = [
  { value: "3h", title: "3 hours", seconds: 3 * 60 * 60 },
  { value: "1d", title: "1 day", seconds: 24 * 60 * 60 },
  { value: "7d", title: "7 days", seconds: 7 * 24 * 60 * 60 },
  { value: "30d", title: "30 days", seconds: 30 * 24 * 60 * 60 },
] as const;
export type PeriodChoice = (typeof PERIODS)[number]["value"];

/* ═══════════════════════ reading a policy's state ═══════════════════════ */

/** 0x1234…abcd, for the rare case where somebody has no saved name. */
export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Is cover actually in force this second?
 *
 * Mirrors `MicroCover.isCovered` rather than calling it, so a list of twenty
 * policies is not twenty extra reads. The `startTime` half matters: a policy
 * bought for later is `Active` and **not covered**, and a screen that showed
 * "Active" alone would be telling somebody they are covered when they are not.
 */
export function coverInForce(p: Policy, nowSeconds: number): boolean {
  return (
    p.state === PolicyState.Active &&
    nowSeconds >= Number(p.startTime) &&
    nowSeconds <= Number(p.endTime)
  );
}

/** When the last day to make a claim falls, in unix seconds. */
export function claimWindowEnd(p: Policy): number {
  return Number(p.endTime) + CLAIM_WINDOW_SECONDS;
}

/** When the premium becomes the payer's to take back, in unix seconds. */
export function refundOpensAt(p: Policy): number {
  // Either the insurer's day to bind runs out, or the cover period itself
  // ends — whichever comes first. Both are in `refundUnboundPremium`.
  return Math.min(Number(p.createdAt) + BIND_WINDOW_SECONDS, Number(p.endTime));
}

/**
 * The word and the tone for a policy, from the signed-in person's side.
 *
 * The one rule this function exists to keep: **no status may read as "you are
 * covered" unless cover is in force this second.** `Escrowed` is the dangerous
 * one — a premium has been paid, which feels like buying cover, and the
 * contract has bound nothing. It says "Not covered yet", never "Pending".
 */
export function describe(
  p: PolicyView,
  nowSeconds: number
): { status: string; tone: "progress" | "good" | "attention" | "over" } {
  if (p.claim.state === ClaimState.Submitted) {
    return { status: "Claim being decided", tone: "attention" };
  }
  if (p.claim.state === ClaimState.Paid) {
    return { status: "Claim paid", tone: "good" };
  }
  if (p.claim.state === ClaimState.Declined) {
    return { status: "No payout", tone: "over" };
  }

  switch (p.state) {
    case PolicyState.Escrowed:
      return { status: "Not covered yet", tone: "attention" };
    case PolicyState.Active: {
      if (nowSeconds < Number(p.startTime)) {
        return { status: "Starts later", tone: "progress" };
      }
      if (nowSeconds > Number(p.endTime)) {
        // Cover is over but a claim can still be made for a while, and that is
        // a different situation from a policy nothing more can happen to.
        return nowSeconds <= claimWindowEnd(p)
          ? { status: "Cover ended", tone: "over" }
          : { status: "Finished", tone: "over" };
      }
      return { status: "Covered now", tone: "good" };
    }
    case PolicyState.Refunded:
      return { status: "Premium returned", tone: "over" };
    case PolicyState.Closed:
      return { status: "Closed", tone: "over" };
    default:
      return { status: "Unknown", tone: "over" };
  }
}

/**
 * The one thing this person can do about this policy right now.
 *
 * `nowSeconds` is a parameter rather than a call to the clock so a server
 * render and the browser render that follows it cannot disagree — that
 * disagreement is what makes a row flicker on hydration, and here it would
 * flicker between "claim" and "nothing you can do".
 */
export function pendingAction(
  p: PolicyView,
  nowSeconds: number
):
  | "claim" // cover is live (or just ended) and nothing has been claimed
  | "trigger" // a claim is in, waiting for the decision
  | "take-back-premium" // nobody bound it and the wait is over
  | "close" // ended, unclaimed, and the reserve behind it can be released
  | null {
  if (p.state === PolicyState.Escrowed) {
    if (!p.payerIsMe) return null;
    return nowSeconds > refundOpensAt(p) ? "take-back-premium" : null;
  }

  if (p.state !== PolicyState.Active) return null;

  if (p.claim.state === ClaimState.Submitted) {
    return p.insuredIsMe ? "trigger" : null;
  }

  if (p.claim.state === ClaimState.None) {
    // A claim is reportable from the moment cover starts until CLAIM_WINDOW
    // after it ends. Before the start there is nothing to claim about.
    if (
      p.insuredIsMe &&
      nowSeconds >= Number(p.startTime) &&
      nowSeconds <= claimWindowEnd(p)
    ) {
      return "claim";
    }
    // Permissionless once the reporting window shuts, which is why anybody
    // seeing this policy is offered it rather than only the insurer.
    if (nowSeconds > claimWindowEnd(p)) return "close";
  }

  return null;
}

/* ═══════════════════════ plain time wording ═══════════════════════ */

const HOUR = 3600;
const DAY = 24 * HOUR;

/**
 * "3 hours left", "ended 2 days ago" — taking the time as a parameter.
 *
 * `lib/time.ts` has `deadlineLabel`, which reads the clock itself. That is
 * fine for a client component and wrong for a presentational one, so this is
 * the same wording with `nowSeconds` passed in.
 */
export function relativeLabel(whenSeconds: number, nowSeconds: number): string {
  const left = whenSeconds - nowSeconds;
  if (left <= 0) {
    const ago = -left;
    if (ago < HOUR) return "just now";
    if (ago < DAY) return `${Math.floor(ago / HOUR)} hours ago`;
    const days = Math.floor(ago / DAY);
    return days === 1 ? "1 day ago" : `${days} days ago`;
  }
  if (left < HOUR) return `${Math.max(1, Math.floor(left / 60))} minutes`;
  if (left < DAY) {
    const hours = Math.floor(left / HOUR);
    return hours === 1 ? "1 hour" : `${hours} hours`;
  }
  const days = Math.floor(left / DAY);
  return days === 1 ? "1 day" : `${days} days`;
}

/** "Sat 12 Oct, 6:00 pm" — the exact moment, for a period a person relies on. */
export function momentLabel(seconds: bigint | number): string {
  return new Date(Number(seconds) * 1000).toLocaleString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

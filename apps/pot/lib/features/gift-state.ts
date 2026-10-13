/**
 * Money that unlocks when something happens — the shapes and the rules.
 *
 * ──────────────── why this file has no "use client" ────────────────
 *
 * Everything here is a pure function of a gift and a clock. Keeping it out of
 * the client module means a Server Component can import a label or a rule
 * without dragging a React Query hook and a wallet connection along with it.
 * `gift.ts` re-exports all of it, so screens still import from one place.
 *
 * ──────────────── the honesty rule this feature lives under ────────────────
 *
 * Nothing in this build observes the real world. A graduation, a job offer, a
 * birthday: the contract learns about none of them. Somebody the two of you
 * named says it happened, and the money unlocks. Every label here is written
 * so that distinction survives — "someone has to confirm it", never
 * "verified". `CONFIRMER_DISCLOSURE` is the one place that wording lives, so
 * a screen can choose whether to show it but never how to phrase it.
 */

/** Mirrors Gift.ConditionType. */
export const ConditionType = {
  /** Releases on a date, with nobody involved. */
  Time: 0,
  /** A backend signs that something happened. Not offered in this build. */
  Event: 1,
  /** A named person confirms it. */
  Attestation: 2,
} as const;
export type ConditionTypeValue =
  (typeof ConditionType)[keyof typeof ConditionType];

/** Mirrors Gift.State. */
export const GiftState = {
  None: 0,
  /** Waiting for the date, or for the person who has to confirm. */
  Pending: 1,
  /** Confirmed. The recipient may take it. */
  Attested: 2,
  Claimed: 3,
  /** The giver took it back. Only possible when it was not promised firmly. */
  Cancelled: 4,
  /** Taken by the recipient after the confirmer went quiet for long enough. */
  Released: 5,
} as const;
export type GiftStateValue = (typeof GiftState)[keyof typeof GiftState];

/** Mirrors Gift.GiftRecord, as `getGift` returns it. */
export type Gift = {
  sender: `0x${string}`;
  recipient: `0x${string}`;
  amount: bigint;
  conditionHash: `0x${string}`;
  /** Unix seconds. Only meaningful for a Time gift. */
  releaseTime: bigint;
  /** Who may confirm it. Zero for a Time gift. */
  attester: `0x${string}`;
  /** True when the giver gave up the right to take it back. */
  irrevocable: boolean;
  createdAt: bigint;
  /** After this, the recipient can take it even if nobody confirmed. */
  timeoutAt: bigint;
  conditionType: ConditionTypeValue;
  state: GiftStateValue;
};

/** A gift plus the parts that are not on the chain. */
export type GiftView = Gift & {
  id: number;
  /** What the gift is for, in the giver's words. "" when never saved. */
  message: string;
  /** True when the signed-in person is the one who gave it. */
  sending: boolean;
  /** The other party's saved name, or a stable friendly tag. */
  otherName: string;
  otherAddress: `0x${string}`;
};

/* ═══════════════════════════ what a screen may say ═══════════════════════════ */

/**
 * The sentence this feature is not allowed to soften.
 *
 * A gift that unlocks "when you graduate" does not know about graduations. It
 * knows that an address it was told about at the start sent a signature. If a
 * screen ever implies otherwise, somebody will believe a promise the software
 * cannot keep.
 */
export const CONFIRMER_DISCLOSURE =
  "Nothing here checks the real world. The person you both picked says it happened, and then the money unlocks.";

/** Why a gift can be taken back, or cannot. Said at the moment of giving. */
export const IRREVOCABLE_EXPLAINER =
  "A firm promise cannot be taken back, not even by you. Leave it off and you can cancel while it is still waiting.";

/* ═══════════════════════════ status and next step ═══════════════════════════ */

export type GiftTone = "progress" | "good" | "attention" | "over";

/**
 * Where the gift is, in words, from this person's side.
 *
 * The same row means two different things depending on who is reading it, so
 * `sending` decides the wording rather than every caller branching twice.
 */
export function describeGift(
  g: GiftView,
  nowSeconds: number
): { status: string; tone: GiftTone } {
  switch (g.state) {
    case GiftState.Claimed:
      return { status: g.sending ? "They took it" : "Yours", tone: "over" };
    case GiftState.Released:
      return { status: "Taken after the wait", tone: "over" };
    case GiftState.Cancelled:
      return { status: "Taken back", tone: "over" };
    case GiftState.Attested:
      return {
        status: g.sending ? "Ready for them" : "Ready to take",
        tone: "good",
      };
    case GiftState.Pending: {
      if (g.conditionType === ConditionType.Time) {
        return nowSeconds >= Number(g.releaseTime)
          ? {
              status: g.sending ? "Ready for them" : "Ready to take",
              tone: "good",
            }
          : { status: "Waiting for the date", tone: "progress" };
      }
      return { status: "Waiting to be confirmed", tone: "progress" };
    }
    default:
      return { status: "Unknown", tone: "over" };
  }
}

export type GiftAction =
  /** The recipient can take it now. */
  | "claim"
  /** The giver can take it back: still pending, and not a firm promise. */
  | "cancel"
  /** The named person can confirm the thing happened. */
  | "confirm"
  /** Nobody confirmed and the wait ran out; the recipient may take it. */
  | "release"
  | null;

/**
 * The one thing this person can do about this gift right now.
 *
 * `me` is a parameter rather than a hook read, so this stays pure and the list
 * and the detail screen cannot come to different answers.
 */
export function pendingAction(
  g: GiftView,
  me: `0x${string}` | undefined,
  nowSeconds: number
): GiftAction {
  if (!me) return null;
  const mine = me.toLowerCase();
  const isRecipient = g.recipient.toLowerCase() === mine;
  const isSender = g.sender.toLowerCase() === mine;
  const isAttester = g.attester.toLowerCase() === mine;

  if (g.state === GiftState.Attested) return isRecipient ? "claim" : null;
  if (g.state !== GiftState.Pending) return null;

  // A time gift unlocks itself: once the date passes the recipient simply
  // takes it, and nobody has to be asked.
  if (g.conditionType === ConditionType.Time) {
    if (isRecipient && nowSeconds >= Number(g.releaseTime)) return "claim";
    return isSender && !g.irrevocable ? "cancel" : null;
  }

  if (isAttester && !isSender) return "confirm";

  // The escape hatch: if the confirmer never acts, the money is not stuck
  // forever — after the timeout the recipient can take it anyway.
  if (isRecipient && nowSeconds >= Number(g.timeoutAt)) return "release";

  return isSender && !g.irrevocable ? "cancel" : null;
}

/** How long until the recipient could take it without anybody confirming. */
export function secondsUntilTimeout(g: Gift, nowSeconds: number): number {
  const left = Number(g.timeoutAt) - nowSeconds;
  return left > 0 ? left : 0;
}

/** "in 3 days", "tomorrow" — a wait a person reads. The clock is a param. */
export function waitLabel(seconds: number): string {
  if (seconds <= 0) return "now";
  const days = Math.floor(seconds / 86_400);
  if (days >= 2) return `in ${days} days`;
  if (days === 1) return "tomorrow";
  const hours = Math.floor(seconds / 3_600);
  if (hours >= 2) return `in ${hours} hours`;
  return "within the hour";
}

/** "22 Oct 2026" — a date, with no clock read inside. */
export function dayLabel(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/* ═══════════════════════════ the offchain half ═══════════════════════════ */

/**
 * Where a gift's message lives.
 *
 * The contract stores a hash of the condition and nothing else, which is
 * right: "here is your share when the company exits" is nobody else's
 * business and should not sit in public forever. So the words go in the same
 * offchain store the repayment memos use, under a key derived from the gift's
 * id — there is nothing on the chain to recover the text from, so the id is
 * the only stable handle a later page load has.
 */
export function giftMessageKey(giftId: number): `0x${string}` {
  return `0x${giftId.toString(16).padStart(64, "0")}` as `0x${string}`;
}

/** The plainest reading of a gift, for a list row. */
export function giftTitle(g: GiftView): string {
  return g.message.trim() || "A gift";
}

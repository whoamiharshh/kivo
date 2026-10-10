/**
 * Pay a person — the types and the state logic, with no client dependency.
 *
 * ──────────────── why this is a separate file ────────────────
 *
 * `pay.ts` carries "use client" because it holds React Query hooks and a wagmi
 * client. That directive applies to the whole module, so everything exported
 * from it — including a pure function that only reads a number and returns a
 * string — becomes a client export. A Server Component calling one gets:
 *
 *   Attempted to call pendingAction() from the server but pendingAction is on
 *   the client.
 *
 * which is exactly what happened the first time the list screen rendered. The
 * fix is not to make the screen a Client Component — that would ship the whole
 * list to the browser for no reason. It is to put the parts that have no
 * client dependency somewhere both sides can import.
 *
 * So: enums, shapes and pure functions here; hooks and contract calls in
 * `pay.ts`, which re-exports these for client code that wants one import.
 */

/** Mirrors SocialPay.State. Index matters: it is the on-chain enum. */
export const PayState = {
  None: 0,
  Held: 1,
  Claimable: 2,
  Confirmed: 3,
  Claimed: 4,
  Reclaimed: 5,
  Disputed: 6,
  Resolved: 7,
} as const;
export type PayStateValue = (typeof PayState)[keyof typeof PayState];

/** Mirrors SocialPay.Payment. Amounts are paise; times are unix seconds. */
export type Payment = {
  sender: `0x${string}`;
  /** Zero for a claimable payment nobody has claimed yet. */
  recipient: `0x${string}`;
  amount: bigint;
  memoHash: `0x${string}`;
  /** Zero for a direct payment. */
  claimHash: `0x${string}`;
  createdAt: bigint;
  /** End of the confirmation window, or the claim expiry. */
  deadline: bigint;
  state: PayStateValue;
};

/** A payment plus everything the UI needs that is not on the chain. */
export type PaymentView = Payment & {
  id: number;
  /** True when the signed-in person sent it. Decides every label on screen. */
  outgoing: boolean;
  /** The other party's display name, or a shortened address as a fallback. */
  otherName: string;
  otherAddress: `0x${string}`;
  /** Memo text, recovered from Supabase by its hash. Empty if never saved. */
  memo: string;
};

/** The contract's own bounds, so the UI cannot offer an invalid window. */
export const MIN_CONFIRM_WINDOW_SECONDS = 60 * 60; // 1 hour
export const MAX_CONFIRM_WINDOW_SECONDS = 30 * 24 * 60 * 60; // 30 days

/** 0x1234…abcd, for the rare case where somebody has no saved name. */
export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * The word and tone for a state, from the signed-in person's point of view.
 *
 * The same `Held` state reads completely differently depending on which side
 * you are on: the sender is waiting, the recipient owes an answer. One state,
 * two sentences, and getting this backwards is how a payments screen makes
 * somebody pay twice.
 */
export function describe(
  p: PaymentView,
  /** Needed to tell "still waiting" from "the window has closed". Omit it and
   *  a held payment always reads as waiting, which is wrong once it expires. */
  nowSeconds?: number
): {
  status: string;
  tone: "progress" | "good" | "attention" | "over";
} {
  switch (p.state) {
    case PayState.Held: {
      if (!p.outgoing) return { status: "Waiting on you", tone: "attention" };
      // Expired and outgoing: the money is the sender's to take back, and
      // saying "waiting on them" here would be a lie — they can no longer act.
      const expired =
        nowSeconds !== undefined && nowSeconds >= Number(p.deadline);
      return expired
        ? { status: "Take it back", tone: "attention" }
        : { status: "Waiting on them", tone: "progress" };
    }
    case PayState.Claimable:
      return { status: "Not claimed yet", tone: "progress" };
    case PayState.Confirmed:
    case PayState.Claimed:
      return { status: p.outgoing ? "Sent" : "Received", tone: "good" };
    case PayState.Reclaimed:
      return { status: "Returned to you", tone: "over" };
    case PayState.Disputed:
      return { status: "On hold", tone: "attention" };
    case PayState.Resolved:
      return { status: "Settled", tone: "over" };
    default:
      return { status: "Unknown", tone: "over" };
  }
}

/**
 * What this person can do about this payment right now, if anything.
 *
 * `nowSeconds` is a parameter rather than a call to the clock so the same
 * input always produces the same answer — a server render and the browser
 * render that follows it must agree, or the row flickers on hydration.
 */
export function pendingAction(
  p: PaymentView,
  nowSeconds: number
): "confirm" | "reclaim" | null {
  if (p.state === PayState.Held && !p.outgoing) return "confirm";
  if (
    p.state === PayState.Held &&
    p.outgoing &&
    nowSeconds >= Number(p.deadline)
  ) {
    return "reclaim";
  }
  return null;
}

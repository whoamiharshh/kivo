import type { PaymentView } from "@/lib/features/pay-state";
import { PayState } from "@/lib/features/pay-state";
import { PaymentList } from "@/components/feature/pay/payment-list";
import { ActionButton, StickyAction } from "@/components/feature/action-button";

/**
 * /preview/pay — the "Pay a person" list screen, with sample rows.
 *
 * The clock is frozen at a fixed instant rather than read from `Date.now()`.
 * Two reasons, both practical: a screenshot taken twice should look the same,
 * and a server-rendered "3 hours to accept" that disagrees with the browser's
 * idea of now is a hydration mismatch.
 *
 * The rows are chosen to show every state the screen has to handle at once —
 * one waiting on you, one waiting on them, one expired and reclaimable, one
 * settled, one returned, one frozen — because a list screen that has only ever
 * been seen with happy rows is a list screen whose edge cases are untested.
 */

/** A fixed instant, so this page is deterministic. */
const NOW = 1_791_650_000;
const HOUR = 3600;
const DAY = 24 * HOUR;

const addr = (n: number) =>
  `0x${n.toString(16).padStart(40, "0")}` as `0x${string}`;

const ZERO_HASH = `0x${"0".repeat(64)}` as `0x${string}`;

const base = {
  sender: addr(1),
  recipient: addr(2),
  memoHash: ZERO_HASH,
  claimHash: ZERO_HASH,
} as const;

const SAMPLES: PaymentView[] = [
  {
    ...base,
    id: 6,
    amount: 45000n, // ₹450
    createdAt: BigInt(NOW - 2 * HOUR),
    deadline: BigInt(NOW + 22 * HOUR),
    state: PayState.Held,
    outgoing: false,
    otherName: "Priya",
    otherAddress: addr(3),
    memo: "Auto to the station",
  },
  {
    ...base,
    id: 5,
    amount: 120000n, // ₹1,200
    createdAt: BigInt(NOW - 3 * DAY),
    deadline: BigInt(NOW - HOUR),
    state: PayState.Held,
    outgoing: true,
    otherName: "Aman",
    otherAddress: addr(4),
    memo: "",
  },
  {
    ...base,
    id: 4,
    amount: 80000n, // ₹800
    createdAt: BigInt(NOW - 6 * HOUR),
    deadline: BigInt(NOW + 2 * DAY),
    state: PayState.Held,
    outgoing: true,
    otherName: "Rahul",
    otherAddress: addr(5),
    memo: "Cab to the airport",
  },
  {
    ...base,
    id: 3,
    amount: 250000n, // ₹2,500
    createdAt: BigInt(NOW - 5 * DAY),
    deadline: BigInt(NOW - 4 * DAY),
    state: PayState.Confirmed,
    outgoing: false,
    otherName: "Sneha",
    otherAddress: addr(6),
    memo: "Hostel groceries, my half",
  },
  {
    ...base,
    id: 2,
    amount: 60000n, // ₹600
    createdAt: BigInt(NOW - 9 * DAY),
    deadline: BigInt(NOW - 8 * DAY),
    state: PayState.Reclaimed,
    outgoing: true,
    otherName: "Vikram",
    otherAddress: addr(7),
    memo: "",
  },
  {
    ...base,
    id: 1,
    amount: 150000n, // ₹1,500
    createdAt: BigInt(NOW - 12 * DAY),
    deadline: BigInt(NOW - 11 * DAY),
    state: PayState.Disputed,
    outgoing: true,
    otherName: "Kabir",
    otherAddress: addr(8),
    memo: "",
  },
];

export default function PreviewPayPage() {
  return (
    <>
      <header className="mb-5">
        <h1 className="text-h1 text-foreground">Payments</h1>
        <p className="mt-1 text-body text-muted-foreground">
          Money you send waits until the other person says they got it.
        </p>
      </header>

      <PaymentList
        payments={SAMPLES}
        nowSeconds={NOW}
        basePath="/preview/pay"
      />

      <StickyAction>
        <ActionButton>Send money</ActionButton>
      </StickyAction>
    </>
  );
}

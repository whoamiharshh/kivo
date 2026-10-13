import { describe, expect, it } from "vitest";
import {
  deriveStateFeed,
  memberAddressForEvent,
  spendIdAt,
  toFeedItem,
  type IndexedPotEvent,
  type PotStateSnapshot,
} from "./activity";

const MEMBER = "0x1111111111111111111111111111111111111111" as const;

function deposit(
  transactionHash: `0x${string}`,
  logIndex: number,
  amount: string,
  blockTimestamp: string
): IndexedPotEvent {
  return {
    eventName: "Deposited",
    args: { potId: "5", member: MEMBER, amount },
    blockNumber: String(70_000_000 + logIndex),
    blockTimestamp,
    transactionHash,
    logIndex,
  };
}

describe("indexed Pot activity", () => {
  it("preserves separate deposits and their canonical identifiers", () => {
    const first = toFeedItem(
      deposit(
        `0x${"a".repeat(64)}`,
        2,
        "12000",
        "2026-10-12T10:00:00.000Z"
      )
    );
    const second = toFeedItem(
      deposit(
        `0x${"b".repeat(64)}`,
        3,
        "3400",
        "2026-10-12T10:30:00.000Z"
      )
    );

    expect(first.key).not.toBe(second.key);
    expect(first.amount).toBe(12_000n);
    expect(second.amount).toBe(3_400n);
    expect(first.occurredAt).toBe("2026-10-12T10:00:00.000Z");
    expect(second.transactionHash).toBe(`0x${"b".repeat(64)}`);
  });

  it("maps approvals and refunds from their own finalized logs", () => {
    const approved = toFeedItem({
      eventName: "SpendApproved",
      args: { potId: "5", spendId: "3", approver: MEMBER },
      blockNumber: "70000001",
      blockTimestamp: "2026-10-12T11:00:00.000Z",
      transactionHash: `0x${"c".repeat(64)}`,
      logIndex: 4,
    });
    const refunded = toFeedItem({
      eventName: "Refunded",
      args: { potId: "5", member: MEMBER, amount: "6400" },
      blockNumber: "70000002",
      blockTimestamp: "2026-10-12T11:10:00.000Z",
      transactionHash: `0x${"d".repeat(64)}`,
      logIndex: 1,
    });

    expect(approved).toMatchObject({
      kind: "approved",
      actor: MEMBER,
      spendId: 3,
      occurredAt: "2026-10-12T11:00:00.000Z",
    });
    expect(refunded).toMatchObject({
      kind: "refunded",
      actor: MEMBER,
      amount: 6_400n,
      occurredAt: "2026-10-12T11:10:00.000Z",
      transactionHash: `0x${"d".repeat(64)}`,
    });
  });

  it("indexes only explicit pot creation and membership events", () => {
    expect(memberAddressForEvent("PotCreated", { creator: MEMBER })).toBe(MEMBER);
    expect(memberAddressForEvent("MemberJoined", { member: MEMBER })).toBe(MEMBER);
    expect(memberAddressForEvent("Deposited", { member: MEMBER })).toBeUndefined();
    expect(
      memberAddressForEvent("MemberJoined", { member: "not-an-address" })
    ).toBeUndefined();
  });
});
const CREATOR = "0x2222222222222222222222222222222222222222" as const;
const FRIEND = "0x3333333333333333333333333333333333333333" as const;
const ZERO_HASH = `0x${"0".repeat(64)}` as const;

function snapshot(overrides: Partial<PotStateSnapshot> = {}): PotStateSnapshot {
  return {
    creator: CREATOR,
    state: 1,
    targetAmount: 100_000n,
    totalContributed: 100_000n,
    members: [
      { address: CREATOR, contributed: 60_000n, refundClaimed: false },
      { address: FRIEND, contributed: 40_000n, refundClaimed: false },
    ],
    spends: [],
    ...overrides,
  };
}

function spend(overrides: Partial<PotStateSnapshot["spends"][number]> = {}) {
  return {
    requester: FRIEND,
    to: CREATOR,
    amount: 25_000n,
    memoHash: ZERO_HASH,
    executed: false,
    cancelled: false,
    ...overrides,
  };
}

describe("repayment numbering", () => {
  // PotManager does `spendId = ++spendCount`, so the first repayment is #1 and
  // `getSpend(potId, 0)` is an empty struct. Reading from 0 shows a phantom
  // request, drops the newest one, and sends the wrong id to approve/cancel.
  it("numbers repayments from 1, matching the contract", () => {
    expect(spendIdAt(0)).toBe(1);
    expect(spendIdAt(4)).toBe(5);
  });

  it("gives the feed real repayment ids, never 0", () => {
    const feed = deriveStateFeed(
      snapshot({
        spends: [spend({ executed: true }), spend({ amount: 9_000n })],
      })
    );
    const requested = feed.filter((i) => i.kind === "requested");

    expect(requested.map((i) => i.spendId).sort()).toEqual([1, 2]);
    expect(feed.some((i) => i.spendId === 0)).toBe(false);
  });

  it("ties a payout and a still-waiting request to the right id", () => {
    const feed = deriveStateFeed(
      snapshot({
        spends: [spend({ executed: true }), spend({ amount: 9_000n })],
      })
    );

    expect(feed.find((i) => i.kind === "paid")?.spendId).toBe(1);
    const waiting = feed.find((i) => i.kind === "requested" && i.needsApproval);
    expect(waiting?.spendId).toBe(2);
    expect(waiting?.amount).toBe(9_000n);
  });

  it("marks a withdrawn request as cancelled, not waiting", () => {
    const feed = deriveStateFeed(snapshot({ spends: [spend({ cancelled: true })] }));

    expect(feed.find((i) => i.kind === "cancelled")?.spendId).toBe(1);
    expect(feed.find((i) => i.kind === "requested")?.needsApproval).toBeUndefined();
  });
});

describe("state-derived pot feed", () => {
  it("is just a creation entry for a pot nobody has touched", () => {
    const feed = deriveStateFeed(
      snapshot({
        state: 0,
        totalContributed: 0n,
        members: [{ address: CREATOR, contributed: 0n, refundClaimed: false }],
      })
    );

    expect(feed.map((i) => i.kind)).toEqual(["created"]);
  });

  it("lists the creator once and gives each contributor one total", () => {
    const feed = deriveStateFeed(snapshot());

    expect(feed.filter((i) => i.kind === "joined")).toHaveLength(1);
    const added = feed.filter((i) => i.kind === "added");
    expect(added.map((i) => i.amount).sort()).toEqual([40_000n, 60_000n]);
  });

  it("reports a pot that missed its target and who took their money back", () => {
    const feed = deriveStateFeed(
      snapshot({
        state: 2,
        members: [
          { address: CREATOR, contributed: 60_000n, refundClaimed: true },
          { address: FRIEND, contributed: 40_000n, refundClaimed: false },
        ],
      })
    );

    expect(feed.some((i) => i.kind === "refunding")).toBe(true);
    expect(feed.filter((i) => i.kind === "refunded").map((i) => i.actor)).toEqual([
      CREATOR,
    ]);
  });

  it("puts the newest entry first and the creation last", () => {
    const feed = deriveStateFeed(snapshot({ state: 3 }));

    expect(feed[0].kind).toBe("closed");
    expect(feed[feed.length - 1].kind).toBe("created");
  });

  it("never claims a time or transaction it cannot know", () => {
    const feed = deriveStateFeed(snapshot({ spends: [spend()] }));

    for (const item of feed) {
      expect(item.occurredAt).toBeNull();
      expect(item.transactionHash).toBeNull();
    }
  });
});

export type PotEventName =
  | "PotCreated"
  | "MemberJoined"
  | "Deposited"
  | "PotFunded"
  | "RefundingStarted"
  | "SpendRequested"
  | "SpendApproved"
  | "SpendCancelled"
  | "SpendExecuted"
  | "PotClosed"
  | "Refunded";

export type IndexedPotEvent = {
  eventName: PotEventName;
  args: Record<string, string | boolean>;
  blockNumber: string;
  blockTimestamp: string;
  transactionHash: `0x${string}`;
  logIndex: number;
};

export type FeedKind =
  | "created"
  | "joined"
  | "added"
  | "funded"
  | "refunding"
  | "requested"
  | "approved"
  | "cancelled"
  | "paid"
  | "closed"
  | "refunded";

export type FeedItem = {
  key: string;
  kind: FeedKind;
  /** Null when the entry is read from contract state, which has no clock. */
  occurredAt: string | null;
  /** Null for the same reason: state has no transaction behind it. */
  transactionHash: `0x${string}` | null;
  actor?: `0x${string}`;
  to?: `0x${string}`;
  amount?: bigint;
  spendId?: number;
  memoHash?: `0x${string}`;
  memo?: string | null;
  needsApproval?: boolean;
};

function textArg(args: IndexedPotEvent["args"], key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" ? value : undefined;
}

function amountArg(args: IndexedPotEvent["args"], key: string): bigint | undefined {
  const value = textArg(args, key);
  return value && /^[0-9]+$/.test(value) ? BigInt(value) : undefined;
}

function addressArg(
  args: IndexedPotEvent["args"],
  key: string
): `0x${string}` | undefined {
  const value = textArg(args, key);
  return value && /^0x[0-9a-fA-F]{40}$/.test(value)
    ? (value as `0x${string}`)
    : undefined;
}

export function memberAddressForEvent(
  eventName: PotEventName,
  args: Record<string, string | boolean>
): `0x${string}` | undefined {
  if (eventName === "PotCreated") return addressArg(args, "creator");
  if (eventName === "MemberJoined") return addressArg(args, "member");
  return undefined;
}

function spendIdArg(args: IndexedPotEvent["args"]): number | undefined {
  const value = amountArg(args, "spendId");
  if (value === undefined || value > BigInt(Number.MAX_SAFE_INTEGER)) return;
  return Number(value);
}

export function toFeedItem(event: IndexedPotEvent): FeedItem {
  const base = {
    key: `${event.transactionHash.toLowerCase()}-${event.logIndex}`,
    occurredAt: event.blockTimestamp,
    transactionHash: event.transactionHash,
  };
  const args = event.args;

  switch (event.eventName) {
    case "PotCreated":
      return {
        ...base,
        kind: "created",
        actor: addressArg(args, "creator"),
        amount: amountArg(args, "targetAmount"),
      };
    case "MemberJoined":
      return { ...base, kind: "joined", actor: addressArg(args, "member") };
    case "Deposited":
      return {
        ...base,
        kind: "added",
        actor: addressArg(args, "member"),
        amount: amountArg(args, "amount"),
      };
    case "PotFunded":
      return {
        ...base,
        kind: "funded",
        amount: amountArg(args, "totalContributed"),
      };
    case "RefundingStarted":
      return {
        ...base,
        kind: "refunding",
        amount: amountArg(args, "refundableTotal"),
      };
    case "SpendRequested":
      return {
        ...base,
        kind: "requested",
        actor: addressArg(args, "requester"),
        to: addressArg(args, "to"),
        amount: amountArg(args, "amount"),
        spendId: spendIdArg(args),
        memoHash: addresslessHash(args, "memoHash"),
        needsApproval:
          typeof args.needsApproval === "boolean" ? args.needsApproval : undefined,
      };
    case "SpendApproved":
      return {
        ...base,
        kind: "approved",
        actor: addressArg(args, "approver"),
        spendId: spendIdArg(args),
      };
    case "SpendCancelled":
      return {
        ...base,
        kind: "cancelled",
        actor: addressArg(args, "by"),
        spendId: spendIdArg(args),
      };
    case "SpendExecuted":
      return {
        ...base,
        kind: "paid",
        to: addressArg(args, "to"),
        amount: amountArg(args, "amount"),
        spendId: spendIdArg(args),
      };
    case "PotClosed":
      return {
        ...base,
        kind: "closed",
        amount: amountArg(args, "refundedTotal"),
      };
    case "Refunded":
      return {
        ...base,
        kind: "refunded",
        actor: addressArg(args, "member"),
        amount: amountArg(args, "amount"),
      };
  }
}

function addresslessHash(
  args: IndexedPotEvent["args"],
  key: string
): `0x${string}` | undefined {
  const value = textArg(args, key);
  return value && /^0x[0-9a-fA-F]{64}$/.test(value)
    ? (value as `0x${string}`)
    : undefined;
}
/**
 * PotManager numbers a pot's repayments from 1 (`spendId = ++spendCount`), so
 * repayment N lives at `getSpend(potId, N)` and `getSpend(potId, 0)` is empty.
 * Anything that walks repayments by position must go through this, never use
 * the array index as the ID.
 */
export function spendIdAt(index: number): number {
  return index + 1;
}

/** What the contract's own views say about one pot. No logs are involved. */
export type PotStateSnapshot = {
  creator: `0x${string}`;
  /** PotManager.PotState: 0 collecting, 1 funded, 2 refunding, 3 closed. */
  state: number;
  targetAmount: bigint;
  totalContributed: bigint;
  members: {
    address: `0x${string}`;
    contributed: bigint;
    refundClaimed: boolean;
  }[];
  spends: {
    requester: `0x${string}`;
    to: `0x${string}`;
    amount: bigint;
    memoHash: `0x${string}`;
    executed: boolean;
    cancelled: boolean;
  }[];
};

/**
 * The pot's history rebuilt from current contract state, newest first.
 *
 * This is what the demo shows instead of an event log. It needs no database,
 * no indexer and no log range, so it cannot fall behind or hit a provider's
 * log limit. The price is detail the state does not keep: no timestamps, no
 * separate deposits (one total per person), and no record of who approved a
 * repayment. Members are listed in join order; the order of events across
 * different kinds is therefore approximate.
 */
export function deriveStateFeed(snapshot: PotStateSnapshot): FeedItem[] {
  const none = { occurredAt: null, transactionHash: null } as const;
  const items: FeedItem[] = [
    {
      ...none,
      key: "created",
      kind: "created",
      actor: snapshot.creator,
      amount: snapshot.targetAmount,
    },
  ];

  for (const member of snapshot.members) {
    if (member.address.toLowerCase() !== snapshot.creator.toLowerCase()) {
      items.push({
        ...none,
        key: `joined-${member.address}`,
        kind: "joined",
        actor: member.address,
      });
    }
    if (member.contributed > 0n) {
      items.push({
        ...none,
        key: `added-${member.address}`,
        kind: "added",
        actor: member.address,
        amount: member.contributed,
      });
    }
  }

  if (snapshot.state === 1) {
    items.push({
      ...none,
      key: "funded",
      kind: "funded",
      amount: snapshot.totalContributed,
    });
  }
  if (snapshot.state === 2) {
    items.push({ ...none, key: "refunding", kind: "refunding" });
  }

  snapshot.spends.forEach((spend, index) => {
    const spendId = spendIdAt(index);
    const waiting = !spend.executed && !spend.cancelled;
    items.push({
      ...none,
      key: `requested-${spendId}`,
      kind: "requested",
      actor: spend.requester,
      to: spend.to,
      amount: spend.amount,
      spendId,
      memoHash: spend.memoHash,
      needsApproval: waiting ? true : undefined,
    });
    if (spend.executed) {
      items.push({
        ...none,
        key: `paid-${spendId}`,
        kind: "paid",
        to: spend.to,
        amount: spend.amount,
        spendId,
      });
    }
    if (spend.cancelled) {
      items.push({ ...none, key: `cancelled-${spendId}`, kind: "cancelled", spendId });
    }
  });

  for (const member of snapshot.members) {
    if (member.refundClaimed) {
      items.push({
        ...none,
        key: `refunded-${member.address}`,
        kind: "refunded",
        actor: member.address,
      });
    }
  }

  if (snapshot.state === 3) {
    items.push({ ...none, key: "closed", kind: "closed" });
  }

  return items.reverse();
}

"use client";

import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { parseAbiItem, type PublicClient } from "viem";
import {
  DEPLOY_BLOCK,
  POT_MANAGER_ADDRESS,
  TEST_RUPEE_ADDRESS,
  contractsConfigured,
  potManagerAbi,
  testRupeeAbi,
} from "./contracts";
import { loadDisplayNames, loadMemos, loadPotMeta, loadPotMetas } from "./store";
import { useAppWallet } from "./tx";

/** Mirrors PotManager.PotState. */
export const PotState = {
  Collecting: 0,
  Funded: 1,
  Refunding: 2,
  Closed: 3,
} as const;
export type PotStateValue = (typeof PotState)[keyof typeof PotState];

/** Mirrors PotManager.PotInfo — note there is no invite hash in here. */
export type Pot = {
  creator: `0x${string}`;
  approvalLimit: bigint;
  targetAmount: bigint;
  balance: bigint;
  /** Held by repayments waiting on approval — not spendable. */
  reserved: bigint;
  totalContributed: bigint;
  deadline: bigint;
  maxMembers: number;
  memberCount: number;
  spendCount: number;
  pendingSpendCount: number;
  refundsOutstanding: number;
  state: PotStateValue;
};

/**
 * The events the feed is built from, written out so their argument types flow
 * through getLogs. These match PotManager.sol exactly.
 */
const EVENTS = {
  MemberJoined: parseAbiItem(
    "event MemberJoined(uint256 indexed potId, address indexed member)"
  ),
  Deposited: parseAbiItem(
    "event Deposited(uint256 indexed potId, address indexed member, uint256 amount)"
  ),
  PotFunded: parseAbiItem(
    "event PotFunded(uint256 indexed potId, uint256 totalContributed)"
  ),
  RefundingStarted: parseAbiItem(
    "event RefundingStarted(uint256 indexed potId, uint256 refundableTotal)"
  ),
  SpendRequested: parseAbiItem(
    "event SpendRequested(uint256 indexed potId, uint256 indexed spendId, address indexed requester, address to, uint256 amount, bytes32 memoHash, bool needsApproval)"
  ),
  SpendApproved: parseAbiItem(
    "event SpendApproved(uint256 indexed potId, uint256 indexed spendId, address indexed approver)"
  ),
  SpendCancelled: parseAbiItem(
    "event SpendCancelled(uint256 indexed potId, uint256 indexed spendId, address indexed by)"
  ),
  SpendExecuted: parseAbiItem(
    "event SpendExecuted(uint256 indexed potId, uint256 indexed spendId, address indexed to, uint256 amount)"
  ),
  PotClosed: parseAbiItem(
    "event PotClosed(uint256 indexed potId, uint256 refundedTotal)"
  ),
  Refunded: parseAbiItem(
    "event Refunded(uint256 indexed potId, address indexed member, uint256 amount)"
  ),
} as const;

/** How much test money the person has, and whether the pot can already move it. */
export function useTestMoney() {
  const { address } = useAppWallet();
  const client = usePublicClient();

  return useQuery({
    queryKey: ["test-money", address],
    enabled: Boolean(address && client && contractsConfigured),
    refetchInterval: 8_000,
    queryFn: async () => {
      const c = client as PublicClient;
      const [balance, allowance, lastClaim] = await c.multicall({
        allowFailure: false,
        contracts: [
          {
            address: TEST_RUPEE_ADDRESS,
            abi: testRupeeAbi,
            functionName: "balanceOf",
            args: [address!],
          },
          {
            address: TEST_RUPEE_ADDRESS,
            abi: testRupeeAbi,
            functionName: "allowance",
            args: [address!, POT_MANAGER_ADDRESS],
          },
          {
            address: TEST_RUPEE_ADDRESS,
            abi: testRupeeAbi,
            functionName: "lastClaim",
            args: [address!],
          },
        ],
      });
      const last = lastClaim as bigint;
      const nextClaimAt = last === 0n ? 0n : last + 86_400n;
      return {
        balance: balance as bigint,
        allowance: allowance as bigint,
        nextClaimAt,
        canCollect:
          nextClaimAt === 0n ||
          BigInt(Math.floor(Date.now() / 1000)) >= nextClaimAt,
      };
    },
  });
}

/** Every pot this person has joined, newest first, with its offchain name. */
export function useMyPots() {
  const { address } = useAppWallet();
  const client = usePublicClient();

  return useQuery({
    queryKey: ["my-pots", address],
    enabled: Boolean(address && client && contractsConfigured),
    refetchInterval: 10_000,
    queryFn: async () => {
      const c = client as PublicClient;
      const joined = await c.getLogs({
        address: POT_MANAGER_ADDRESS,
        event: EVENTS.MemberJoined,
        args: { member: address! },
        fromBlock: DEPLOY_BLOCK,
        toBlock: "latest",
      });

      const ids = [
        ...new Set(
          joined.map((l) => Number((l.args as { potId: bigint }).potId))
        ),
      ].sort((a, b) => b - a);
      if (ids.length === 0) return [];

      const pots = (await c.multicall({
        allowFailure: false,
        contracts: ids.map((id) => ({
          address: POT_MANAGER_ADDRESS,
          abi: potManagerAbi,
          functionName: "getPot" as const,
          args: [BigInt(id)],
        })),
      })) as unknown as Pot[];

      const metas = await loadPotMetas(ids);

      return ids.map((id, i) => ({
        potId: id,
        pot: pots[i],
        name: metas[id]?.name ?? `Pot #${id}`,
        perPersonPaise: BigInt(metas[id]?.perPersonPaise ?? "0"),
      }));
    },
  });
}

/** One pot: its state, who is in it, what each person put in, what you can claim. */
export function usePot(potId: number | undefined) {
  const client = usePublicClient();
  const { address } = useAppWallet();

  return useQuery({
    queryKey: ["pot", potId, address],
    enabled: Boolean(potId && client && contractsConfigured),
    refetchInterval: 6_000,
    queryFn: async () => {
      const c = client as PublicClient;
      const id = BigInt(potId!);

      const [pot, members] = (await c.multicall({
        allowFailure: false,
        contracts: [
          {
            address: POT_MANAGER_ADDRESS,
            abi: potManagerAbi,
            functionName: "getPot",
            args: [id],
          },
          {
            address: POT_MANAGER_ADDRESS,
            abi: potManagerAbi,
            functionName: "getMembers",
            args: [id],
          },
        ],
      })) as unknown as [Pot, `0x${string}`[]];

      const contributions =
        members.length === 0
          ? []
          : ((await c.multicall({
              allowFailure: false,
              contracts: members.map((m) => ({
                address: POT_MANAGER_ADDRESS,
                abi: potManagerAbi,
                functionName: "contributed" as const,
                args: [id, m],
              })),
            })) as unknown as bigint[]);

      let myRefund = 0n;
      if (address && pot.state === PotState.Refunding) {
        myRefund = (await c.readContract({
          address: POT_MANAGER_ADDRESS,
          abi: potManagerAbi,
          functionName: "refundableOf",
          args: [id, address],
        })) as bigint;
      }

      // How much this person can still repay without anyone else approving.
      let myInstantRemaining = 0n;
      if (address && pot.state === PotState.Funded) {
        myInstantRemaining = (await c.readContract({
          address: POT_MANAGER_ADDRESS,
          abi: potManagerAbi,
          functionName: "instantRemaining",
          args: [id, address],
        })) as bigint;
      }

      const [names, meta] = await Promise.all([
        loadDisplayNames(members),
        loadPotMeta(potId!),
      ]);

      const remainingToTarget =
        pot.totalContributed >= pot.targetAmount
          ? 0n
          : pot.targetAmount - pot.totalContributed;

      return {
        potId: potId!,
        pot,
        name: meta?.name ?? `Pot #${potId}`,
        perPersonPaise: BigInt(meta?.perPersonPaise ?? "0"),
        inviteCode: meta?.inviteCode ?? null,
        remainingToTarget,
        myRefund,
        myInstantRemaining,
        /** Money not already held by a pending repayment. */
        available: pot.balance - pot.reserved,
        members: members.map((address, i) => ({
          address,
          contributed: contributions[i] ?? 0n,
          name: names[address.toLowerCase()] ?? null,
        })),
      };
    },
  });
}

export type FeedKind =
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
  blockNumber: bigint;
  logIndex: number;
  actor?: `0x${string}`;
  to?: `0x${string}`;
  amount?: bigint;
  spendId?: number;
  memo?: string | null;
  needsApproval?: boolean;
};

/** The activity feed, plus anything still waiting on an approval. Built from events. */
export function usePotActivity(potId: number | undefined) {
  const client = usePublicClient();

  return useQuery({
    queryKey: ["pot-activity", potId],
    enabled: Boolean(potId && client && contractsConfigured),
    refetchInterval: 6_000,
    queryFn: async () => {
      const c = client as PublicClient;
      const id = BigInt(potId!);
      const address = POT_MANAGER_ADDRESS;
      const fromBlock = DEPLOY_BLOCK;
      const toBlock = "latest" as const;
      const args = { potId: id };

      const [
        joined,
        added,
        funded,
        refunding,
        requested,
        approved,
        cancelled,
        paid,
        closed,
        refunded,
      ] = await Promise.all([
        c.getLogs({ address, fromBlock, toBlock, args, event: EVENTS.MemberJoined }),
        c.getLogs({ address, fromBlock, toBlock, args, event: EVENTS.Deposited }),
        c.getLogs({ address, fromBlock, toBlock, args, event: EVENTS.PotFunded }),
        c.getLogs({ address, fromBlock, toBlock, args, event: EVENTS.RefundingStarted }),
        c.getLogs({ address, fromBlock, toBlock, args, event: EVENTS.SpendRequested }),
        c.getLogs({ address, fromBlock, toBlock, args, event: EVENTS.SpendApproved }),
        c.getLogs({ address, fromBlock, toBlock, args, event: EVENTS.SpendCancelled }),
        c.getLogs({ address, fromBlock, toBlock, args, event: EVENTS.SpendExecuted }),
        c.getLogs({ address, fromBlock, toBlock, args, event: EVENTS.PotClosed }),
        c.getLogs({ address, fromBlock, toBlock, args, event: EVENTS.Refunded }),
      ]);

      const memoHashes = requested.map(
        (l) => (l.args as { memoHash: `0x${string}` }).memoHash
      );
      const addresses = [
        ...joined.map((l) => (l.args as { member: `0x${string}` }).member),
        ...added.map((l) => (l.args as { member: `0x${string}` }).member),
        ...requested.flatMap((l) => {
          const a = l.args as { requester: `0x${string}`; to: `0x${string}` };
          return [a.requester, a.to];
        }),
        ...approved.map((l) => (l.args as { approver: `0x${string}` }).approver),
        ...refunded.map((l) => (l.args as { member: `0x${string}` }).member),
      ];
      const [memos, names] = await Promise.all([
        loadMemos(memoHashes),
        loadDisplayNames(addresses),
      ]);

      const at = (l: {
        blockNumber: bigint | null;
        logIndex: number | null;
      }) => ({
        blockNumber: l.blockNumber ?? 0n,
        logIndex: l.logIndex ?? 0,
      });

      const items: FeedItem[] = [
        ...joined.map((l) => {
          const a = l.args as { member: `0x${string}` };
          return {
            key: `j-${l.transactionHash}-${l.logIndex}`,
            kind: "joined" as const,
            actor: a.member,
            ...at(l),
          };
        }),
        ...added.map((l) => {
          const a = l.args as { member: `0x${string}`; amount: bigint };
          return {
            key: `d-${l.transactionHash}-${l.logIndex}`,
            kind: "added" as const,
            actor: a.member,
            amount: a.amount,
            ...at(l),
          };
        }),
        ...funded.map((l) => {
          const a = l.args as { totalContributed: bigint };
          return {
            key: `g-${l.transactionHash}-${l.logIndex}`,
            kind: "funded" as const,
            amount: a.totalContributed,
            ...at(l),
          };
        }),
        ...refunding.map((l) => {
          const a = l.args as { refundableTotal: bigint };
          return {
            key: `n-${l.transactionHash}-${l.logIndex}`,
            kind: "refunding" as const,
            amount: a.refundableTotal,
            ...at(l),
          };
        }),
        ...requested.map((l) => {
          const a = l.args as {
            spendId: bigint;
            requester: `0x${string}`;
            to: `0x${string}`;
            amount: bigint;
            memoHash: `0x${string}`;
            needsApproval: boolean;
          };
          return {
            key: `r-${l.transactionHash}-${l.logIndex}`,
            kind: "requested" as const,
            actor: a.requester,
            to: a.to,
            amount: a.amount,
            spendId: Number(a.spendId),
            memo: memos[a.memoHash.toLowerCase()] ?? null,
            needsApproval: a.needsApproval,
            ...at(l),
          };
        }),
        ...approved.map((l) => {
          const a = l.args as { spendId: bigint; approver: `0x${string}` };
          return {
            key: `a-${l.transactionHash}-${l.logIndex}`,
            kind: "approved" as const,
            actor: a.approver,
            spendId: Number(a.spendId),
            ...at(l),
          };
        }),
        ...cancelled.map((l) => {
          const a = l.args as { spendId: bigint; by: `0x${string}` };
          return {
            key: `k-${l.transactionHash}-${l.logIndex}`,
            kind: "cancelled" as const,
            actor: a.by,
            spendId: Number(a.spendId),
            ...at(l),
          };
        }),
        ...paid.map((l) => {
          const a = l.args as {
            spendId: bigint;
            to: `0x${string}`;
            amount: bigint;
          };
          return {
            key: `x-${l.transactionHash}-${l.logIndex}`,
            kind: "paid" as const,
            to: a.to,
            amount: a.amount,
            spendId: Number(a.spendId),
            ...at(l),
          };
        }),
        ...closed.map((l) => {
          const a = l.args as { refundedTotal: bigint };
          return {
            key: `c-${l.transactionHash}-${l.logIndex}`,
            kind: "closed" as const,
            amount: a.refundedTotal,
            ...at(l),
          };
        }),
        ...refunded.map((l) => {
          const a = l.args as { member: `0x${string}`; amount: bigint };
          return {
            key: `f-${l.transactionHash}-${l.logIndex}`,
            kind: "refunded" as const,
            actor: a.member,
            amount: a.amount,
            ...at(l),
          };
        }),
      ].sort((a, b) =>
        a.blockNumber === b.blockNumber
          ? b.logIndex - a.logIndex
          : Number(b.blockNumber - a.blockNumber)
      );

      // Still waiting: requested, but neither paid out nor withdrawn.
      const settledIds = new Set<number>([
        ...paid.map((l) => Number((l.args as { spendId: bigint }).spendId)),
        ...cancelled.map((l) => Number((l.args as { spendId: bigint }).spendId)),
      ]);
      const pending = items
        .filter((i) => i.kind === "requested" && !settledIds.has(i.spendId!))
        .map((i) => ({
          spendId: i.spendId!,
          requester: i.actor!,
          to: i.to!,
          amount: i.amount!,
          memo: i.memo ?? null,
        }));

      return { items, pending, names };
    },
  });
}

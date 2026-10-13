"use client";

import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { type PublicClient } from "viem";
import {
  POT_MANAGER_ADDRESS,
  TEST_RUPEE_ADDRESS,
  contractsConfigured,
  potManagerAbi,
  testRupeeAbi,
} from "./contracts";
import { loadDisplayNames, loadMemos, loadPotMeta, loadPotMetas } from "./store";
import { useAppWallet } from "./tx";
import { deriveStateFeed, spendIdAt } from "./activity";

export type { FeedItem } from "./activity";

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

/** How much test money the person has, and whether the pot can already move it. */
export function useTestMoney() {
  const { address } = useAppWallet();
  const client = usePublicClient();

  return useQuery({
    queryKey: ["test-money", address],
    enabled: Boolean(address && client && contractsConfigured),
    refetchInterval: 24_000,
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

/**
 * Newest pots checked per refresh. The scan is one membership read per pot, so
 * the cost grows with the number of pots ever created. Fine for a demo, not
 * for a busy deployment; see docs/pot-discovery.md for the scaling path.
 */
const MAX_POTS_SCANNED = 200;

/** Every pot this account belongs to, newest first, read straight from the contract. */
export function useMyPots() {
  const { address } = useAppWallet();
  const client = usePublicClient();

  return useQuery({
    queryKey: ["my-pots", address],
    enabled: Boolean(address && client && contractsConfigured),
    refetchInterval: 30_000,
    queryFn: async () => {
      const c = client as PublicClient;
      const count = Number(
        (await c.readContract({
          address: POT_MANAGER_ADDRESS,
          abi: potManagerAbi,
          functionName: "potCount",
        })) as bigint
      );

      const candidates: number[] = [];
      for (let id = count; id >= Math.max(1, count - MAX_POTS_SCANNED + 1); id--) {
        candidates.push(id);
      }

      const ids: number[] = [];
      for (let offset = 0; offset < candidates.length; offset += 100) {
        const batch = candidates.slice(offset, offset + 100);
        const membership = (await c.multicall({
          allowFailure: false,
          contracts: batch.map((id) => ({
            address: POT_MANAGER_ADDRESS,
            abi: potManagerAbi,
            functionName: "isMember" as const,
            args: [BigInt(id), address as `0x${string}`],
          })),
        })) as boolean[];
        batch.forEach((id, i) => {
          if (membership[i]) ids.push(id);
        });
      }

      const potStates: Pot[] = [];
      for (let offset = 0; offset < ids.length; offset += 50) {
        const batch = ids.slice(offset, offset + 50);
        const result = (await c.multicall({
          allowFailure: false,
          contracts: batch.map((id) => ({
            address: POT_MANAGER_ADDRESS,
            abi: potManagerAbi,
            functionName: "getPot" as const,
            args: [BigInt(id)],
          })),
        })) as unknown as Pot[];
        potStates.push(...result);
      }

      const metas = await loadPotMetas(ids);
      return ids.map((id, i) => ({
        potId: id,
        pot: potStates[i],
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
    refetchInterval: 20_000,
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
              contracts: members.map((member) => ({
                address: POT_MANAGER_ADDRESS,
                abi: potManagerAbi,
                functionName: "contributed" as const,
                args: [id, member],
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
        available: pot.balance - pot.reserved,
        members: members.map((member, i) => ({
          address: member,
          contributed: contributions[i] ?? 0n,
          name: names[member.toLowerCase()] ?? null,
        })),
      };
    },
  });
}

/** Mirrors PotManager.Spend, as `getSpend` returns it. */
export type Spend = {
  requester: `0x${string}`;
  to: `0x${string}`;
  amount: bigint;
  memoHash: `0x${string}`;
  executed: boolean;
  cancelled: boolean;
};

/**
 * The pot's history, rebuilt from the contract's own views (see
 * `deriveStateFeed` for exactly what that does and does not include), plus the
 * repayments that are still waiting on someone.
 */
export function usePotActivity(potId: number | undefined) {
  const { address } = useAppWallet();
  const client = usePublicClient();
  const enabled = Boolean(potId !== undefined && address && client && contractsConfigured);

  return useQuery({
    queryKey: ["pot-activity", potId, address],
    enabled,
    refetchInterval: 20_000,
    queryFn: async () => {
      const c = client as PublicClient;
      const id = BigInt(potId!);

      const [pot, members] = (await c.multicall({
        allowFailure: false,
        contracts: [
          { address: POT_MANAGER_ADDRESS, abi: potManagerAbi, functionName: "getPot", args: [id] },
          { address: POT_MANAGER_ADDRESS, abi: potManagerAbi, functionName: "getMembers", args: [id] },
        ],
      })) as unknown as [Pot, `0x${string}`[]];

      // Repayments are numbered from 1, so walk 1..spendCount, not 0..spendCount-1.
      const spendIds = Array.from({ length: pot.spendCount }, (_, i) => spendIdAt(i));
      const [contributed, refundClaimed, spends] = await Promise.all([
        members.length
          ? (c.multicall({
              allowFailure: false,
              contracts: members.map((member) => ({
                address: POT_MANAGER_ADDRESS,
                abi: potManagerAbi,
                functionName: "contributed" as const,
                args: [id, member],
              })),
            }) as unknown as Promise<bigint[]>)
          : Promise.resolve([] as bigint[]),
        members.length
          ? (c.multicall({
              allowFailure: false,
              contracts: members.map((member) => ({
                address: POT_MANAGER_ADDRESS,
                abi: potManagerAbi,
                functionName: "refundClaimed" as const,
                args: [id, member],
              })),
            }) as unknown as Promise<boolean[]>)
          : Promise.resolve([] as boolean[]),
        spendIds.length
          ? (c.multicall({
              allowFailure: false,
              contracts: spendIds.map((spendId) => ({
                address: POT_MANAGER_ADDRESS,
                abi: potManagerAbi,
                functionName: "getSpend" as const,
                args: [id, BigInt(spendId)],
              })),
            }) as unknown as Promise<Spend[]>)
          : Promise.resolve([] as Spend[]),
      ]);

      const feed = deriveStateFeed({
        creator: pot.creator,
        state: pot.state,
        targetAmount: pot.targetAmount,
        totalContributed: pot.totalContributed,
        members: members.map((member, i) => ({
          address: member,
          contributed: contributed[i] ?? 0n,
          refundClaimed: refundClaimed[i] ?? false,
        })),
        spends,
      });

      const addresses = [
        ...new Set([
          ...members,
          ...feed.flatMap((item) =>
            [item.actor, item.to].filter((v): v is `0x${string}` => Boolean(v))
          ),
        ]),
      ];
      const [memos, names] = await Promise.all([
        loadMemos(spends.map((spend) => spend.memoHash)),
        loadDisplayNames(addresses),
      ]);

      const items = feed.map((item) => ({
        ...item,
        memo: item.memoHash ? memos[item.memoHash.toLowerCase()] ?? null : null,
      }));
      const pending = spends.flatMap((spend, index) =>
        !spend.executed && !spend.cancelled
          ? [
              {
                spendId: spendIdAt(index),
                requester: spend.requester,
                to: spend.to,
                amount: spend.amount,
                memo: memos[spend.memoHash.toLowerCase()] ?? null,
              },
            ]
          : []
      );

      return { items, pending, names };
    },
  });
}

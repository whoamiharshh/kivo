"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  keccak256,
  maxUint256,
  parseEventLogs,
  stringToHex,
  toHex,
  zeroHash,
} from "viem";
import {
  POT_MANAGER_ADDRESS,
  TEST_RUPEE_ADDRESS,
  potManagerAbi,
  testRupeeAbi,
} from "./contracts";
import { saveDisplayName, saveMemo, savePotMeta } from "./store";
import { authorizeJoin } from "./trust/client";
import { usePrivy } from "@privy-io/react-auth";
import { useAppWallet, useSponsoredCall } from "./tx";

/** A fresh invite code. It goes in the link; only its hash goes onchain. */
export function newInviteCode(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

/** inviteHash = keccak256(abi.encodePacked(inviteCode)) — the 32 raw bytes. */
export function hashInviteCode(code: `0x${string}`): `0x${string}` {
  return keccak256(code);
}

/** Memo text stays offchain; only this hash is stored onchain. */
export function hashMemo(memo: string): `0x${string}` {
  const trimmed = memo.trim();
  return trimmed ? keccak256(stringToHex(trimmed)) : zeroHash;
}

function useRefresh() {
  const qc = useQueryClient();
  return (potId?: number) => {
    void qc.invalidateQueries({ queryKey: ["test-money"] });
    void qc.invalidateQueries({ queryKey: ["my-pots"] });
    if (potId !== undefined) {
      void qc.invalidateQueries({ queryKey: ["pot", potId] });
      void qc.invalidateQueries({ queryKey: ["pot-activity", potId] });
    }
  };
}

/** "Get ₹5,000 test money" */
export function useCollectTestMoney() {
  const call = useSponsoredCall();
  const refresh = useRefresh();

  return useMutation({
    mutationFn: async () => {
      await call({
        address: TEST_RUPEE_ADDRESS,
        abi: testRupeeAbi,
        functionName: "faucet",
      });
    },
    onSuccess: () => refresh(),
  });
}

/** Save the name people see next to your share of a pot. */
export function useSetMyName() {
  const { address } = useAppWallet();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (name: string) => {
      if (!address) throw new Error("Still setting up your account.");
      await saveDisplayName(address, name.trim());
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["pot"] });
      void qc.invalidateQueries({ queryKey: ["pot-activity"] });
    },
  });
}

export type CreatePotInput = {
  name: string;
  /** What the group is collecting. The real target, not a display hint. */
  targetPaise: bigint;
  /** Suggested share per person — shown in the UI, never used as the target. */
  perPersonPaise: bigint;
  approvalLimitPaise: bigint;
  maxMembers: number;
  /** Unix seconds. Money can go in strictly before this. */
  deadline: bigint;
  myName: string;
};

/** Makes the pot, then remembers its name and invite code offchain. */
export function useCreatePot() {
  const call = useSponsoredCall();
  const { address } = useAppWallet();
  const { user } = usePrivy();
  const refresh = useRefresh();
  // Stamped on the stored invite code so that a creator-scoped read can find
  // its own row later. Not used for any access decision today: the server
  // reads that table with the service key.
  const did = user?.id ?? null;

  return useMutation({
    mutationFn: async (input: CreatePotInput) => {
      const inviteCode = newInviteCode();
      const receipt = await call({
        address: POT_MANAGER_ADDRESS,
        abi: potManagerAbi,
        functionName: "createPot",
        args: [
          hashInviteCode(inviteCode),
          input.approvalLimitPaise,
          input.maxMembers,
          input.targetPaise,
          input.deadline,
        ],
      });

      const events = parseEventLogs({
        abi: potManagerAbi,
        eventName: "PotCreated",
        logs: receipt.logs,
      });
      const created = events[0];
      if (!created) {
        throw new Error("The pot was made but we couldn't read it back.");
      }
      const potId = Number((created.args as { potId: bigint }).potId);

      await savePotMeta({
        potId,
        name: input.name.trim(),
        perPersonPaise: input.perPersonPaise.toString(),
        inviteCode,
        creatorDid: did,
      });
      if (address && input.myName.trim()) {
        await saveDisplayName(address, input.myName.trim());
      }

      return { potId, inviteCode };
    },
    onSuccess: ({ potId }) => refresh(potId),
  });
}

/** Join from an invite link. */
export function useJoinPot() {
  const call = useSponsoredCall();
  const { address } = useAppWallet();
  const refresh = useRefresh();

  return useMutation({
    mutationFn: async (input: {
      potId: number;
      inviteCode: `0x${string}`;
      myName: string;
    }) => {
      // The code alone no longer gets anybody in. The server checks it
      // against its own private copy and signs a short-lived authorization
      // for this exact wallet; the contract wants both. See
      // docs/security-audit.md, C-1.
      const { expiry, signature } = await authorizeJoin(
        input.potId,
        input.inviteCode
      );

      await call({
        address: POT_MANAGER_ADDRESS,
        abi: potManagerAbi,
        functionName: "join",
        args: [BigInt(input.potId), input.inviteCode, BigInt(expiry), signature],
      });
      if (address && input.myName.trim()) {
        await saveDisplayName(address, input.myName.trim());
      }
      return input.potId;
    },
    onSuccess: (potId) => refresh(potId),
  });
}

/**
 * "Add money" — one step for the person, even though the first time it also
 * has to give the pot permission to move their test money.
 */
export function useAddMoney() {
  const call = useSponsoredCall();
  const refresh = useRefresh();

  return useMutation({
    mutationFn: async (input: {
      potId: number;
      amountPaise: bigint;
      allowance: bigint;
    }) => {
      if (input.allowance < input.amountPaise) {
        await call({
          address: TEST_RUPEE_ADDRESS,
          abi: testRupeeAbi,
          functionName: "approve",
          args: [POT_MANAGER_ADDRESS, maxUint256],
        });
      }
      await call({
        address: POT_MANAGER_ADDRESS,
        abi: potManagerAbi,
        functionName: "deposit",
        args: [BigInt(input.potId), input.amountPaise],
      });
      return input.potId;
    },
    onSuccess: (potId) => refresh(potId),
  });
}

/**
 * Repay a member. Under the limit and to someone else it lands straight away;
 * over the limit, or to yourself, it waits for one other person to approve.
 */
export function useRepay() {
  const call = useSponsoredCall();
  const refresh = useRefresh();

  return useMutation({
    mutationFn: async (input: {
      potId: number;
      to: `0x${string}`;
      amountPaise: bigint;
      memo: string;
    }) => {
      const memoHash = hashMemo(input.memo);
      if (memoHash !== zeroHash) {
        await saveMemo(memoHash, input.memo.trim());
      }
      await call({
        address: POT_MANAGER_ADDRESS,
        abi: potManagerAbi,
        functionName: "requestSpend",
        args: [BigInt(input.potId), input.to, input.amountPaise, memoHash],
      });
      return input.potId;
    },
    onSuccess: (potId) => refresh(potId),
  });
}

/** Approve someone else's pending repayment. It pays out immediately. */
export function useApproveRepayment() {
  const call = useSponsoredCall();
  const refresh = useRefresh();

  return useMutation({
    mutationFn: async (input: { potId: number; spendId: number }) => {
      await call({
        address: POT_MANAGER_ADDRESS,
        abi: potManagerAbi,
        functionName: "approveSpend",
        args: [BigInt(input.potId), BigInt(input.spendId)],
      });
      return input.potId;
    },
    onSuccess: (potId) => refresh(potId),
  });
}

/**
 * Withdraw a repayment that is waiting for approval, releasing the money it
 * was holding. The person who asked can always withdraw their own; the pot's
 * creator can withdraw any, so one quiet member cannot block closing forever.
 */
export function useCancelRepayment() {
  const call = useSponsoredCall();
  const refresh = useRefresh();

  return useMutation({
    mutationFn: async (input: { potId: number; spendId: number }) => {
      await call({
        address: POT_MANAGER_ADDRESS,
        abi: potManagerAbi,
        functionName: "cancelSpend",
        args: [BigInt(input.potId), BigInt(input.spendId)],
      });
      return input.potId;
    },
    onSuccess: (potId) => refresh(potId),
  });
}

/**
 * Move a pot whose deadline passed without reaching its target into refunding.
 * Permissionless by design — anyone can do it, so nobody waits on the creator.
 * The app calls this quietly when it notices, which is why nothing here claims
 * the money "comes back by itself at the deadline": a transaction has to run.
 */
export function useFinalizeFailed() {
  const call = useSponsoredCall();
  const refresh = useRefresh();

  return useMutation({
    mutationFn: async (potId: number) => {
      await call({
        address: POT_MANAGER_ADDRESS,
        abi: potManagerAbi,
        functionName: "finalizeFailed",
        args: [BigInt(potId)],
      });
      return potId;
    },
    onSuccess: (potId) => refresh(potId),
  });
}

/** Take back everything you put into a pot that didn't reach its target. */
export function useClaimRefund() {
  const call = useSponsoredCall();
  const refresh = useRefresh();

  return useMutation({
    mutationFn: async (potId: number) => {
      await call({
        address: POT_MANAGER_ADDRESS,
        abi: potManagerAbi,
        functionName: "claimRefund",
        args: [BigInt(potId)],
      });
      return potId;
    },
    onSuccess: (potId) => refresh(potId),
  });
}

/** Close the pot — leftover goes back to everyone in proportion to what they put in. */
export function useClosePot() {
  const call = useSponsoredCall();
  const refresh = useRefresh();

  return useMutation({
    mutationFn: async (potId: number) => {
      await call({
        address: POT_MANAGER_ADDRESS,
        abi: potManagerAbi,
        functionName: "closePot",
        args: [BigInt(potId)],
      });
      return potId;
    },
    onSuccess: (potId) => refresh(potId),
  });
}

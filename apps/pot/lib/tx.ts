"use client";

import { useSendTransaction, useWallets } from "@privy-io/react-auth";
import { usePublicClient } from "wagmi";
import {
  encodeFunctionData,
  type Abi,
  type TransactionReceipt,
} from "viem";
import { useCallback } from "react";
import { chain } from "./contracts";

/** The user's Privy-managed wallet. They never see or manage it. */
export function useAppWallet() {
  const { wallets } = useWallets();
  const wallet = wallets.find((w) => w.walletClientType === "privy");
  return {
    wallet,
    address: wallet?.address as `0x${string}` | undefined,
    ready: Boolean(wallet?.address),
  };
}

type Call = {
  address: `0x${string}`;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
};

/**
 * Sends a call from the user's wallet with the fee sponsored by the app, and
 * waits until it is actually settled. `sponsor: true` is Privy's native gas
 * sponsorship — no separate smart account involved.
 */
export function useSponsoredCall() {
  const { sendTransaction } = useSendTransaction();
  const { address } = useAppWallet();
  const publicClient = usePublicClient();

  return useCallback(
    async (call: Call): Promise<TransactionReceipt> => {
      if (!address) throw new Error("Still setting up your account — try again in a moment.");
      if (!publicClient) throw new Error("Can't reach the network right now.");

      const data = encodeFunctionData({
        abi: call.abi,
        functionName: call.functionName,
        args: call.args as never,
      });

      const { hash } = await sendTransaction(
        { to: call.address, data, chainId: chain.id, value: 0 },
        { sponsor: true, address }
      );

      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        timeout: 90_000,
      });
      if (receipt.status !== "success") {
        throw new Error("That didn't go through. Please try again.");
      }
      return receipt;
    },
    [address, publicClient, sendTransaction]
  );
}

/**
 * Turns a contract revert into something a person can act on. The contract's
 * rules are named errors, so we map the ones a user can actually hit.
 */
export function readableError(err: unknown): string {
  const raw =
    err instanceof Error ? `${err.message}` : typeof err === "string" ? err : "";

  const map: Record<string, string> = {
    FaucetCooldown: "You already collected test money today. Try again tomorrow.",
    BadInviteCode: "That invite link isn't valid for this pot.",
    AlreadyMember: "You're already in this pot.",
    PotFull: "This pot is already full.",
    PotNotFound: "We couldn't find that pot.",
    NotMember: "Only people in this pot can do that.",
    RecipientNotMember: "You can only repay someone who's in this pot.",
    InsufficientBalance: "The pot doesn't have that much in it.",
    NotCreator: "Only the person who made the pot can close it.",
    CannotApproveOwnSpend: "Someone else in the pot has to approve this.",
    SpendAlreadyExecuted: "This was already paid out.",
    SpendNotFound: "We couldn't find that repayment.",
    SpendWasCancelled: "That repayment was withdrawn.",
    PendingRequests:
      "There are repayments still waiting for approval. Settle or withdraw them first.",
    NotRequesterOrCreator:
      "Only the person who asked, or whoever made the pot, can withdraw this.",
    ZeroAmount: "Enter an amount first.",
    InvalidParams: "Please check the details and try again.",
    NotCollecting: "This pot isn't collecting money any more.",
    NotFunded: "The pot has to reach its target before money can go out.",
    NotRefunding: "There's nothing to claim back from this pot.",
    DeadlinePassed: "The date for this pot has passed.",
    DeadlineNotReached: "The date for this pot hasn't passed yet.",
    NothingToClaim: "You don't have anything to claim back here.",
    AlreadyClaimed: "You've already taken your money back.",
    ERC20InsufficientBalance: "You don't have enough test money. Collect some first.",
    ERC20InsufficientAllowance: "Couldn't move your test money — please try again.",
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

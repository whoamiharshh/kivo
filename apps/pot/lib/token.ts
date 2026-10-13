"use client";

/**
 * Test Rupee, read per spender.
 *
 * ──────────────── why this is not in queries.ts ────────────────
 *
 * `useTestMoney` in `lib/queries.ts` reads the allowance granted to
 * PotManager, because when it was written PotManager was the only contract
 * that moved anybody's money. There are eight now, and ERC-20 allowance is
 * granted *per spender*: the approval a person gave the pot says nothing about
 * whether SocialPay may move their money.
 *
 * Reading the wrong spender's allowance is not a cosmetic bug. The send path
 * in each feature does `if (allowance < amount) approve(...)`, so a stale
 * "already approved" skips the approval and the transfer reverts with a
 * message about allowance that no person in this app should ever be shown. So
 * each feature asks about its own contract, through this hook.
 *
 * The balance is returned alongside because every screen that needs one needs
 * the other — "can this person afford it" is one question — and a single
 * multicall answers both in one round trip.
 */

import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import type { PublicClient } from "viem";
import { TEST_RUPEE_ADDRESS, testRupeeAbi, tokenConfigured } from "./contracts";
import { useAppWallet } from "./tx";

export type TokenState = {
  /** What this person holds, in paise. */
  balance: bigint;
  /** What `spender` is allowed to move on their behalf, in paise. */
  allowance: bigint;
};

/**
 * Balance, plus the allowance granted to one specific contract.
 *
 * `spender` is the feature's own contract address. Passing an unset address
 * (a half-configured deployment) disables the query rather than reading
 * against the zero address, which would answer 0 and look like a real answer.
 */
export function useTokenState(spender: `0x${string}` | undefined) {
  const { address } = useAppWallet();
  const client = usePublicClient();
  const usable = Boolean(
    spender && /^0x[0-9a-fA-F]{40}$/.test(spender) && tokenConfigured
  );

  return useQuery({
    // The spender is part of the key: two features on screen in one session
    // must not share a cached allowance.
    queryKey: ["token-state", address, spender],
    enabled: Boolean(address && client && usable),
    refetchInterval: 24_000,
    queryFn: async (): Promise<TokenState> => {
      const c = client as PublicClient;
      const [balance, allowance] = await c.multicall({
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
            args: [address!, spender!],
          },
        ],
      });
      return { balance: balance as bigint, allowance: allowance as bigint };
    },
  });
}

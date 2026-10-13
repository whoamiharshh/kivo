"use client";

/**
 * Money that unlocks when a condition is met.
 *
 * ──────────────── read, never replayed ────────────────
 *
 * Monad's public RPC refuses any `eth_getLogs` wider than 100 blocks — HTTP
 * 413, `eth_getLogs is limited to a 100 range` — and the deploy block is far
 * further back than that and receding by about 216,000 blocks a day. So
 * nothing here scans logs. `giftCount()` says how many exist and each
 * `getGift` names everybody involved, which is a complete answer over all of
 * history rather than a window of it.
 *
 * The cost is worth stating plainly: this reads every gift anybody has made
 * and keeps the ones that concern you. That is right while the numbers are
 * small, and the day it is not, the answer is an index built server-side —
 * not a log scan, which is simply unavailable here at any price.
 *
 * ──────────────── what the trust layer is for ────────────────
 *
 * A gift whose condition is a person's word needs that person's signature,
 * and the contract checks it rather than taking the caller's word. The
 * signing happens in `/api/trust/attest-condition`, where the app's signer
 * lives; the browser never holds a key that could confirm anything.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import {
  encodeAbiParameters,
  keccak256,
  maxUint256,
  parseEventLogs,
  toHex,
  zeroAddress,
  type PublicClient,
} from "viem";
import {
  GIFT_ADDRESS,
  TEST_RUPEE_ADDRESS,
  giftAbi,
  ready,
  testRupeeAbi,
} from "../contracts";
import { loadDisplayNames, loadMemos, saveMemo } from "../store";
import { attestCondition } from "../trust/client";
import { useAppWallet, useSponsoredCall } from "../tx";
import { friendlyTag } from "../people";

/**
 * The enums, shapes and pure helpers live in `gift-state.ts` so a Server
 * Component can use them — this module is "use client", and that directive
 * would otherwise make even a pure function unusable from the server. They
 * are re-exported here so client code can keep importing from one place.
 */
export {
  ConditionType,
  GiftState,
  CONFIRMER_DISCLOSURE,
  IRREVOCABLE_EXPLAINER,
  describeGift,
  pendingAction,
  secondsUntilTimeout,
  waitLabel,
  dayLabel,
  giftMessageKey,
  giftTitle,
} from "./gift-state";
export type {
  ConditionTypeValue,
  Gift,
  GiftAction,
  GiftStateValue,
  GiftTone,
  GiftView,
} from "./gift-state";

import {
  ConditionType,
  GiftState,
  giftMessageKey,
  type ConditionTypeValue,
  type Gift,
  type GiftView,
} from "./gift-state";

/* ═══════════════════════════ reads ═══════════════════════════ */

/** Attach names and the offchain message to a batch of rows, in one pass. */
async function decorate(
  me: `0x${string}`,
  rows: { id: number; gift: Gift }[]
): Promise<GiftView[]> {
  const mine = me.toLowerCase();
  const others = rows.map((r) =>
    r.gift.sender.toLowerCase() === mine ? r.gift.recipient : r.gift.sender
  );

  const [names, messages] = await Promise.all([
    loadDisplayNames(others),
    loadMemos(rows.map((r) => giftMessageKey(r.id))),
  ]);

  return rows.map(({ id, gift }, i) => {
    const otherAddress = others[i]!;
    // Both stores lowercase their keys, so the lookups must too.
    const saved = names[otherAddress.toLowerCase()]?.trim();
    return {
      ...gift,
      id,
      sending: gift.sender.toLowerCase() === mine,
      otherAddress,
      otherName: saved || friendlyTag(otherAddress),
      message: messages[giftMessageKey(id).toLowerCase()] ?? "",
    };
  });
}

/** Every gift this person gave, was given, or has to confirm. Newest first. */
export function useMyGifts() {
  const { address } = useAppWallet();
  const client = usePublicClient();

  return useQuery({
    queryKey: ["gifts", address],
    enabled: Boolean(address && client && ready.gifts),
    refetchInterval: 30_000,
    queryFn: async (): Promise<GiftView[]> => {
      if (!client || !address) return [];
      const c = client as PublicClient;

      const count = Number(
        (await c.readContract({
          address: GIFT_ADDRESS,
          abi: giftAbi,
          functionName: "giftCount",
        })) as bigint
      );
      if (count === 0) return [];

      // Newest first, which is the order the list shows them in.
      const everyId = Array.from({ length: count }, (_, i) => count - 1 - i);
      const everyGift = (await c.multicall({
        allowFailure: false,
        contracts: everyId.map((id) => ({
          address: GIFT_ADDRESS,
          abi: giftAbi,
          functionName: "getGift" as const,
          args: [BigInt(id)],
        })),
      })) as unknown as Gift[];

      const mine = address.toLowerCase();
      const rows: { id: number; gift: Gift }[] = [];
      everyId.forEach((id, i) => {
        const g = everyGift[i]!;
        if (g.state === GiftState.None) return;
        const concerns =
          g.sender.toLowerCase() === mine ||
          g.recipient.toLowerCase() === mine ||
          g.attester.toLowerCase() === mine;
        if (concerns) rows.push({ id, gift: g });
      });

      return rows.length === 0 ? [] : decorate(address, rows);
    },
  });
}

/** One gift. Works for the confirmer as well as for the two parties. */
export function useGift(giftId: number | undefined) {
  const { address } = useAppWallet();
  const client = usePublicClient();

  return useQuery({
    queryKey: ["gift", giftId, address],
    enabled: Boolean(giftId !== undefined && client && address && ready.gifts),
    refetchInterval: 24_000,
    queryFn: async (): Promise<GiftView | null> => {
      if (!client || !address || giftId === undefined) return null;

      let gift: Gift;
      try {
        gift = (await (client as PublicClient).readContract({
          address: GIFT_ADDRESS,
          abi: giftAbi,
          functionName: "getGift",
          args: [BigInt(giftId)],
        })) as unknown as Gift;
      } catch {
        // A missing gift reverts with GiftNotFound rather than answering
        // zeroes, so a bad link is caught here instead of rendering as blank.
        return null;
      }

      if (gift.state === GiftState.None) return null;
      const [view] = await decorate(address, [{ id: giftId, gift }]);
      return view ?? null;
    },
  });
}

/* ═══════════════════════════ writes ═══════════════════════════ */

function useRefreshGifts() {
  const qc = useQueryClient();
  return (giftId?: number) => {
    void qc.invalidateQueries({ queryKey: ["token-state"] });
    void qc.invalidateQueries({ queryKey: ["test-money"] });
    void qc.invalidateQueries({ queryKey: ["gifts"] });
    if (giftId !== undefined) {
      void qc.invalidateQueries({ queryKey: ["gift", giftId] });
    }
  };
}

export type CreateGiftInput = {
  recipient: `0x${string}`;
  amountPaise: bigint;
  /** What the gift is for, in the giver's words. Stored offchain. */
  message: string;
  /** A date gift needs no confirmer; a condition gift needs one. */
  kind: "date" | "condition";
  /** Unix seconds. Only read for a date gift. */
  releaseTime?: bigint;
  /** Who may confirm. Only read for a condition gift. */
  attester?: `0x${string}`;
  /** True gives up the right to take it back. */
  irrevocable: boolean;
  /** Current allowance, so the one-time approval only happens once. */
  allowance: bigint;
};

/**
 * Set a gift aside.
 *
 * The ERC-20 approval is folded into the same action rather than shown as a
 * step of its own. Somebody giving a gift has one intention, and asking them
 * to authorise a thing they never asked about is the clearest possible signal
 * that there is a chain under here.
 */
export function useCreateGift() {
  const call = useSponsoredCall();
  const refresh = useRefreshGifts();

  return useMutation({
    mutationFn: async (input: CreateGiftInput): Promise<number> => {
      if (input.amountPaise <= 0n) throw new Error("Enter an amount first.");
      if (input.recipient === zeroAddress) {
        throw new Error("Choose who the gift is for.");
      }

      const isDate = input.kind === "date";
      if (isDate && !input.releaseTime) throw new Error("Pick a date.");
      if (!isDate && !input.attester) {
        throw new Error("Choose who confirms it.");
      }

      if (input.allowance < input.amountPaise) {
        await call({
          address: TEST_RUPEE_ADDRESS,
          abi: testRupeeAbi,
          functionName: "approve",
          args: [GIFT_ADDRESS, maxUint256],
        });
      }

      // A date gift carries the moment as its condition data; a condition
      // gift carries a hash of the words, so the text itself never lands on
      // the chain. Both are what the contract checks against later.
      const conditionType: ConditionTypeValue = isDate
        ? ConditionType.Time
        : ConditionType.Attestation;
      const conditionData = isDate
        ? encodeAbiParameters(
            [{ type: "uint256" }],
            [input.releaseTime as bigint]
          )
        : keccak256(toHex(input.message.trim() || "a condition"));

      const receipt = await call({
        address: GIFT_ADDRESS,
        abi: giftAbi,
        functionName: "createGift",
        args: [
          input.recipient,
          input.amountPaise,
          conditionType,
          conditionData,
          isDate ? zeroAddress : (input.attester as `0x${string}`),
          input.irrevocable,
        ],
      });

      const [created] = parseEventLogs({
        abi: giftAbi,
        logs: receipt.logs,
        eventName: "GiftCreated",
      });
      const giftId = Number(
        (created?.args as { giftId?: bigint } | undefined)?.giftId ?? 0n
      );

      // Saved after the gift exists, so a failed send never leaves a message
      // behind for a gift that was never made.
      const text = input.message.trim();
      if (text) await saveMemo(giftMessageKey(giftId), text);

      return giftId;
    },
    onSuccess: (giftId) => refresh(giftId),
  });
}

/** Take a gift that is ready. */
export function useClaimGift() {
  const call = useSponsoredCall();
  const refresh = useRefreshGifts();

  return useMutation({
    mutationFn: async (giftId: number) => {
      await call({
        address: GIFT_ADDRESS,
        abi: giftAbi,
        functionName: "claim",
        args: [BigInt(giftId)],
      });
      return giftId;
    },
    onSuccess: (giftId) => refresh(giftId),
  });
}

/** Take back a gift that was never promised firmly. */
export function useCancelGift() {
  const call = useSponsoredCall();
  const refresh = useRefreshGifts();

  return useMutation({
    mutationFn: async (giftId: number) => {
      await call({
        address: GIFT_ADDRESS,
        abi: giftAbi,
        functionName: "cancel",
        args: [BigInt(giftId)],
      });
      return giftId;
    },
    onSuccess: (giftId) => refresh(giftId),
  });
}

/**
 * Confirm that the thing happened.
 *
 * Only the named person may do this, and the contract checks a signature
 * rather than taking the caller's word for it. The signature is made by the
 * app's signer in `/api/trust/attest-condition` after it has checked who is
 * asking — the browser never holds a key that could confirm anything.
 */
export function useConfirmGift() {
  const call = useSponsoredCall();
  const refresh = useRefreshGifts();

  return useMutation({
    mutationFn: async (input: { giftId: number; evidence: string }) => {
      const evidenceHash = keccak256(
        toHex(input.evidence.trim() || "confirmed")
      );
      const { signature } = await attestCondition(input.giftId, evidenceHash);

      await call({
        address: GIFT_ADDRESS,
        abi: giftAbi,
        functionName: "attestCondition",
        args: [BigInt(input.giftId), signature],
      });
      return input.giftId;
    },
    onSuccess: (giftId) => refresh(giftId),
  });
}

/** Take a gift nobody ever confirmed, once the wait has run out. */
export function useReleaseGift() {
  const call = useSponsoredCall();
  const refresh = useRefreshGifts();

  return useMutation({
    mutationFn: async (giftId: number) => {
      await call({
        address: GIFT_ADDRESS,
        abi: giftAbi,
        functionName: "requestTimeoutRelease",
        args: [BigInt(giftId)],
      });
      return giftId;
    },
    onSuccess: (giftId) => refresh(giftId),
  });
}

/* ═══════════════════════════ errors ═══════════════════════════ */

/**
 * A contract revert, said in words somebody can act on.
 *
 * The named errors are the ones a person can hit by using the app normally;
 * anything else falls through to the general apology rather than showing a
 * selector nobody can read.
 */
export function giftError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");

  const map: Record<string, string> = {
    GiftIsIrrevocable: "This was promised firmly, so it cannot be taken back.",
    ConditionNotMet: "This is not ready yet.",
    NotRecipient: "Only the person it was given to can take this.",
    NotSender: "Only the person who gave this can do that.",
    AttesterNotAllowed:
      "A gift set to a date does not need anybody to confirm it.",
    AttesterRequired: "Choose who confirms this.",
    BadAttestation: "That confirmation could not be checked. Please try again.",
    TimeoutNotReached: "The wait is not over yet.",
    ReleaseTooSoon: "Pick a date a little further ahead.",
    SelfGift: "You cannot give a gift to yourself.",
    WrongState: "This gift has already been dealt with.",
    ZeroAmount: "Enter an amount first.",
    GiftNotFound: "That gift does not exist.",
    ERC20InsufficientBalance:
      "You do not have enough test money. Collect some first.",
  };

  for (const [name, message] of Object.entries(map)) {
    if (raw.includes(name)) return message;
  }
  if (/user rejected|denied/i.test(raw)) return "Cancelled.";
  return "Something went wrong. Please try again.";
}

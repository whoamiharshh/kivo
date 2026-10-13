"use client";

/**
 * Pay a person — the data layer for SocialPay.
 *
 * ──────────────── what the contract actually does ────────────────
 *
 * You send money and the contract *holds* it. The recipient confirms they got
 * it and the money is released to them. If they never confirm, you take it
 * back after an agreed window. Either side can object, which freezes the money
 * until two of three — sender, recipient, arbitrator — agree where it goes.
 *
 * That hold is the whole point and it is the one thing the UI must never blur:
 * money that has left your balance but has not reached theirs is in a third
 * place, and a person needs to see that third place or they will assume the
 * payment failed and send it twice.
 *
 * ──────────────── why this file is separate ────────────────
 *
 * `lib/queries.ts` is already 15 KB of PotManager. Seven more features in the
 * same file would make every screen import every feature's event list. One
 * file per feature under lib/features/ keeps each screen's bundle to the
 * contract it actually talks to.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { maxUint256, type PublicClient } from "viem";
import {
  SOCIAL_PAY_ADDRESS,
  TEST_RUPEE_ADDRESS,
  ready,
  socialPayAbi,
  testRupeeAbi,
} from "../contracts";
import { loadDisplayNames, loadMemos, saveMemo } from "../store";
import { hashMemo } from "../actions";
import { useAppWallet, useSponsoredCall } from "../tx";

/**
 * The enums, shapes and pure helpers live in `pay-state.ts` so a Server
 * Component can use them: this module is "use client", and that directive
 * would otherwise make even a pure function unusable from the server. They are
 * re-exported here so client code can keep importing from one place.
 */
export {
  PayState,
  describe,
  pendingAction,
  shortAddress,
  MIN_CONFIRM_WINDOW_SECONDS,
  MAX_CONFIRM_WINDOW_SECONDS,
} from "./pay-state";
export type { Payment, PayStateValue, PaymentView } from "./pay-state";

import {
  MAX_CONFIRM_WINDOW_SECONDS,
  MIN_CONFIRM_WINDOW_SECONDS,
  shortAddress,
  PayState as State,
  type Payment as PaymentRow,
  type PaymentView as View,
} from "./pay-state";


/**
 * Every payment the signed-in person is part of, newest first.
 *
 * Found from events rather than from a counter, because a payment concerns two
 * people and only the logs know which ones. Two scans — one indexed on sender,
 * one on recipient — are far cheaper than reading every payment ever made and
 * filtering client-side.
 */
export function useMyPayments() {
  const { address } = useAppWallet();
  const client = usePublicClient();

  return useQuery({
    queryKey: ["payments", address],
    enabled: Boolean(address && client && ready.pay),
    refetchInterval: 30_000,
    queryFn: async (): Promise<View[]> => {
      if (!client || !address) return [];
      return loadPayments(client as PublicClient, address);
    },
  });
}

/** One payment, with its memo and the other party's name resolved. */
export function usePayment(paymentId: number | undefined) {
  const { address } = useAppWallet();
  const client = usePublicClient();

  return useQuery({
    queryKey: ["payment", paymentId, address],
    enabled: Boolean(paymentId !== undefined && client && address && ready.pay),
    refetchInterval: 24_000,
    queryFn: async (): Promise<View | null> => {
      if (!client || !address || paymentId === undefined) return null;
      const raw = (await client.readContract({
        address: SOCIAL_PAY_ADDRESS,
        abi: socialPayAbi,
        functionName: "getPayment",
        args: [BigInt(paymentId)],
      })) as PaymentRow;

      if (raw.state === State.None) return null;
      const [view] = await decorate(client as PublicClient, address, [
        { id: paymentId, payment: raw },
      ]);
      return view ?? null;
    },
  });
}

/**
 * What happened to one payment, oldest first.
 *
 * ──────────────── read from the payment, not replayed ────────────────
 *
 * This was five parallel log scans. Monad's RPC caps a scan at 100 blocks and
 * answers HTTP 413 beyond it, so all five failed on every poll and the feed
 * was permanently empty. A payment's whole history is implied by its state,
 * so it is derived rather than replayed.
 *
 * The cost, stated rather than hidden: there are no times. The feed is
 * ordered, not dated, and no line claims an hour it cannot know. That comes
 * back the day events are indexed server-side; this hook's shape would not
 * change.
 */
export function usePaymentActivity(paymentId: number | undefined) {
  const client = usePublicClient();

  return useQuery({
    queryKey: ["payment-activity", paymentId],
    enabled: Boolean(paymentId !== undefined && client && ready.pay),
    refetchInterval: 24_000,
    queryFn: async (): Promise<{ kind: PayEventKind; key: string }[]> => {
      if (!client || paymentId === undefined) return [];

      let row: PaymentRow;
      try {
        row = (await (client as PublicClient).readContract({
          address: SOCIAL_PAY_ADDRESS,
          abi: socialPayAbi,
          functionName: "getPayment",
          args: [BigInt(paymentId)],
        })) as PaymentRow;
      } catch {
        return [];
      }
      if (row.state === State.None) return [];

      const entries: { kind: PayEventKind; key: string }[] = [
        { kind: "sent", key: `sent-${paymentId}` },
      ];

      if (row.state === State.Confirmed || row.state === State.Claimed) {
        entries.push({ kind: "confirmed", key: `confirmed-${paymentId}` });
      }
      if (row.state === State.Reclaimed) {
        entries.push({ kind: "reclaimed", key: `reclaimed-${paymentId}` });
      }
      if (row.state === State.Disputed || row.state === State.Resolved) {
        entries.push({ kind: "disputed", key: `disputed-${paymentId}` });
      }
      if (row.state === State.Resolved) {
        entries.push({ kind: "resolved", key: `resolved-${paymentId}` });
      }

      return entries;
    },
  });
}

/** The kinds of line a payment's history can carry. */
export type PayEventKind =
  | "sent"
  | "confirmed"
  | "reclaimed"
  | "disputed"
  | "resolved";


/* ═══════════════════════════ reads, shared ═══════════════════════════ */

async function loadPayments(
  client: PublicClient,
  me: `0x${string}`
): Promise<View[]> {
  // Read, don't replay. Monad's RPC refuses any log scan wider than 100
  // blocks — HTTP 413, `eth_getLogs is limited to a 100 range` — and the
  // deploy block is far further back than that and receding by about 216,000
  // blocks a day, so finding payments by their `PaymentInitiated` event
  // stopped being possible minutes after launch. `paymentCount()` says how
  // many exist and each `getPayment` names both sides.
  //
  // One multicall, not a read per id: a person with twenty payments should
  // cost one round trip rather than twenty.
  const count = Number(
    (await client.readContract({
      address: SOCIAL_PAY_ADDRESS,
      abi: socialPayAbi,
      functionName: "paymentCount",
    })) as bigint
  );
  if (count === 0) return [];

  const everyId = Array.from({ length: count }, (_, i) => i);
  const everyPayment = (await client.multicall({
    allowFailure: false,
    contracts: everyId.map((id) => ({
      address: SOCIAL_PAY_ADDRESS,
      abi: socialPayAbi,
      functionName: "getPayment" as const,
      args: [BigInt(id)],
    })),
  })) as unknown as PaymentRow[];

  const mine = me.toLowerCase();
  const payments: { id: number; payment: PaymentRow }[] = [];
  everyId.forEach((id, i) => {
    const row = everyPayment[i]!;
    if (row.state === State.None) return;
    if (
      row.sender.toLowerCase() === mine ||
      row.recipient.toLowerCase() === mine
    ) {
      payments.push({ id, payment: row });
    }
  });
  if (payments.length === 0) return [];

  const views = await decorate(client, me, payments);
  return views.sort((a, b) => Number(b.createdAt - a.createdAt));
}

/**
 * Attach the offchain half: who the other party is called, and what the memo
 * said. Both are looked up in one batch rather than per row, because a list of
 * twenty payments must not become forty requests.
 */
async function decorate(
  client: PublicClient,
  me: `0x${string}`,
  rows: { id: number; payment: PaymentRow }[]
): Promise<View[]> {
  const lower = me.toLowerCase();

  const others = rows.map((r) =>
    r.payment.sender.toLowerCase() === lower
      ? r.payment.recipient
      : r.payment.sender
  );

  const [names, memos] = await Promise.all([
    loadDisplayNames(others),
    loadMemos(rows.map((r) => r.payment.memoHash)),
  ]);

  return rows.map((r, i) => {
    const outgoing = r.payment.sender.toLowerCase() === lower;
    const otherAddress = others[i]!;
    return {
      ...r.payment,
      id: r.id,
      outgoing,
      otherAddress,
      otherName:
        names[otherAddress.toLowerCase()] ?? shortAddress(otherAddress),
      // loadMemos lowercases its keys, so the lookup has to as well.
      memo: memos[r.payment.memoHash.toLowerCase()] ?? "",
    };
  });
}

/* ═══════════════════════════ writes ═══════════════════════════ */

function useRefreshPayments() {
  const qc = useQueryClient();
  return (paymentId?: number) => {
    void qc.invalidateQueries({ queryKey: ["test-money"] });
    void qc.invalidateQueries({ queryKey: ["payments"] });
    if (paymentId !== undefined) {
      void qc.invalidateQueries({ queryKey: ["payment", paymentId] });
      void qc.invalidateQueries({ queryKey: ["payment-activity", paymentId] });
    }
  };
}

export type SendPaymentInput = {
  recipient: `0x${string}`;
  amountPaise: bigint;
  memo: string;
  /** How long the recipient has to confirm, in seconds. */
  confirmWindowSeconds: number;
  /** Current allowance, so the one-time approval only happens once. */
  allowance: bigint;
};

/**
 * Send money, held until the recipient confirms.
 *
 * The ERC-20 approval is folded into the same action rather than shown as a
 * separate step. A person sending money has one intention, and asking them to
 * authorise a thing they never asked about would be the clearest possible
 * signal that there is a blockchain under here.
 */
export function useSendPayment() {
  const call = useSponsoredCall();
  const refresh = useRefreshPayments();

  return useMutation({
    mutationFn: async (input: SendPaymentInput) => {
      if (input.confirmWindowSeconds < MIN_CONFIRM_WINDOW_SECONDS) {
        throw new Error("Give them at least an hour to confirm.");
      }
      if (input.confirmWindowSeconds > MAX_CONFIRM_WINDOW_SECONDS) {
        throw new Error("The longest you can wait is 30 days.");
      }

      if (input.allowance < input.amountPaise) {
        await call({
          address: TEST_RUPEE_ADDRESS,
          abi: testRupeeAbi,
          functionName: "approve",
          args: [SOCIAL_PAY_ADDRESS, maxUint256],
        });
      }

      const memoHash = hashMemo(input.memo);

      const receipt = await call({
        address: SOCIAL_PAY_ADDRESS,
        abi: socialPayAbi,
        functionName: "sendPayment",
        args: [
          input.recipient,
          input.amountPaise,
          memoHash,
          BigInt(input.confirmWindowSeconds),
        ],
      });

      // Saved after the send, not before: a memo stored for a payment that
      // never happened would show up as a phantom row in the feed.
      if (input.memo.trim()) await saveMemo(memoHash, input.memo.trim());

      return receipt;
    },
    onSuccess: () => refresh(),
  });
}

/** "Yes, I got it." Releases the held money to the recipient. */
export function useConfirmReceipt() {
  const call = useSponsoredCall();
  const refresh = useRefreshPayments();

  return useMutation({
    mutationFn: async (paymentId: number) => {
      await call({
        address: SOCIAL_PAY_ADDRESS,
        abi: socialPayAbi,
        functionName: "confirmReceipt",
        args: [BigInt(paymentId)],
      });
      return paymentId;
    },
    onSuccess: (paymentId) => refresh(paymentId),
  });
}

/** Take back money the recipient never confirmed, once the window has passed. */
export function useReclaimPayment() {
  const call = useSponsoredCall();
  const refresh = useRefreshPayments();

  return useMutation({
    mutationFn: async (paymentId: number) => {
      await call({
        address: SOCIAL_PAY_ADDRESS,
        abi: socialPayAbi,
        functionName: "reclaim",
        args: [BigInt(paymentId)],
      });
      return paymentId;
    },
    onSuccess: (paymentId) => refresh(paymentId),
  });
}

/**
 * Freeze the money because something is wrong.
 *
 * Either party may do this, and it settles nothing by itself — it stops the
 * clock and waits for two of three to agree. The UI has to say that plainly,
 * because "dispute" sounds like an appeal to someone who will decide quickly,
 * and here it is a wait.
 */
export function useDisputePayment() {
  const call = useSponsoredCall();
  const refresh = useRefreshPayments();

  return useMutation({
    mutationFn: async (paymentId: number) => {
      await call({
        address: SOCIAL_PAY_ADDRESS,
        abi: socialPayAbi,
        functionName: "dispute",
        args: [BigInt(paymentId)],
      });
      return paymentId;
    },
    onSuccess: (paymentId) => refresh(paymentId),
  });
}

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
import { maxUint256, parseAbiItem, type PublicClient } from "viem";
import {
  DEPLOY_BLOCK,
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

const EVENTS = {
  PaymentInitiated: parseAbiItem(
    "event PaymentInitiated(uint256 indexed paymentId, address indexed sender, address indexed recipient, uint256 amount, bytes32 memoHash, uint64 deadline)"
  ),
  PaymentConfirmed: parseAbiItem(
    "event PaymentConfirmed(uint256 indexed paymentId, address indexed recipient, uint256 amount)"
  ),
  PaymentReclaimed: parseAbiItem(
    "event PaymentReclaimed(uint256 indexed paymentId, address indexed sender, uint256 amount)"
  ),
  PaymentDisputed: parseAbiItem(
    "event PaymentDisputed(uint256 indexed paymentId, address indexed by)"
  ),
  DisputeResolved: parseAbiItem(
    "event DisputeResolved(uint256 indexed paymentId, address indexed paidTo, uint256 amount)"
  ),
} as const;

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
    refetchInterval: 10_000,
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
    refetchInterval: 8_000,
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

/** What happened to one payment, oldest first, for its detail screen. */
export function usePaymentActivity(paymentId: number | undefined) {
  const client = usePublicClient();

  return useQuery({
    queryKey: ["payment-activity", paymentId],
    enabled: Boolean(paymentId !== undefined && client && ready.pay),
    queryFn: async () => {
      if (!client || paymentId === undefined) return [];
      const id = BigInt(paymentId);
      const scan = (event: (typeof EVENTS)[keyof typeof EVENTS]) =>
        client.getLogs({
          address: SOCIAL_PAY_ADDRESS,
          event,
          args: { paymentId: id },
          fromBlock: DEPLOY_BLOCK,
          toBlock: "latest",
        });

      const [initiated, confirmed, reclaimed, disputed, resolved] =
        await Promise.all([
          scan(EVENTS.PaymentInitiated),
          scan(EVENTS.PaymentConfirmed),
          scan(EVENTS.PaymentReclaimed),
          scan(EVENTS.PaymentDisputed),
          scan(EVENTS.DisputeResolved),
        ]);

      const entries = [
        ...initiated.map((l) => ({ kind: "sent" as const, log: l })),
        ...confirmed.map((l) => ({ kind: "confirmed" as const, log: l })),
        ...reclaimed.map((l) => ({ kind: "reclaimed" as const, log: l })),
        ...disputed.map((l) => ({ kind: "disputed" as const, log: l })),
        ...resolved.map((l) => ({ kind: "resolved" as const, log: l })),
      ];

      // Block number then log index: two events in one block still order
      // correctly, which matters when a confirm and a resolve land together.
      return entries.sort((a, b) => {
        const byBlock =
          Number(a.log.blockNumber ?? 0n) - Number(b.log.blockNumber ?? 0n);
        return byBlock !== 0
          ? byBlock
          : Number(a.log.logIndex ?? 0) - Number(b.log.logIndex ?? 0);
      });
    },
  });
}

/* ═══════════════════════════ reads, shared ═══════════════════════════ */

async function loadPayments(
  client: PublicClient,
  me: `0x${string}`
): Promise<View[]> {
  const [asSender, asRecipient] = await Promise.all([
    client.getLogs({
      address: SOCIAL_PAY_ADDRESS,
      event: EVENTS.PaymentInitiated,
      args: { sender: me },
      fromBlock: DEPLOY_BLOCK,
      toBlock: "latest",
    }),
    client.getLogs({
      address: SOCIAL_PAY_ADDRESS,
      event: EVENTS.PaymentInitiated,
      args: { recipient: me },
      fromBlock: DEPLOY_BLOCK,
      toBlock: "latest",
    }),
  ]);

  // The two scans can overlap, so ids go through a Set before any reads.
  const ids = [
    ...new Set(
      [...asSender, ...asRecipient]
        .map((l) => l.args.paymentId)
        .filter((id): id is bigint => id !== undefined)
        .map(Number)
    ),
  ];

  if (ids.length === 0) return [];

  const payments = await Promise.all(
    ids.map(async (id) => ({
      id,
      payment: (await client.readContract({
        address: SOCIAL_PAY_ADDRESS,
        abi: socialPayAbi,
        functionName: "getPayment",
        args: [BigInt(id)],
      })) as PaymentRow,
    }))
  );

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

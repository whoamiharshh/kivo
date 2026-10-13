"use client";

/**
 * Pay as it earns — the data layer for SalaryStream.
 *
 * ──────────────── what the contract actually does ────────────────
 *
 * One person funds an arrangement at a rate per second. The other person's pay
 * builds up second by second and they can take whatever has built up, whenever
 * they like, without asking. Nobody waits for a pay day.
 *
 * Two rules shape every screen in this feature:
 *
 *  1. **Pay can only build up out of money already put in.** Accrual is capped
 *     at the funded balance, so every paisa the contract says is owed is a
 *     paisa it is holding. When the money runs out, pay stops building up —
 *     it does not quietly accumulate a debt.
 *  2. **Nothing already earned can be taken away.** Pausing stops the clock
 *     from now on; closing returns only the part that was never earned. Money
 *     that has built up stays withdrawable forever.
 *
 * Together they mean the honest thing to show is two numbers, not one: what has
 * built up, and how much funded money is left to build out of. `project()` in
 * `stream-state.ts` computes both, and the UI never merges them.
 *
 * ──────────────── what this feature is NOT ────────────────
 *
 * It does not pull money from anybody on a schedule. The payer puts money in
 * ahead of time, and the contract has no code path that takes from an account
 * later — that was deliberate, and the copy on every screen matches it.
 *
 * It also makes no claim about who the payer is. `app/api/trust/verify-employer`
 * says in its own header that it verifies nothing: it records what somebody
 * typed about themselves. So no screen here shows a verified badge, and
 * `verifyEmployer` is not called at all — a signature nothing checks would add
 * a step and buy the person being paid precisely nothing. What does protect
 * them is rule 1 above, which needs no attestation and is stated on screen.
 *
 * ──────────────── why this file is separate ────────────────
 *
 * Same reason as `pay.ts`: one module per feature keeps each screen's bundle to
 * the contract it actually talks to, instead of every screen importing every
 * feature's event list.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { maxUint256, parseEventLogs, type PublicClient } from "viem";
import {
  SALARY_STREAM_ADDRESS,
  TEST_RUPEE_ADDRESS,
  ready,
  salaryStreamAbi,
  testRupeeAbi,
} from "../contracts";
import { friendlyTag } from "../people";
import { loadDisplayNames } from "../store";
import { useAppWallet, useSponsoredCall, readableError } from "../tx";

/**
 * The enums, shapes and pure maths live in `stream-state.ts` so a Server
 * Component can use them: this module is "use client", and that directive
 * would otherwise make even a pure function unusable from the server. They are
 * re-exported here so client code can keep importing from one place.
 */
export {
  StreamState,
  PERIODS,
  PERIOD_WORD,
  DAY_SECONDS,
  LOW_RUNWAY_SECONDS,
  MIN_DURATION_SECONDS,
  MAX_DURATION_SECONDS,
  project,
  describe,
  pendingAction,
  ratePerSecondFor,
  perPeriod,
  costOfSeconds,
  spanLabel,
  dayLabel,
  momentLabel,
} from "./stream-state";
export type {
  Stream,
  StreamView,
  StreamFigures,
  StreamStateValue,
  StreamHistoryEntry,
  StreamEventKind,
  PeriodKey,
} from "./stream-state";

import {
  StreamState as State,
  type Stream as StreamRow,
  type StreamHistoryEntry,
  type StreamView as View,
} from "./stream-state";


/* ═══════════════════════════ reads ═══════════════════════════ */

/**
 * Every arrangement the signed-in person is part of, newest first.
 *
 * Found from events rather than by walking `streamCount`, because an
 * arrangement concerns two people and only the logs know which ones. Two scans
 * — one indexed on the payer, one on the person being paid — are far cheaper
 * than reading every stream ever opened and filtering in the browser.
 *
 * The refetch is slow on purpose. The figure on screen moves every second, but
 * it moves by *arithmetic* — `project()` recomputes it from the row already in
 * hand. Nothing changes on chain between a top-up and a withdrawal, so asking
 * the chain once every ten seconds is plenty.
 */
export function useMyStreams() {
  const { address } = useAppWallet();
  const client = usePublicClient();

  return useQuery({
    queryKey: ["streams", address],
    enabled: Boolean(address && client && ready.streams),
    refetchInterval: 30_000,
    queryFn: async (): Promise<View[]> => {
      if (!client || !address) return [];
      return loadStreams(client as PublicClient, address);
    },
  });
}

/** One arrangement, with the other person's name resolved. */
export function useStream(streamId: number | undefined) {
  const { address } = useAppWallet();
  const client = usePublicClient();

  return useQuery({
    queryKey: ["stream", streamId, address],
    enabled: Boolean(
      streamId !== undefined && client && address && ready.streams
    ),
    refetchInterval: 24_000,
    queryFn: async (): Promise<View | null> => {
      if (!client || !address || streamId === undefined) return null;

      // A missing stream reverts with StreamNotFound rather than answering
      // zeroes, so a bad link has to be caught rather than rendered as an
      // empty arrangement.
      let raw: StreamRow;
      try {
        raw = (await client.readContract({
          address: SALARY_STREAM_ADDRESS,
          abi: salaryStreamAbi,
          functionName: "getStream",
          args: [BigInt(streamId)],
        })) as StreamRow;
      } catch {
        return null;
      }

      if (raw.state === State.None) return null;
      const [view] = await decorate(client as PublicClient, address, [
        { id: streamId, stream: raw },
      ]);
      return view ?? null;
    },
  });
}

/**
 * What has happened to one arrangement, oldest first.
 *
 * ──────────────── read from the arrangement, not replayed ────────────────
 *
 * This was six parallel log scans. Monad's RPC caps a scan at 100 blocks and
 * answers HTTP 413 beyond it, so all six failed on every poll and the history
 * was permanently empty. Everything it showed is recoverable from the stream
 * struct, so it is read instead.
 *
 * What is lost, and not papered over: there are no times, and top-ups and
 * withdrawals collapse into one line each carrying the running total rather
 * than one line per tap. `funded` and `withdrawn` are totals, not journals.
 * Both come back the day events are indexed server-side; this function's
 * shape would not change.
 */
export function useStreamActivity(streamId: number | undefined) {
  const client = usePublicClient();

  return useQuery({
    queryKey: ["stream-activity", streamId],
    enabled: Boolean(streamId !== undefined && client && ready.streams),
    refetchInterval: 45_000,
    queryFn: async (): Promise<StreamHistoryEntry[]> => {
      if (!client || streamId === undefined) return [];

      let row: StreamRow;
      try {
        row = (await client.readContract({
          address: SALARY_STREAM_ADDRESS,
          abi: salaryStreamAbi,
          functionName: "getStream",
          args: [BigInt(streamId)],
        })) as StreamRow;
      } catch {
        return [];
      }
      if (row.state === State.None) return [];

      const entries: StreamHistoryEntry[] = [
        {
          kind: "started",
          key: `started-${streamId}`,
          amount: row.funded,
          by: row.employer,
        },
      ];

      if (row.withdrawn > 0n) {
        entries.push({
          kind: "withdrawn",
          key: `withdrawn-${streamId}`,
          amount: row.withdrawn,
          by: row.employee,
        });
      }

      if (row.state === State.Paused) {
        entries.push({ kind: "paused", key: `paused-${streamId}` });
      }

      if (row.state === State.Cancelled) {
        entries.push({
          kind: "closed",
          key: `closed-${streamId}`,
          amount: row.settled,
          returned: row.funded - row.settled,
        });
      }

      return entries;
    },
  });
}

/* ═══════════════════════════ reads, shared ═══════════════════════════ */

async function loadStreams(
  client: PublicClient,
  me: `0x${string}`
): Promise<View[]> {
  // Read, don't replay. Monad's RPC refuses any log scan wider than 100
  // blocks — HTTP 413, `eth_getLogs is limited to a 100 range` — and the
  // deploy block is far further back than that, so finding arrangements by
  // their `StreamCreated` event stopped working minutes after launch. The
  // contract answers directly instead: `streamCount()` says how many exist
  // and each `getStream` names both sides of it.
  //
  // This reads every arrangement anybody has made, which is more work than an
  // indexed scan would be. That is the right trade while the numbers are
  // small, and the day it is not, the answer is an index built server-side —
  // not a log scan, which is simply unavailable here at any price.
  const count = Number(
    (await client.readContract({
      address: SALARY_STREAM_ADDRESS,
      abi: salaryStreamAbi,
      functionName: "streamCount",
    })) as bigint
  );
  if (count === 0) return [];

  const everyId = Array.from({ length: count }, (_, i) => i);
  const everyStream = (await client.multicall({
    allowFailure: false,
    contracts: everyId.map((id) => ({
      address: SALARY_STREAM_ADDRESS,
      abi: salaryStreamAbi,
      functionName: "getStream" as const,
      args: [BigInt(id)],
    })),
  })) as unknown as StreamRow[];

  const mine = me.toLowerCase();
  const ids = everyId.filter((_, i) => {
    const row = everyStream[i]!;
    return (
      row.employer.toLowerCase() === mine || row.employee.toLowerCase() === mine
    );
  });

  if (ids.length === 0) return [];

  // The structs were already read above when working out which are mine, so
  // they are reused rather than fetched a second time.
  const views = await decorate(
    client,
    me,
    ids.map((id) => ({ id, stream: everyStream[id]! }))
  );

  // Newest first. Stream ids increment, so the id is the ordering and no
  // extra field has to be read to sort.
  return views.sort((a, b) => b.id - a.id);
}

/**
 * Attach the offchain half: what the other person is called.
 *
 * Looked up in one batch rather than per row, because a list of six
 * arrangements must not become six Supabase reads.
 */
async function decorate(
  client: PublicClient,
  me: `0x${string}`,
  rows: { id: number; stream: StreamRow }[]
): Promise<View[]> {
  const lower = me.toLowerCase();

  const others = rows.map((r) =>
    r.stream.employer.toLowerCase() === lower ? r.stream.employee : r.stream.employer
  );

  const names = await loadDisplayNames(others);

  return rows.map((r, i) => {
    const otherAddress = others[i]!;
    return {
      ...r.stream,
      id: r.id,
      paying: r.stream.employer.toLowerCase() === lower,
      otherAddress,
      // loadDisplayNames lowercases its keys, so the lookup has to as well.
      // No address is ever shown: an unnamed person gets a stable tag.
      otherName:
        names[otherAddress.toLowerCase()]?.trim() || friendlyTag(otherAddress),
    };
  });
}

/* ═══════════════════════════ writes ═══════════════════════════ */

function useRefreshStreams() {
  const qc = useQueryClient();
  return (streamId?: number) => {
    void qc.invalidateQueries({ queryKey: ["token-state"] });
    void qc.invalidateQueries({ queryKey: ["test-money"] });
    void qc.invalidateQueries({ queryKey: ["streams"] });
    if (streamId !== undefined) {
      void qc.invalidateQueries({ queryKey: ["stream", streamId] });
      void qc.invalidateQueries({ queryKey: ["stream-activity", streamId] });
    }
  };
}

export type StartStreamInput = {
  /** Who gets paid. Chosen from people you already share a pot with. */
  employee: `0x${string}`;
  /** Paise per second, already rounded to a whole paisa. */
  ratePerSecond: bigint;
  /** How long the arrangement runs, in seconds from now. */
  durationSeconds: number;
  /** What goes in now, in paise. Must be above zero. */
  depositPaise: bigint;
  /** Current allowance, so the one-time approval only happens once. */
  allowance: bigint;
};

/**
 * Open an arrangement and put the first money in.
 *
 * `startTime` is sent as 0 deliberately. The contract clamps any start in the
 * past to its own block time (`if (start < _now()) start = _now()`), so zero
 * means "start now by the chain's clock" and a browser clock running a minute
 * fast cannot push the start into the future. The end is computed from the
 * browser's clock, which at worst shortens or lengthens the term by that same
 * skew — a second or two on a term measured in months.
 *
 * The one-time approval is folded into the same action rather than shown as a
 * separate step, exactly as `useSendPayment` does: a person setting up pay has
 * one intention, and asking them to authorise something they never asked about
 * is the clearest possible signal that there is a chain under here.
 */
export function useStartStream() {
  const call = useSponsoredCall();
  const refresh = useRefreshStreams();

  return useMutation({
    mutationFn: async (input: StartStreamInput) => {
      if (input.ratePerSecond <= 0n) {
        throw new Error(
          "That is too little to spread over this long. Raise the amount or choose a shorter period."
        );
      }
      if (input.depositPaise <= 0n) {
        throw new Error("Put some money in to start it off.");
      }

      if (input.allowance < input.depositPaise) {
        await call({
          address: TEST_RUPEE_ADDRESS,
          abi: testRupeeAbi,
          functionName: "approve",
          args: [SALARY_STREAM_ADDRESS, maxUint256],
        });
      }

      const endTime = BigInt(
        Math.floor(Date.now() / 1000) + Math.floor(input.durationSeconds)
      );

      const receipt = await call({
        address: SALARY_STREAM_ADDRESS,
        abi: salaryStreamAbi,
        functionName: "createAndFundStream",
        args: [
          input.employee,
          input.ratePerSecond,
          0n,
          endTime,
          input.depositPaise,
        ],
      });

      const events = parseEventLogs({
        abi: salaryStreamAbi,
        eventName: "StreamCreated",
        logs: receipt.logs,
      });
      const created = events[0];
      if (!created) {
        throw new Error("That was set up but we couldn't read it back.");
      }

      return { streamId: Number(created.args.streamId) };
    },
    onSuccess: ({ streamId }) => refresh(streamId),
  });
}

/**
 * Put more money in, which extends how long pay keeps building up.
 *
 * It cannot back-pay a stretch the arrangement was out of money for — the
 * contract settles before adding — and the screen says so, because somebody
 * topping up after a dry week would otherwise expect that week to be paid.
 */
export function useAddStreamFunds() {
  const call = useSponsoredCall();
  const refresh = useRefreshStreams();

  return useMutation({
    mutationFn: async (input: {
      streamId: number;
      amountPaise: bigint;
      allowance: bigint;
    }) => {
      if (input.amountPaise <= 0n) throw new Error("Enter an amount first.");

      if (input.allowance < input.amountPaise) {
        await call({
          address: TEST_RUPEE_ADDRESS,
          abi: testRupeeAbi,
          functionName: "approve",
          args: [SALARY_STREAM_ADDRESS, maxUint256],
        });
      }

      await call({
        address: SALARY_STREAM_ADDRESS,
        abi: salaryStreamAbi,
        functionName: "topUp",
        args: [BigInt(input.streamId), input.amountPaise],
      });
      return input.streamId;
    },
    onSuccess: (streamId) => refresh(streamId),
  });
}

/** Take everything that has built up. Only the person being paid can. */
export function useWithdrawPay() {
  const call = useSponsoredCall();
  const refresh = useRefreshStreams();

  return useMutation({
    mutationFn: async (streamId: number) => {
      await call({
        address: SALARY_STREAM_ADDRESS,
        abi: salaryStreamAbi,
        functionName: "withdraw",
        args: [BigInt(streamId)],
      });
      return streamId;
    },
    onSuccess: (streamId) => refresh(streamId),
  });
}

/**
 * Stop the clock from now on. Nothing already built up is affected.
 *
 * The contract also lets *anyone* pause an arrangement whose money is nearly
 * gone. That power is not offered to the person being paid, and the omission is
 * deliberate rather than an oversight: pausing would stop their own pay
 * building up, and it protects them from nothing, because accrual is already
 * capped at the funded balance — they can never be shown pay that is not there.
 * It exists in the contract as a backstop, not as a button.
 */
export function usePauseStream() {
  const call = useSponsoredCall();
  const refresh = useRefreshStreams();

  return useMutation({
    mutationFn: async (streamId: number) => {
      await call({
        address: SALARY_STREAM_ADDRESS,
        abi: salaryStreamAbi,
        functionName: "pauseStream",
        args: [BigInt(streamId)],
      });
      return streamId;
    },
    onSuccess: (streamId) => refresh(streamId),
  });
}

/** Start the clock again. Paused time is never paid for afterwards. */
export function useResumeStream() {
  const call = useSponsoredCall();
  const refresh = useRefreshStreams();

  return useMutation({
    mutationFn: async (streamId: number) => {
      await call({
        address: SALARY_STREAM_ADDRESS,
        abi: salaryStreamAbi,
        functionName: "resumeStream",
        args: [BigInt(streamId)],
      });
      return streamId;
    },
    onSuccess: (streamId) => refresh(streamId),
  });
}

/**
 * End it. Everything already built up stays the other person's to take; only
 * the part that was never earned comes back to the payer.
 *
 * Also how the payer collects the remainder after the end date.
 */
export function useCloseStream() {
  const call = useSponsoredCall();
  const refresh = useRefreshStreams();

  return useMutation({
    mutationFn: async (streamId: number) => {
      await call({
        address: SALARY_STREAM_ADDRESS,
        abi: salaryStreamAbi,
        functionName: "cancelStream",
        args: [BigInt(streamId)],
      });
      return streamId;
    },
    onSuccess: (streamId) => refresh(streamId),
  });
}

/* ═══════════════════════════ errors ═══════════════════════════ */

/**
 * SalaryStream's named errors, as sentences.
 *
 * Kept here rather than added to `readableError` in `lib/tx.ts`: that map is
 * PotManager's and every feature adding its own names to it would make one file
 * that every screen has to import. This checks its own names first and then
 * hands anything else — a cancelled signature, an unsponsored fee, an ERC-20
 * complaint — to the shared map, which already says those well.
 */
export function streamError(err: unknown): string {
  const raw =
    err instanceof Error ? err.message : typeof err === "string" ? err : "";

  const map: Record<string, string> = {
    StreamNotFound: "We couldn't find that arrangement.",
    WrongState:
      "That can't be done now — this one is already paused, or it has been closed.",
    NotEmployer: "Only the person paying can do that.",
    NotEmployee: "Only the person being paid can take this money.",
    SelfStream: "Pick somebody else — you can't set this up with yourself.",
    ZeroRate:
      "That is too little to spread over this long. Raise the amount or choose a shorter period.",
    ZeroAmount: "Enter an amount first.",
    ZeroAddress: "Choose who is being paid.",
    BadWindow: "Pick a length between one hour and ten years.",
    UnderfundedStart: "Put some money in to start it off.",
    NothingToWithdraw: "Nothing has built up to take yet.",
    RunwayNotLow: "There is still plenty of money in this one.",
  };

  for (const [name, message] of Object.entries(map)) {
    if (raw.includes(name)) return message;
  }
  return readableError(err);
}

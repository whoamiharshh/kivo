"use client";

/**
 * Share what you earn — the data layer for IncomeShare.
 *
 * ──────────────── what this reads and writes, and what it does not ────────────────
 *
 * IncomeShare is a ledger. It holds no money, so nothing here moves any. What
 * this file can do against the contract today:
 *
 *  - **create** an agreement (anyone may; it binds nobody to anything),
 *  - **read** agreements, their repayments and what is left to the cap,
 *  - **close** one whose cap is reached or whose term has run out
 *    (permissionless, because both are objective).
 *
 * What it deliberately cannot do: **record a repayment.** `recordRepayment` is
 * restricted to the contract's immutable `recorder`, and on the current
 * deployment that is the trust signer — a key that is treated as compromised and
 * is switched off. There is no hook for it here because there is nothing true to
 * put in one: a button that "recorded" a repayment without the recorder would be
 * showing something that did not happen. `RECORDING_UNAVAILABLE` says so on
 * screen, and the day a fresh recorder is deployed the hook goes here.
 *
 * ──────────────── numbering ────────────────
 *
 * `createAgreement` does `agreementId = agreementCount++`, so agreements are
 * numbered from **0**. That is the opposite of a pot's repayments, which start
 * at 1 — see `spendIdAt` in `lib/activity.ts`. The two are easy to confuse.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { parseEventLogs, type PublicClient } from "viem";
import { INCOME_SHARE_ADDRESS, incomeShareAbi, ready } from "../contracts";
import { hashMemo } from "../actions";
import { loadDisplayNames, loadMemos, saveMemo } from "../store";
import { useAppWallet, useSponsoredCall } from "../tx";
import {
  AgreementState,
  MAX_PERCENT,
  MIN_PERCENT,
  shortAddress,
  type Agreement,
  type AgreementView,
  type Repayment,
} from "./agreement-state";

export * from "./agreement-state";

/**
 * Newest agreements checked per refresh. Like pot discovery, the scan is one
 * read per agreement, so cost grows with how many exist. Fine for a demo.
 */
const MAX_AGREEMENTS_SCANNED = 100;

/** Said wherever somebody might expect a repayment to be recordable. */
export const RECORDING_UNAVAILABLE =
  "Recording a repayment can't be done on this test setup. Only a licensed partner's own key is allowed to record one, and there is no partner on this setup. Nothing has been recorded, and nothing here pretends otherwise.";

/* ═══════════════════════════ reads ═══════════════════════════ */

/** Every agreement the signed-in person is a party to, newest first. */
export function useMyAgreements() {
  const { address } = useAppWallet();
  const client = usePublicClient();

  return useQuery({
    queryKey: ["agreements", address],
    enabled: Boolean(address && client && ready.agreements),
    refetchInterval: 30_000,
    queryFn: async (): Promise<AgreementView[]> => {
      if (!client || !address) return [];
      return loadAgreements(client as PublicClient, address);
    },
  });
}

/** One agreement, or null if it does not exist or the viewer is not a party. */
export function useAgreement(agreementId: number | undefined) {
  const { address } = useAppWallet();
  const client = usePublicClient();

  return useQuery({
    queryKey: ["agreement", agreementId, address],
    enabled: Boolean(
      agreementId !== undefined && client && address && ready.agreements
    ),
    refetchInterval: 30_000,
    queryFn: async (): Promise<AgreementView | null> => {
      if (!client || !address || agreementId === undefined) return null;
      const row = await readAgreement(client as PublicClient, agreementId);
      if (!row) return null;
      const [view] = await decorate(address, [{ id: agreementId, row }]);
      return view ?? null;
    },
  });
}

/** The repayments on record for one agreement, oldest first. */
export function useRepayments(agreementId: number | undefined, count: number) {
  const client = usePublicClient();

  return useQuery({
    queryKey: ["agreement-repayments", agreementId, count],
    enabled: Boolean(
      agreementId !== undefined && client && ready.agreements && count > 0
    ),
    refetchInterval: 45_000,
    queryFn: async (): Promise<Repayment[]> => {
      if (!client || agreementId === undefined) return [];
      // Repayments are numbered from 0: `index = a.repaymentCount`.
      const indexes = Array.from({ length: count }, (_, i) => i);
      return (await (client as PublicClient).multicall({
        allowFailure: false,
        contracts: indexes.map((index) => ({
          address: INCOME_SHARE_ADDRESS,
          abi: incomeShareAbi,
          functionName: "getRepayment" as const,
          args: [BigInt(agreementId), BigInt(index)],
        })),
      })) as unknown as Repayment[];
    },
  });
}

/* ═══════════════════════════ reads, shared ═══════════════════════════ */

async function readAgreement(
  client: PublicClient,
  agreementId: number
): Promise<Agreement | null> {
  try {
    const row = (await client.readContract({
      address: INCOME_SHARE_ADDRESS,
      abi: incomeShareAbi,
      functionName: "getAgreement",
      args: [BigInt(agreementId)],
    })) as unknown as Agreement;
    return row.state === AgreementState.None ? null : row;
  } catch (err) {
    // `AgreementNotFound` means an id that was never used — that really is
    // "nothing here". Anything else (a dropped connection, a rate limit) is
    // not, and reporting it as "this agreement does not exist" would be a lie.
    const text = err instanceof Error ? `${err.message} ${String(err.cause ?? "")}` : "";
    if (text.includes("AgreementNotFound")) return null;
    throw err;
  }
}

async function loadAgreements(
  client: PublicClient,
  me: `0x${string}`
): Promise<AgreementView[]> {
  const count = Number(
    (await client.readContract({
      address: INCOME_SHARE_ADDRESS,
      abi: incomeShareAbi,
      functionName: "agreementCount",
    })) as bigint
  );
  if (count === 0) return [];

  // Newest first, bounded. Ids run 0..count-1.
  const ids: number[] = [];
  for (let id = count - 1; id >= Math.max(0, count - MAX_AGREEMENTS_SCANNED); id--) {
    ids.push(id);
  }

  const rows = (await client.multicall({
    allowFailure: false,
    contracts: ids.map((id) => ({
      address: INCOME_SHARE_ADDRESS,
      abi: incomeShareAbi,
      functionName: "getAgreement" as const,
      args: [BigInt(id)],
    })),
  })) as unknown as Agreement[];

  const mine = me.toLowerCase();
  const wanted: { id: number; row: Agreement }[] = [];
  ids.forEach((id, i) => {
    const row = rows[i]!;
    if (row.state === AgreementState.None) return;
    if (
      row.funder.toLowerCase() === mine ||
      row.recipient.toLowerCase() === mine
    ) {
      wanted.push({ id, row });
    }
  });
  if (wanted.length === 0) return [];

  return decorate(me, wanted);
}

/** Attach the offchain half: names, and the terms text if this device has it. */
async function decorate(
  me: `0x${string}`,
  rows: { id: number; row: Agreement }[]
): Promise<AgreementView[]> {
  const lower = me.toLowerCase();
  const visible = rows.filter(
    ({ row }) =>
      row.funder.toLowerCase() === lower || row.recipient.toLowerCase() === lower
  );
  if (visible.length === 0) return [];

  const people = visible.flatMap(({ row }) => [row.funder, row.recipient]);
  const [names, texts] = await Promise.all([
    loadDisplayNames(people),
    loadMemos(visible.map(({ row }) => row.agreementHash)),
  ]);

  const nameOf = (a: `0x${string}`) =>
    a.toLowerCase() === lower
      ? "You"
      : (names[a.toLowerCase()] ?? shortAddress(a));

  return visible.map(({ id, row }) => {
    const role = row.recipient.toLowerCase() === lower ? "recipient" : "funder";
    const otherAddress = role === "recipient" ? row.funder : row.recipient;
    const terms = texts[row.agreementHash.toLowerCase()] ?? "";
    return {
      ...row,
      id,
      role,
      otherAddress,
      otherName: nameOf(otherAddress),
      funderName: nameOf(row.funder),
      recipientName: nameOf(row.recipient),
      terms,
      // `null` = nothing on file to check, which is not the same as "wrong".
      termsMatch: terms ? hashMemo(terms) === row.agreementHash : null,
    };
  });
}

/* ═══════════════════════════ writes ═══════════════════════════ */

function useRefreshAgreements() {
  const qc = useQueryClient();
  return (agreementId?: number) => {
    void qc.invalidateQueries({ queryKey: ["agreements"] });
    if (agreementId !== undefined) {
      void qc.invalidateQueries({ queryKey: ["agreement", agreementId] });
      void qc.invalidateQueries({
        queryKey: ["agreement-repayments", agreementId],
      });
    }
  };
}

export type CreateAgreementInput = {
  recipient: `0x${string}`;
  fundingPaise: bigint;
  /** Whole percent of income, 1 to 100. */
  percent: number;
  capPaise: bigint;
  termEndSeconds: number;
  /**
   * The exact terms text that was shown on screen. Hashed as given, never
   * rebuilt, so the hash on record identifies a document both people could read.
   */
  terms: string;
};

/**
 * Record an agreement's terms. This does not fund anything and does not bind
 * the recipient — their confirmation on each repayment is what would.
 *
 * Every rule below is also checked by the contract; repeating them here turns a
 * mistake into a sentence before anything is sent instead of a revert after.
 */
export function useCreateAgreement() {
  const call = useSponsoredCall();
  const { address } = useAppWallet();
  const refresh = useRefreshAgreements();

  return useMutation({
    mutationFn: async (input: CreateAgreementInput): Promise<number> => {
      if (!address) throw new Error("Still setting up your account.");
      if (input.recipient.toLowerCase() === address.toLowerCase()) {
        throw new Error("An agreement has to be with somebody else.");
      }
      if (input.fundingPaise <= 0n) throw new Error("Enter how much is being funded.");
      if (
        !Number.isInteger(input.percent) ||
        input.percent < MIN_PERCENT ||
        input.percent > MAX_PERCENT
      ) {
        throw new Error(`The share has to be between ${MIN_PERCENT}% and ${MAX_PERCENT}%.`);
      }
      if (input.capPaise < input.fundingPaise) {
        throw new Error(
          "The most that can be repaid has to be at least what was funded — otherwise it is a gift, not a share."
        );
      }
      if (input.termEndSeconds <= Math.floor(Date.now() / 1000)) {
        throw new Error("The end date has to be in the future.");
      }
      if (!input.terms.trim()) throw new Error("There is no wording to record.");

      const agreementHash = hashMemo(input.terms);

      const receipt = await call({
        address: INCOME_SHARE_ADDRESS,
        abi: incomeShareAbi,
        functionName: "createAgreement",
        args: [
          input.recipient,
          input.fundingPaise,
          BigInt(input.percent),
          input.capPaise,
          BigInt(input.termEndSeconds),
          agreementHash,
        ],
      });

      const created = parseEventLogs({
        abi: incomeShareAbi,
        eventName: "AgreementCreated",
        logs: receipt.logs,
      })[0];
      if (!created) {
        throw new Error("It was recorded, but we couldn't read it back.");
      }

      // After the agreement exists, not before: wording stored for something
      // that was never recorded would be a phantom. A failure to save must not
      // turn a record that IS on chain into an error toast — a retry would
      // record a second, duplicate agreement.
      try {
        await saveMemo(agreementHash, input.terms);
      } catch {
        /* the agreement exists; only its wording failed to save */
      }

      return Number((created.args as { agreementId: bigint }).agreementId);
    },
    onSuccess: (agreementId) => refresh(agreementId),
  });
}

/**
 * Close out an agreement whose cap is reached or whose term is over.
 * Permissionless in the contract: both conditions are facts, not decisions.
 */
export function useCloseAgreement() {
  const call = useSponsoredCall();
  const refresh = useRefreshAgreements();

  return useMutation({
    mutationFn: async (agreementId: number) => {
      await call({
        address: INCOME_SHARE_ADDRESS,
        abi: incomeShareAbi,
        functionName: "markComplete",
        args: [BigInt(agreementId)],
      });
      return agreementId;
    },
    onSuccess: (agreementId) => refresh(agreementId),
  });
}

/* ═══════════════════════════ errors ═══════════════════════════ */

/** One sentence per rule this feature can break. */
export function agreementError(err: unknown): string {
  const raw =
    err instanceof Error ? `${err.message}` : typeof err === "string" ? err : "";

  const map: Record<string, string> = {
    AgreementNotFound: "We couldn't find that agreement.",
    WrongState: "That can't be done to this agreement now. Reload and look again.",
    NotRecorder:
      "Only the licensed partner can record a repayment, and that isn't available here.",
    ZeroAddress: "Choose who the agreement is with.",
    SelfAgreement: "An agreement has to be with somebody else.",
    ZeroAmount: "Enter how much is being funded.",
    BadPercent: "The share has to be between 1% and 100%.",
    BadCap:
      "The most that can be repaid has to be at least what was funded.",
    TermInPast: "The end date has to be in the future.",
    AgreementHashRequired: "There is no wording to record.",
    CapExceeded: "That would go over the most that can be repaid.",
    BadConfirmation: "The recipient's confirmation didn't match, so nothing was recorded.",
    NotFinishedYet:
      "It can't be closed yet — the cap hasn't been reached and the term hasn't ended.",
  };

  for (const [name, message] of Object.entries(map)) {
    if (raw.includes(name)) return message;
  }
  if (/user rejected|denied/i.test(raw)) return "Cancelled.";
  if (/insufficient funds/i.test(raw)) {
    return "Fees aren't being covered right now — check fee sponsorship is on.";
  }
  if (err instanceof Error && /[a-z] [a-z]/.test(err.message)) return err.message;
  return "Something went wrong. Please try again.";
}

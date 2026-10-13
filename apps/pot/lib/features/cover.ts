"use client";

/**
 * Small-ticket cover — the data layer for MicroCover.
 *
 * ──────────────── what the contract actually does ────────────────
 *
 * You pay a premium and the contract *holds* it. Nothing is covered yet. An
 * insurer then either takes on the risk, at which point cover runs between the
 * two dates you chose, or never does, at which point you take the premium back.
 * If something happens you record a claim, and money moves only when the
 * insurer's own key has signed for that exact amount against that exact claim.
 * The contract decides nothing: it escrows, records, and pays what it is told
 * to pay by a signature it can check.
 *
 * ──────────────── the one thing this UI must never blur ────────────────
 *
 * There are two states that both feel like "I bought cover" and only one of
 * them is cover. A premium sitting in escrow buys nothing at all, and a policy
 * that is `Active` but has not reached its start date covers nothing today.
 * Both have to read as *not covered*, in those words, because a person who
 * believes they are covered when they are not has been actively misled — and
 * that mistake is worth more to them than every other bug in this feature.
 *
 * ──────────────── and the part that is a demonstration ────────────────
 *
 * There is no insurer. `docs/insurer-api.md` says so in its own status table:
 * no licensed partner, both insurer roles defaulting to the deployer on
 * testnet, the HTTP endpoints specified and not implemented. The decision that
 * releases a payout here comes from `/api/trust/attest-oracle`, which is a
 * button somebody presses, recorded as `source: 'simulated'` for good. Every
 * screen in this feature says that; see `DISCLOSURE` in `cover-state.ts`.
 *
 * ──────────────── why this file is separate ────────────────
 *
 * One file per feature under lib/features/ keeps a screen's bundle to the
 * contract it actually talks to, instead of every screen importing every
 * feature's event list through `lib/queries.ts`.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { maxUint256, type PublicClient } from "viem";
import {
  MICRO_COVER_ADDRESS,
  TEST_RUPEE_ADDRESS,
  microCoverAbi,
  ready,
  testRupeeAbi,
} from "../contracts";
import { hashMemo } from "../actions";
import { loadMemos, saveMemo } from "../store";
import { attestOracle, TrustCallError } from "../trust/client";
import { useAppWallet, useSponsoredCall } from "../tx";

/**
 * Re-exported so client code has one import. The definitions live in
 * `cover-state.ts` because this module is "use client" and a Server Component
 * cannot call anything exported from here — see that file's header.
 */
export {
  BIND_WINDOW_SECONDS,
  CLAIM_WINDOW_SECONDS,
  ClaimState,
  COVER_SHAPES,
  DISCLOSURE,
  EXPOSURE_CAVEAT,
  MAX_DURATION_SECONDS,
  MIN_DURATION_SECONDS,
  PERIODS,
  PolicyState,
  claimWindowEnd,
  coverInForce,
  describe,
  momentLabel,
  pendingAction,
  refundOpensAt,
  relativeLabel,
  shortAddress,
} from "./cover-state";
export type {
  Claim,
  ClaimStateValue,
  CoverShape,
  PeriodChoice,
  Policy,
  PolicyStateValue,
  PolicyView,
} from "./cover-state";

import {
  allPolicyIds,
  ClaimState,
  MAX_DURATION_SECONDS,
  MIN_DURATION_SECONDS,
  PolicyState as State,
  type Claim as ClaimRow,
  type Policy as PolicyRow,
  type PolicyView as View,
} from "./cover-state";

/**
 * The event type recorded against a decision.
 *
 * `oracle_events` is unique on `(policy_id, event_type)`, so a fixed string
 * means one decision per policy and a second attempt comes back as "already
 * decided" rather than quietly producing a second payout authorisation.
 */
const EVENT_TYPE = "cover_claim";


/* ═══════════════════════════ reads ═══════════════════════════ */

/**
 * Every policy the signed-in person is part of, newest first.
 *
 * Found from events rather than by walking `policyCount`, because a policy
 * concerns two people — the insured and whoever paid for them — and only the
 * logs know which. Two indexed scans beat reading every policy ever written and
 * filtering in the browser.
 */
export function useMyPolicies() {
  const { address } = useAppWallet();
  const client = usePublicClient();

  return useQuery({
    queryKey: ["policies", address],
    enabled: Boolean(address && client && ready.policies),
    refetchInterval: 30_000,
    queryFn: async (): Promise<View[]> => {
      if (!client || !address) return [];
      return loadPolicies(client as PublicClient, address);
    },
  });
}

/** One policy, with its claim, its wording and its evidence resolved. */
export function usePolicy(policyId: number | undefined) {
  const { address } = useAppWallet();
  const client = usePublicClient();

  return useQuery({
    queryKey: ["policy", policyId, address],
    enabled: Boolean(
      policyId !== undefined && client && address && ready.policies
    ),
    refetchInterval: 24_000,
    queryFn: async (): Promise<View | null> => {
      if (!client || !address || policyId === undefined) return null;
      const rows = await readPolicies(client as PublicClient, [policyId]);
      const row = rows[0];
      if (!row || row.policy.state === State.None) return null;
      const [view] = await decorate(address, [row]);
      return view ?? null;
    },
  });
}

/**
 * What happened to one policy, oldest first, for its detail screen.
 *
 * ──────────────── read from the policy, not replayed ────────────────
 *
 * This was seven parallel log scans. Monad's RPC caps a scan at 100 blocks
 * and answers HTTP 413 beyond it, so all seven failed on every poll and the
 * history was permanently empty. A policy's course is implied by its state
 * and whether a claim sits on it, so it is derived instead.
 *
 * The cost, said rather than hidden: there are no times. The feed is ordered,
 * not dated, and no line claims an hour it cannot know.
 */
export function usePolicyActivity(policyId: number | undefined) {
  const client = usePublicClient();

  return useQuery({
    queryKey: ["policy-activity", policyId],
    enabled: Boolean(policyId !== undefined && client && ready.policies),
    refetchInterval: 45_000,
    queryFn: async (): Promise<ActivityEntry[]> => {
      if (!client || policyId === undefined) return [];

      const rows = await readPolicies(client as PublicClient, [policyId]);
      const row = rows[0];
      if (!row || row.policy.state === State.None) return [];

      const { policy, claim } = row;
      const entries: ActivityEntry[] = [
        { kind: "created", key: `created-${policyId}` },
      ];

      if (policy.state === State.Active) {
        entries.push({ kind: "activated", key: `activated-${policyId}` });
      }
      if (policy.state === State.Refunded) {
        entries.push({ kind: "refunded", key: `refunded-${policyId}` });
      }

      // A claim only exists once somebody submitted one, so its presence is
      // the event. How it ended is read from the claim itself.
      if (claim && claim.state !== ClaimState.None) {
        entries.push({ kind: "claimed", key: `claimed-${policyId}` });
        if (claim.state === ClaimState.Paid) {
          entries.push({ kind: "paid", key: `paid-${policyId}` });
        }
        if (claim.state === ClaimState.Declined) {
          entries.push({ kind: "declined", key: `declined-${policyId}` });
        }
      }

      if (policy.state === State.Closed) {
        entries.push({ kind: "closed", key: `closed-${policyId}` });
      }

      return entries;
    },
  });
}

/** One line of a policy's history. Ordered by position; it carries no time. */
export type ActivityEntry = {
  kind:
    | "created"
    | "activated"
    | "refunded"
    | "closed"
    | "claimed"
    | "paid"
    | "declined";
  key: string;
};


/**
 * Who the insurer is on this deployment, and whether it happens to be you.
 *
 * Needed for one honest reason: on testnet both insurer roles default to the
 * deployer (`docs/insurer-api.md`, status table), so the person demonstrating
 * this app is usually also the stand-in insurer. Rather than leave every policy
 * stuck in escrow with no way to show what binding looks like, the detail
 * screen offers the insurer's own actions — clearly labelled as the stand-in
 * they are — when the signed-in address is that address.
 *
 * `insurerSigner` is read alongside it because the two being the same address
 * is itself worth saying: a deployment where the treasury key is also the
 * claims-signing key has lost the separation the contract was built to keep.
 */
export function useInsurerRole() {
  const { address } = useAppWallet();
  const client = usePublicClient();

  return useQuery({
    queryKey: ["cover-insurer", address],
    enabled: Boolean(client && ready.policies),
    refetchInterval: 45_000,
    queryFn: async () => {
      const c = client as PublicClient;
      const [insurer, insurerSigner, reserve, committed] = await c.multicall({
        allowFailure: false,
        contracts: [
          {
            address: MICRO_COVER_ADDRESS,
            abi: microCoverAbi,
            functionName: "insurer",
          },
          {
            address: MICRO_COVER_ADDRESS,
            abi: microCoverAbi,
            functionName: "insurerSigner",
          },
          {
            address: MICRO_COVER_ADDRESS,
            abi: microCoverAbi,
            functionName: "reserve",
          },
          {
            address: MICRO_COVER_ADDRESS,
            abi: microCoverAbi,
            functionName: "committed",
          },
        ],
      });

      const insurerAddress = insurer as `0x${string}`;
      return {
        insurer: insurerAddress,
        insurerSigner: insurerSigner as `0x${string}`,
        /** Money put up to pay claims, in paise. */
        reserve: reserve as bigint,
        /** The part of it already promised to live cover. */
        committed: committed as bigint,
        /** What a new policy can be bound against. */
        available: (reserve as bigint) - (committed as bigint),
        iAmTheInsurer: Boolean(
          address && address.toLowerCase() === insurerAddress.toLowerCase()
        ),
      };
    },
  });
}

/* ═══════════════════════════ reads, shared ═══════════════════════════ */

async function loadPolicies(
  client: PublicClient,
  me: `0x${string}`
): Promise<View[]> {
  // Read, don't replay. Monad's RPC refuses any log scan wider than 100
  // blocks — HTTP 413, `eth_getLogs is limited to a 100 range` — and the
  // deploy block is far further back than that and receding by about 216,000
  // blocks a day, so finding policies by their `PolicyCreated` event stopped
  // being possible minutes after launch. `policyCount()` says how many exist
  // and each `getPolicy` names both the insured and whoever paid.
  const count = Number(
    (await client.readContract({
      address: MICRO_COVER_ADDRESS,
      abi: microCoverAbi,
      functionName: "policyCount",
    })) as bigint
  );
  if (count === 0) return [];

  // 1..count, not 0..count-1: MicroCover numbers policies from 1, and
  // getPolicy(0) reverts — which would fail this whole batched read.
  const everyId = allPolicyIds(count);
  const everyPolicy = (await client.multicall({
    allowFailure: false,
    contracts: everyId.map((id) => ({
      address: MICRO_COVER_ADDRESS,
      abi: microCoverAbi,
      functionName: "getPolicy" as const,
      args: [BigInt(id)],
    })),
  })) as unknown as { insured: string; payer: string; state: number }[];

  // Buying your own cover makes you both the insured and the payer, which is
  // one policy and not two.
  const mine = me.toLowerCase();
  const ids = everyId.filter((_, i) => {
    const row = everyPolicy[i]!;
    if (row.state === State.None) return false;
    return (
      row.insured.toLowerCase() === mine || row.payer.toLowerCase() === mine
    );
  });
  if (ids.length === 0) return [];

  const rows = await readPolicies(client, ids);
  const views = await decorate(me, rows);
  return views.sort((a, b) => Number(b.createdAt - a.createdAt));
}

/**
 * The policy and its claim, for a list of ids, in one round trip.
 *
 * Every row needs two reads — a policy means little without knowing whether a
 * claim is sitting on it — so twenty policies would be forty requests done one
 * at a time. One multicall is one request.
 */
async function readPolicies(
  client: PublicClient,
  ids: number[]
): Promise<{ id: number; policy: PolicyRow; claim: ClaimRow }[]> {
  const results = await client.multicall({
    allowFailure: false,
    contracts: ids.flatMap((id) => [
      {
        address: MICRO_COVER_ADDRESS,
        abi: microCoverAbi,
        functionName: "getPolicy" as const,
        args: [BigInt(id)],
      },
      {
        address: MICRO_COVER_ADDRESS,
        abi: microCoverAbi,
        functionName: "getClaim" as const,
        args: [BigInt(id)],
      },
    ]),
  });

  return ids.map((id, i) => ({
    id,
    policy: results[i * 2] as unknown as PolicyRow,
    claim: results[i * 2 + 1] as unknown as ClaimRow,
  }));
}

/**
 * Attach the off-chain half: the words behind the two hashes.
 *
 * What a policy covers and what a claim says are text, and text does not
 * belong on a public chain — only its fingerprint does. Both are looked up in
 * one batch rather than per row, so a list of twenty policies is one request
 * and not forty.
 */
async function decorate(
  me: `0x${string}`,
  rows: { id: number; policy: PolicyRow; claim: ClaimRow }[]
): Promise<View[]> {
  const lower = me.toLowerCase();

  const texts = await loadMemos([
    ...rows.map((r) => r.policy.policyTermsHash),
    ...rows.map((r) => r.claim.evidenceHash),
  ]);

  return rows.map((r) => ({
    ...r.policy,
    id: r.id,
    claim: r.claim,
    // loadMemos lowercases its keys, so these lookups have to as well.
    terms: texts[r.policy.policyTermsHash.toLowerCase()] ?? "",
    evidence: texts[r.claim.evidenceHash.toLowerCase()] ?? "",
    insuredIsMe: r.policy.insured.toLowerCase() === lower,
    payerIsMe: r.policy.payer.toLowerCase() === lower,
  }));
}

/* ═══════════════════════════ writes ═══════════════════════════ */

function useRefreshCover() {
  const qc = useQueryClient();
  return (policyId?: number) => {
    void qc.invalidateQueries({ queryKey: ["token-state"] });
    void qc.invalidateQueries({ queryKey: ["test-money"] });
    void qc.invalidateQueries({ queryKey: ["policies"] });
    void qc.invalidateQueries({ queryKey: ["cover-insurer"] });
    if (policyId !== undefined) {
      void qc.invalidateQueries({ queryKey: ["policy", policyId] });
      void qc.invalidateQueries({ queryKey: ["policy-activity", policyId] });
    }
  };
}

export type TakeOutCoverInput = {
  /** What the cover says, in the person's own words. Only its hash goes out. */
  terms: string;
  premiumPaise: bigint;
  coveragePaise: bigint;
  /** How long the cover runs, in seconds. Starts when the request lands. */
  durationSeconds: number;
  /** Current allowance, so the one-time approval only ever happens once. */
  allowance: bigint;
};

/**
 * Take out cover: pay the premium into escrow.
 *
 * The one-time approval is folded into the same action rather than shown as a
 * separate step, exactly as `useSendPayment` does. A person taking out cover
 * has one intention, and asking them to authorise something they never asked
 * about is the clearest possible signal that there is a chain under here.
 *
 * Every rule checked below is also checked by the contract. They are repeated
 * here so a mistake comes back as a sentence before anything is sent, instead
 * of as a revert thirty seconds later.
 */
export function useTakeOutCover() {
  const call = useSponsoredCall();
  const { address } = useAppWallet();
  const refresh = useRefreshCover();

  return useMutation({
    mutationFn: async (input: TakeOutCoverInput) => {
      if (!address) throw new Error("Still setting up your account.");

      const terms = input.terms.trim();
      // `policyTermsHash == 0` reverts ZeroHash: cover with no wording behind
      // it is not cover, and the contract refuses to record one.
      if (!terms) throw new Error("Say what this cover is for first.");
      if (input.premiumPaise <= 0n) throw new Error("Enter a premium.");
      if (input.coveragePaise <= input.premiumPaise) {
        throw new Error(
          "The cover amount has to be more than the premium — otherwise it is worse than paying nothing."
        );
      }
      if (
        input.durationSeconds < MIN_DURATION_SECONDS ||
        input.durationSeconds > MAX_DURATION_SECONDS
      ) {
        throw new Error("Pick a period between 10 minutes and a year.");
      }

      if (input.allowance < input.premiumPaise) {
        await call({
          address: TEST_RUPEE_ADDRESS,
          abi: testRupeeAbi,
          functionName: "approve",
          args: [MICRO_COVER_ADDRESS, maxUint256],
        });
      }

      const termsHash = hashMemo(terms);

      // The start is read at submit, not at render: a form left open for ten
      // minutes must not ask for cover that began before the request landed.
      const start = BigInt(Math.floor(Date.now() / 1000));
      const end = start + BigInt(input.durationSeconds);

      const receipt = await call({
        address: MICRO_COVER_ADDRESS,
        abi: microCoverAbi,
        functionName: "createPolicy",
        args: [
          address,
          input.premiumPaise,
          input.coveragePaise,
          start,
          end,
          termsHash,
        ],
      });

      // Saved after the premium is actually escrowed, not before: wording
      // stored for a policy that never existed would show up as a phantom.
      // A failure to save must not turn a premium that IS in holding into an
      // error toast — a retry would hold a second premium.
      try {
        await saveMemo(termsHash, terms);
      } catch {
        /* the policy exists; only its wording failed to save */
      }

      return receipt;
    },
    onSuccess: () => refresh(),
  });
}

export type RaiseClaimInput = {
  policyId: number;
  /** What happened, in the person's own words. Only its hash goes out. */
  account: string;
};

/**
 * Record a claim against cover that is in force.
 *
 * `evidenceHash` is the contract's entire notion of a claim, and here it
 * commits to a sentence somebody typed. In a real product it commits to a
 * bundle of files — a photo, a repair bill, an assessor's report — held in
 * Storage and hashed in order (`docs/insurer-api.md`, §4.1). This app has no
 * upload path, so the screens say the hash covers words and nothing else
 * rather than implying evidence was attached.
 */
export function useRaiseClaim() {
  const call = useSponsoredCall();
  const refresh = useRefreshCover();

  return useMutation({
    mutationFn: async (input: RaiseClaimInput) => {
      const account = input.account.trim();
      if (!account) throw new Error("Say what happened first.");

      const evidenceHash = hashMemo(account);

      // Saved first, unusually: the trigger step reads the claim's hash back
      // off the chain, and a claim whose words nobody kept is unreadable
      // afterwards. A saved description with no claim behind it is harmless —
      // nothing lists it — whereas the reverse loses what a person wrote.
      await saveMemo(evidenceHash, account);

      await call({
        address: MICRO_COVER_ADDRESS,
        abi: microCoverAbi,
        functionName: "submitClaim",
        args: [BigInt(input.policyId), evidenceHash],
      });

      return input.policyId;
    },
    onSuccess: (policyId) => refresh(policyId),
  });
}

export type DecideClaimInput = {
  policyId: number;
  /** Whether the thing covered is being recorded as having happened. */
  happened: boolean;
  /** What to pay, in paise. Ignored when `happened` is false. */
  payoutPaise: bigint;
};

/**
 * Press the trigger, and settle the claim if it authorises a payout.
 *
 * ──────────────── two halves, and why they are in one action ────────────────
 *
 * The decision and the payment are separate things. `/api/trust/attest-oracle`
 * produces an authorisation — a signature over this contract, this chain, this
 * policy, this claim's evidence hash and this exact amount — and `settleClaim`
 * is what turns one into money. They are one action here because a person who
 * has been approved should not have to tap again to be paid, and because a
 * signature with nothing done about it is a worse state than either end.
 *
 * ──────────────── the honest part ────────────────
 *
 * On a real product that signature comes from an IRDAI-licensed insurer's
 * claims-signing key, and producing it **is** the regulated act of
 * adjudicating a claim. Here it comes from a button. The route records
 * `source: 'simulated'`, the screen says so, and this comment exists so nobody
 * reading the code mistakes the plumbing for an insurer.
 *
 * A declined decision deliberately comes back with **no signature** — the
 * `OracleOutcome` union forces that to be handled rather than letting an
 * `undefined` reach a contract call. There is a real consequence, stated on
 * screen: with no signature there is nothing to settle, so a declined claim
 * stays recorded as a claim and the cover cannot be closed here.
 */
export function useDecideClaim() {
  const call = useSponsoredCall();
  const refresh = useRefreshCover();

  return useMutation({
    mutationFn: async (
      input: DecideClaimInput
    ): Promise<{ declined: boolean; paidPaise: bigint }> => {
      if (input.happened && input.payoutPaise <= 0n) {
        throw new Error("A payout of nothing is not a payout.");
      }

      const outcome = await attestOracle({
        policyId: input.policyId,
        eventType: EVENT_TYPE,
        eventOccurred: input.happened,
        ...(input.happened ? { payoutPaise: input.payoutPaise } : {}),
      });

      if (outcome.declined) return { declined: true, paidPaise: 0n };

      // The amount is taken from the authorisation, not from the form. The
      // signature is bound to one exact figure, so sending anything else would
      // revert BadInsurerSignature — and if the two ever disagree, the signed
      // one is the only one that means anything.
      const paidPaise = BigInt(outcome.payoutPaise);

      await call({
        address: MICRO_COVER_ADDRESS,
        abi: microCoverAbi,
        functionName: "settleClaim",
        args: [BigInt(input.policyId), paidPaise, outcome.signature],
      });

      return { declined: false, paidPaise };
    },
    onSuccess: (_result, input) => refresh(input.policyId),
  });
}

/**
 * Take the premium back when nobody took on the risk.
 *
 * Permissionless in the contract, which is the point: the payer never needs
 * the insurer's cooperation to recover money that bought them nothing.
 */
export function useTakeBackPremium() {
  const call = useSponsoredCall();
  const refresh = useRefreshCover();

  return useMutation({
    mutationFn: async (policyId: number) => {
      await call({
        address: MICRO_COVER_ADDRESS,
        abi: microCoverAbi,
        functionName: "refundUnboundPremium",
        args: [BigInt(policyId)],
      });
      return policyId;
    },
    onSuccess: (policyId) => refresh(policyId),
  });
}

/**
 * Close cover that ended with no claim, releasing what was held behind it.
 *
 * Also permissionless. Nothing about it is a decision — the reporting window
 * closing is a date — so whoever is looking at the screen can do it.
 */
export function useCloseEndedCover() {
  const call = useSponsoredCall();
  const refresh = useRefreshCover();

  return useMutation({
    mutationFn: async (policyId: number) => {
      await call({
        address: MICRO_COVER_ADDRESS,
        abi: microCoverAbi,
        functionName: "closeExpiredPolicy",
        args: [BigInt(policyId)],
      });
      return policyId;
    },
    onSuccess: (policyId) => refresh(policyId),
  });
}

/* ═════════════════ the stand-in insurer's own actions ═════════════════ */

/**
 * Take on the risk, so cover actually starts.
 *
 * Insurer-only in the contract, and it refuses unless the money behind the
 * cover is already there and unpromised. Offered in the UI only to the address
 * that is the insurer on this deployment — which on testnet is the deployer,
 * standing in for a licensed insurer that does not exist.
 */
export function useBindCover() {
  const call = useSponsoredCall();
  const refresh = useRefreshCover();

  return useMutation({
    mutationFn: async (policyId: number) => {
      await call({
        address: MICRO_COVER_ADDRESS,
        abi: microCoverAbi,
        functionName: "activatePolicy",
        args: [BigInt(policyId)],
      });
      return policyId;
    },
    onSuccess: (policyId) => refresh(policyId),
  });
}

/** Refuse the risk and hand the premium straight back. */
export function useRefuseCover() {
  const call = useSponsoredCall();
  const refresh = useRefreshCover();

  return useMutation({
    mutationFn: async (policyId: number) => {
      await call({
        address: MICRO_COVER_ADDRESS,
        abi: microCoverAbi,
        functionName: "declineToBind",
        args: [BigInt(policyId)],
      });
      return policyId;
    },
    onSuccess: (policyId) => refresh(policyId),
  });
}

/**
 * Put up the money claims would be paid from.
 *
 * Anyone may do this — a parent company topping up is a good thing and the
 * money can only leave as a signed payout or an unpromised withdrawal to the
 * insurer — but no screen offers it except to the insurer, because for anybody
 * else it would be a gift with no cover attached.
 */
export function useFundPayouts() {
  const call = useSponsoredCall();
  const refresh = useRefreshCover();

  return useMutation({
    mutationFn: async (input: { amountPaise: bigint; allowance: bigint }) => {
      if (input.amountPaise <= 0n) throw new Error("Enter an amount.");
      if (input.allowance < input.amountPaise) {
        await call({
          address: TEST_RUPEE_ADDRESS,
          abi: testRupeeAbi,
          functionName: "approve",
          args: [MICRO_COVER_ADDRESS, maxUint256],
        });
      }
      await call({
        address: MICRO_COVER_ADDRESS,
        abi: microCoverAbi,
        functionName: "fundReserve",
        args: [input.amountPaise],
      });
      return input.amountPaise;
    },
    onSuccess: () => refresh(),
  });
}

/* ═══════════════════════════ errors ═══════════════════════════ */

/**
 * One sentence per rule this feature can break.
 *
 * Kept here rather than added to `readableError` in `lib/tx.ts` because these
 * names belong to one contract: `WrongState` means something different in
 * every feature that has states, and a shared map would have to pick one.
 *
 * The tone is `lib/tx.ts`'s — say what happened and what to do, never name the
 * rule — and none of the banned words appears in any of them.
 */
export function coverError(err: unknown): string {
  // A trust-layer failure already carries a sentence written for a person; it
  // would be a loss to replace it with a generic one.
  if (err instanceof TrustCallError) return err.message;

  const raw =
    err instanceof Error ? `${err.message}` : typeof err === "string" ? err : "";

  const map: Record<string, string> = {
    PolicyNotFound: "We couldn't find that cover.",
    ZeroHash: "Say what this cover is for first.",
    CoverageBelowPremium:
      "The cover amount has to be more than the premium, or it is worse than paying nothing.",
    WindowOutOfRange: "Pick a period between 10 minutes and a year.",
    AlreadyEnded: "That period has already finished.",
    NotInsured: "Only the person covered can claim on this.",
    NotInsurer: "Only the insurer can do that.",
    ReserveTooSmall:
      "There isn't enough money put aside to pay a claim this size, so the risk can't be taken on yet.",
    ReserveCommitted:
      "That money is promised to cover that is still running and can't be taken out.",
    ClaimWindowClosed:
      "The time to claim on this has passed. Claims close 30 days after the cover ends.",
    ClaimWindowOpen:
      "This can't be wrapped up yet — there are still 30 days in which a claim could be made.",
    ClaimAlreadyMade: "A claim has already been made on this cover.",
    NoClaim: "There is no open claim on this cover.",
    PayoutAboveCoverage: "That is more than this cover pays out.",
    BadInsurerSignature:
      "The payout wasn't approved, so nothing was paid. Nothing has changed.",
    TooEarly:
      "Give it a little longer — the premium comes back once the day to take on the risk has passed.",
    WrongState: "That can't be done to this cover now. Reload and look again.",
    ZeroAmount: "Enter an amount first.",
    ZeroAddress: "Something is missing. Please try again.",
    ERC20InsufficientBalance:
      "You don't have enough test money. Collect some first.",
    ERC20InsufficientAllowance:
      "Couldn't move your test money — please try again.",
  };

  for (const [name, message] of Object.entries(map)) {
    if (raw.includes(name)) return message;
  }
  if (/user rejected|denied/i.test(raw)) return "Cancelled.";
  if (/insufficient funds/i.test(raw)) {
    return "Fees aren't being covered right now — check fee sponsorship is on.";
  }
  // A thrown Error from this module is already a sentence for a person, so it
  // is passed through rather than flattened into "something went wrong".
  if (err instanceof Error && /[a-z] [a-z]/.test(err.message)) {
    return err.message;
  }
  return "Something went wrong. Please try again.";
}

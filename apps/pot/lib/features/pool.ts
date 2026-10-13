"use client";

/**
 * Keep each other to it — the data layer for AccountabilityPool.
 *
 * ──────────────── what the contract actually does ────────────────
 *
 * A group of up to twenty people stake the same amount on a shared
 * commitment. Each day, a member marks that they did the thing. At the
 * deadline anybody may tally the pool, and then each member pulls their own
 * money: whoever marked enough days takes their stake back plus a share of the
 * stakes of whoever did not.
 *
 * The thing this layer must never blur is where a payout comes from. **The
 * only source is somebody else's forfeited stake.** No sponsor, no yield, no
 * outside money. If everybody keeps it nobody gains; if nobody keeps it every
 * stake goes home. `docs/limitations.md` says the same about BehaviourSavings
 * and the reasoning is identical here.
 *
 * ──────────────── and what it cannot do ────────────────
 *
 * A marked day is a number a person typed, sent to a server that signs it
 * without checking anything about the world (`app/api/trust/attest-day/route.ts`
 * says so in its own header; `docs/trust-layer.md` §3 lists it under "the
 * person's own typing"). There is no pedometer, no device attestation, no
 * Health Connect. Nothing in this file or the screens above it may say
 * "verified".
 *
 * ──────────────── why this file is separate ────────────────
 *
 * Same reason as `lib/features/pay.ts`: one module per feature keeps each
 * screen's bundle to the contract it actually talks to, instead of every
 * screen importing every feature's event list.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import {
  keccak256,
  maxUint256,
  parseEventLogs,
  stringToHex,
  type PublicClient,
} from "viem";
import {
  ACCOUNTABILITY_POOL_ADDRESS,
  TEST_RUPEE_ADDRESS,
  accountabilityPoolAbi,
  ready,
  testRupeeAbi,
} from "../contracts";
import { loadDisplayNames, loadMemos, saveDisplayName, saveMemo } from "../store";
import { useAppWallet, useSponsoredCall } from "../tx";
import { useNowSeconds } from "../now";
import { TrustCallError } from "../trust/client";
import { getAccessToken, getIdentityToken } from "@privy-io/react-auth";

/**
 * The enums, shapes and pure helpers live in `pool-state.ts` so a Server
 * Component can use them — this module is "use client", and that directive
 * would otherwise make even a pure function unusable from the server. They are
 * re-exported here so client code can keep importing from one place.
 */
export {
  PoolState,
  METRICS,
  MAX_MEMBERS,
  MIN_MEMBERS,
  MIN_DURATION_DAYS,
  MAX_DURATION_DAYS,
  EARLIEST_DEADLINE_DAYS,
  LATEST_DEADLINE_DAYS,
  metricInfo,
  decodePoolNote,
  encodePoolNote,
  poolTitle,
  localDayNumber,
  localDayString,
  lastMarkableDay,
  daysLeftToMark,
  daysBetween,
  daysStillNeeded,
  onTrack,
  outOfTime,
  ruleSentence,
  describePool,
  pendingAction,
  memberStateLabel,
  settlementShape,
  missedCount,
  friendlyName,
  readablePoolError,
} from "./pool-state";
export type {
  Pool,
  PoolStateValue,
  Member,
  PoolMember,
  PoolView,
  PoolAction,
  PoolTone,
  PoolNote,
  BehaviourMetric,
  Settlement,
  PoolActivityEntry,
} from "./pool-state";

import {
  PoolState as State,
  decodePoolNote,
  encodePoolNote,
  friendlyName,
  localDayNumber,
  localDayString,
  type BehaviourMetric,
  type Member as MemberRow,
  type Pool as PoolRow,
  type PoolMember,
  type PoolActivityEntry as ActivityEntry,
  type PoolView as View,
} from "./pool-state";

/**
 * ──────────── why this module reads views and never scans logs ────────────
 *
 * Both hooks below used to find their data with `eth_getLogs` from
 * `DEPLOY_BLOCK`. Monad's public RPC refuses any log scan spanning more than
 * 100 blocks — it answers HTTP 413 with
 * `{"code":-32614,"message":"eth_getLogs is limited to a 100 range"}` — and at
 * a 400ms block time the deploy block is already some two hundred thousand
 * blocks behind, growing by another two hundred thousand a day. So every scan
 * failed, permanently, and worse: viem treats 413 as retryable, so each poll
 * turned one refused request into several.
 *
 * Everything these screens show is recoverable from the contract's own views,
 * so it is read rather than replayed. `lib/queries.ts` made the same move for
 * pots first (`useMyPots`, `usePotActivity`) and the reasoning is identical;
 * what each hook loses by not reading events is written out above it rather
 * than left for somebody to discover.
 */

/**
 * Where a pool's commitment text is kept.
 *
 * The contract stores no text, so the note is filed in the same offchain
 * key/value store the repayment memos use. The key is derived from the pool id
 * rather than from the text — unlike a memo, there is nothing on the chain to
 * recover it from, so the id is the only stable handle a later page load has.
 */
function poolNoteKey(poolId: number): `0x${string}` {
  return keccak256(stringToHex(`accountability-pool:${poolId}`));
}

/* ═══════════════════════════ reads ═══════════════════════════ */

/**
 * Every pool the signed-in person is in, newest first.
 *
 * ──────────────── membership is read, not inferred ────────────────
 *
 * This used to find your pools from `MemberJoined` indexed on your address,
 * which was the cheaper query and is now the impossible one — see the note at
 * the top of this file. Membership is therefore asked for directly:
 * `poolCount()` says how many pools exist and `getMember(id, you).joined`
 * answers for each one. That is a true answer over all of history instead of a
 * 100-block window of it, and it costs reads Monad actually serves.
 *
 * Pool ids start at **1**, not 0 — `createPool` does `poolId = ++poolCount` —
 * so the range below is `count … 1`. Walking from 0 would ask `getPool(0)` for
 * a pool that does not exist, and that view reverts `PoolNotFound`, which with
 * `allowFailure: false` would take the whole list down.
 *
 * The honest limit: this is O(number of pools in the contract), chunked by
 * viem into a few `eth_call`s. Right for a few friend groups, wrong for tens of
 * thousands of pools, which wants an index built server-side. Nothing here
 * breaks when that day comes — this hook's shape stays the same.
 */
export function useMyPools() {
  const { address } = useAppWallet();
  const client = usePublicClient();
  // The day is part of the key on purpose: "have I marked today" is one of the
  // five things each row reads, and that answer changes at local midnight with
  // no event to notice it. The clock comes from the ticking hook rather than
  // Date.now() so the flip actually re-renders, and so render stays pure.
  const today = localDayNumber(useNowSeconds() * 1000);

  return useQuery({
    queryKey: ["pools", address, today],
    enabled: Boolean(address && client && ready.pools),
    refetchInterval: 45_000,
    queryFn: async (): Promise<View[]> => {
      if (!client || !address) return [];
      const c = client as PublicClient;

      const count = Number(
        (await c.readContract({
          address: ACCOUNTABILITY_POOL_ADDRESS,
          abi: accountabilityPoolAbi,
          functionName: "poolCount",
        })) as bigint
      );
      if (count === 0) return [];

      // Newest first, which is also the order the list screen shows them in.
      const all = Array.from({ length: count }, (_, i) => count - i);

      // One read per pool, and the cheapest one that answers "am I in this":
      // `getMember` never reverts for an unknown pool or a stranger, it just
      // comes back with `joined: false`.
      const rows = (await c.multicall({
        allowFailure: false,
        contracts: all.map((id) => ({
          address: ACCOUNTABILITY_POOL_ADDRESS,
          abi: accountabilityPoolAbi,
          functionName: "getMember" as const,
          args: [BigInt(id), address],
        })),
      })) as unknown as MemberRow[];

      const ids = all.filter((_, i) => rows[i]?.joined);
      if (ids.length === 0) return [];

      const views = await loadPools(c, address, ids, today);
      // Pool ids are handed out by an incrementing counter, so the id is the
      // creation order and needs no extra read to sort by.
      return views.sort((a, b) => b.id - a.id);
    },
  });
}

/**
 * One pool, with everybody in it.
 *
 * Works for a person who is *not* a member — that is the invite case, where
 * somebody opens a shared link and has to be able to read the stake, the rule
 * and who is already in before deciding to put money in.
 */
export function usePool(poolId: number | undefined) {
  const { address } = useAppWallet();
  const client = usePublicClient();
  const today = localDayNumber(useNowSeconds() * 1000);

  return useQuery({
    queryKey: ["pool", poolId, address, today],
    enabled: Boolean(
      poolId !== undefined && client && address && ready.pools
    ),
    refetchInterval: 30_000,
    queryFn: async (): Promise<{ view: View; members: PoolMember[] } | null> => {
      if (!client || !address || poolId === undefined) return null;
      const c = client as PublicClient;

      // `getPool` reverts PoolNotFound for an id that was never created, and a
      // mistyped or stale link is the ordinary way that happens. Returning null
      // lets the screen say "no such pool" instead of offering a retry button
      // for a request that will refuse forever.
      let view: View | undefined;
      try {
        [view] = await loadPools(c, address, [poolId], today);
      } catch (err) {
        if (err instanceof Error && err.message.includes("PoolNotFound")) {
          return null;
        }
        throw err;
      }
      if (!view) return null;

      const addresses = (await c.readContract({
        address: ACCOUNTABILITY_POOL_ADDRESS,
        abi: accountabilityPoolAbi,
        functionName: "getMembers",
        args: [BigInt(poolId)],
      })) as `0x${string}`[];

      if (addresses.length === 0) return { view, members: [] };

      // One multicall for the rows and one batched lookup for the names: a
      // pool of twenty people must not become forty requests.
      const [rows, names] = await Promise.all([
        c.multicall({
          allowFailure: false,
          contracts: addresses.map((who) => ({
            address: ACCOUNTABILITY_POOL_ADDRESS,
            abi: accountabilityPoolAbi,
            functionName: "getMember" as const,
            args: [BigInt(poolId), who],
          })),
        }) as unknown as Promise<MemberRow[]>,
        loadDisplayNames(addresses),
      ]);

      const mine = address.toLowerCase();
      const members: PoolMember[] = addresses.map((who, i) => {
        const row = rows[i]!;
        return {
          ...row,
          address: who,
          // loadDisplayNames lowercases its keys, so the lookup must too.
          name: names[who.toLowerCase()]?.trim() || friendlyName(who),
          isYou: who.toLowerCase() === mine,
        };
      });

      return { view, members };
    },
  });
}

/**
 * What happened in one pool, oldest first, for its detail screen.
 *
 * ──────────────── built from state, not from events ────────────────
 *
 * This was six parallel `eth_getLogs` calls, all six of which Monad refuses —
 * see the note at the top of this file. Everything the feed shows is implied by
 * the pool's current state, so it is read instead: `getPool` gives the stake,
 * the rule, whether it has been settled and how many kept it; `getMembers`
 * gives who is in it, in the order they joined; `getMember` gives each
 * person's marked days and whether they have taken their money back.
 *
 * ──────────────── what this costs, honestly ────────────────
 *
 * Three things are lost by not reading events, and all three are worth saying
 * out loud rather than hiding behind a feed that looks complete:
 *
 *  - **No timestamps.** Views know the current state, not when it was reached.
 *    The feed is ordered, not dated: members in the order they joined, and the
 *    settling last. Nothing claims a time it cannot know.
 *  - **Marked days are a total, not one line each.** Eleven marked days read
 *    back as a single line saying eleven, because `daysAttested` is the count.
 *    The number is right; the eleven separate taps are not visible, and no
 *    individual day can be dated.
 *  - **A claim's amount is gone once it is claimed.** `claimableOf` answers
 *    zero after the fact, so a "took their money back" line carries no figure.
 *    `poolActivityLine` never printed one, so nothing on screen changes.
 *
 * All three are recoverable later by indexing the events server-side into the
 * same Supabase instance that already holds the commitment text and the names.
 * This hook's return shape would not change.
 */
export function usePoolActivity(poolId: number | undefined) {
  const client = usePublicClient();

  return useQuery({
    queryKey: ["pool-activity", poolId],
    enabled: Boolean(poolId !== undefined && client && ready.pools),
    refetchInterval: 60_000,
    queryFn: async (): Promise<ActivityEntry[]> => {
      if (!client || poolId === undefined) return [];
      const c = client as PublicClient;
      const id = BigInt(poolId);

      let pool: PoolRow;
      let addresses: `0x${string}`[];
      try {
        [pool, addresses] = (await c.multicall({
          allowFailure: false,
          contracts: [
            {
              address: ACCOUNTABILITY_POOL_ADDRESS,
              abi: accountabilityPoolAbi,
              functionName: "getPool" as const,
              args: [id],
            },
            {
              address: ACCOUNTABILITY_POOL_ADDRESS,
              abi: accountabilityPoolAbi,
              functionName: "getMembers" as const,
              args: [id],
            },
          ],
        })) as unknown as [PoolRow, `0x${string}`[]];
      } catch (err) {
        // Same reasoning as `usePool`: an id that was never created is a bad
        // link, and an empty feed beside that screen's own "no such pool" is
        // the truthful answer rather than an error of its own.
        if (err instanceof Error && err.message.includes("PoolNotFound")) {
          return [];
        }
        throw err;
      }

      const rows =
        addresses.length === 0
          ? ([] as MemberRow[])
          : ((await c.multicall({
              allowFailure: false,
              contracts: addresses.map((who) => ({
                address: ACCOUNTABILITY_POOL_ADDRESS,
                abi: accountabilityPoolAbi,
                functionName: "getMember" as const,
                args: [id, who],
              })),
            })) as unknown as MemberRow[]);

      // Without block numbers the feed needs its own order. `seq` counts
      // upwards in the order things must have happened — the pool is started,
      // people join, they mark their days, and the settling and its claims come
      // last — and `PoolActivityEntry` keeps the two fields the sort used to
      // need so no component above this has to change.
      let seq = 0;
      const next = () => ({ blockNumber: 0n, logIndex: seq++ });

      const entries: ActivityEntry[] = [{ kind: "created", ...next() }];

      // `getMembers` returns the list in the order people were pushed on to it,
      // which is the order they joined. Every member staked exactly
      // `stakePerMember` — the contract allows no other amount — so the figure
      // on a join line is exact even though its time is unknown.
      for (const who of addresses) {
        entries.push({
          kind: "joined",
          member: who,
          amount: pool.stakePerMember,
          ...next(),
        });
      }

      addresses.forEach((who, i) => {
        const days = rows[i]?.daysAttested ?? 0;
        if (days > 0) {
          entries.push({ kind: "marked", member: who, daysAttested: days, ...next() });
        }
      });

      if (pool.state === State.Finalised) {
        entries.push({ kind: "settled", winners: pool.winners, ...next() });

        // Only when somebody kept it. The contract emits StakeForfeited for
        // every member who missed even when nobody kept it, but in that case it
        // then sets `forfeited` to zero and every stake goes home — so a line
        // reading "their stake goes to the others" would be false. The settled
        // line above already says what happened in that ending.
        if (pool.winners > 0) {
          addresses.forEach((who, i) => {
            if (rows[i] && !rows[i]!.succeeded) {
              entries.push({
                kind: "forfeited",
                member: who,
                amount: pool.stakePerMember,
                ...next(),
              });
            }
          });
        }

        addresses.forEach((who, i) => {
          if (rows[i]?.claimed) {
            entries.push({ kind: "claimed", member: who, ...next() });
          }
        });
      }

      // Already in order, so there is nothing to sort: `seq` was assigned in
      // the order the entries were pushed.
      return entries;
    },
  });
}

/* ═══════════════════════════ reads, shared ═══════════════════════════ */

/**
 * The five things every pool row needs, for several pools, in one round trip.
 *
 * `getPool` alone is not enough for any screen: a row has to say whether *this*
 * person is in it, whether they have already marked today, and what settling
 * would pay them. Five reads per pool in one multicall is one request; five
 * separate reads per pool is twenty-five requests for a list of five.
 */
async function loadPools(
  client: PublicClient,
  me: `0x${string}`,
  ids: number[],
  today: number
): Promise<View[]> {
  if (ids.length === 0) return [];

  const contracts = ids.flatMap((id) => {
    const poolId = BigInt(id);
    return [
      {
        address: ACCOUNTABILITY_POOL_ADDRESS,
        abi: accountabilityPoolAbi,
        functionName: "getPool" as const,
        args: [poolId],
      },
      {
        address: ACCOUNTABILITY_POOL_ADDRESS,
        abi: accountabilityPoolAbi,
        functionName: "getMember" as const,
        args: [poolId, me],
      },
      {
        address: ACCOUNTABILITY_POOL_ADDRESS,
        abi: accountabilityPoolAbi,
        functionName: "memberCount" as const,
        args: [poolId],
      },
      {
        address: ACCOUNTABILITY_POOL_ADDRESS,
        abi: accountabilityPoolAbi,
        functionName: "dayAttested" as const,
        args: [poolId, me, BigInt(today)],
      },
      {
        address: ACCOUNTABILITY_POOL_ADDRESS,
        abi: accountabilityPoolAbi,
        functionName: "claimableOf" as const,
        args: [poolId, me],
      },
    ];
  });

  const results = (await client.multicall({
    allowFailure: false,
    contracts,
  })) as unknown[];

  const notes = await loadPoolNotes(ids);

  const views: View[] = [];
  ids.forEach((id, i) => {
    const base = i * 5;
    const pool = results[base] as PoolRow;
    if (pool.state === State.None) return;

    const mine = results[base + 1] as MemberRow;
    const count = Number(results[base + 2] as bigint);
    const recordedToday = Boolean(results[base + 3]);
    const [claimableStake, claimableBonus] = results[base + 4] as [
      bigint,
      bigint,
    ];
    const note = notes[id] ?? { commitment: "", metric: "steps" as const };

    views.push({
      ...pool,
      id,
      commitment: note.commitment,
      metric: note.metric,
      memberCount: count,
      me: mine,
      recordedToday,
      claimableStake,
      claimableBonus,
    });
  });

  return views;
}

/** The offchain notes for several pools, in one lookup. */
async function loadPoolNotes(ids: number[]) {
  const keys = ids.map(poolNoteKey);
  const rows = await loadMemos(keys);
  const out: Record<number, { commitment: string; metric: BehaviourMetric }> = {};
  ids.forEach((id, i) => {
    // loadMemos lowercases its keys, so the lookup has to as well.
    out[id] = decodePoolNote(rows[keys[i]!.toLowerCase()]);
  });
  return out;
}

/* ═══════════════════════════ the daily signal ═══════════════════════════ */

type DayAuthorization = {
  /** Whose day this authorises. Always the signed-in person — see below. */
  member: `0x${string}`;
  /** Whole days since the epoch, as the server computed it. */
  day: number;
  signature: `0x${string}`;
};

/**
 * Ask the server to sign today's day for the signed-in person.
 *
 * ──────────────── why this post is written out here ────────────────
 *
 * `lib/trust/client.ts` has an `attestBehaviour` for BehaviourSavings, and it
 * is the wrong shape for this contract: it signs a digest bound to a savings
 * goal, while AccountabilityPool recomputes one bound to the pool address, the
 * pool id, the member and the day. Sending the first where the second is wanted
 * is not a soft failure — the contract rejects it — which is exactly why the
 * server keeps them in two separate routes. There is no client function for
 * `/api/trust/attest-day` yet and `lib/trust/client.ts` is not mine to edit, so
 * the call lives here, with the same two rules that file insists on: both Privy
 * tokens go up, and **a response without a usable signature is an error, not a
 * success**. Letting an undefined signature through would produce an opaque
 * revert several seconds later.
 *
 * The route only ever signs for the caller's own address, so one member cannot
 * mark a day on a friend's behalf. That is a deliberate narrowing of what the
 * contract would allow, and it is why `member` comes back in the response
 * rather than being passed in.
 */
async function authorizeDay(input: {
  poolId: number;
  metric: BehaviourMetric;
  value: number;
  forDay: string;
}): Promise<DayAuthorization> {
  const [accessToken, identityToken] = await Promise.all([
    getAccessToken(),
    getIdentityToken(),
  ]);
  if (!accessToken || !identityToken) {
    throw new TrustCallError("Please sign in again.", 401, "no_session");
  }

  let response: Response;
  try {
    response = await fetch("/api/trust/attest-day", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
        "x-privy-id-token": identityToken,
      },
      body: JSON.stringify(input),
    });
  } catch {
    throw new TrustCallError(
      "We couldn't reach the server. Check that you're online and try again.",
      0,
      "network"
    );
  }

  // A 500 can arrive as an HTML error page, so parsing is guarded separately
  // from the status check.
  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }
  const rec = (parsed ?? {}) as Record<string, unknown>;

  if (!response.ok) {
    throw new TrustCallError(
      typeof rec.error === "string"
        ? rec.error
        : response.status === 429
          ? "Too many tries. Wait a minute and try again."
          : "That didn't work. Please try again.",
      response.status,
      typeof rec.reason === "string" ? rec.reason : undefined
    );
  }

  if (
    typeof rec.signature !== "string" ||
    !/^0x[0-9a-fA-F]{130}$/.test(rec.signature) ||
    typeof rec.member !== "string" ||
    !/^0x[0-9a-fA-F]{40}$/.test(rec.member) ||
    typeof rec.day !== "number"
  ) {
    throw new TrustCallError(
      "The server didn't record that day. Please try again.",
      502,
      "no_signature"
    );
  }

  return {
    member: rec.member as `0x${string}`,
    day: rec.day,
    signature: rec.signature as `0x${string}`,
  };
}

/* ═══════════════════════════ writes ═══════════════════════════ */

function useRefreshPools() {
  const qc = useQueryClient();
  return (poolId?: number) => {
    void qc.invalidateQueries({ queryKey: ["test-money"] });
    void qc.invalidateQueries({ queryKey: ["token-state"] });
    void qc.invalidateQueries({ queryKey: ["pools"] });
    if (poolId !== undefined) {
      void qc.invalidateQueries({ queryKey: ["pool", poolId] });
      void qc.invalidateQueries({ queryKey: ["pool-activity", poolId] });
    }
  };
}

export type CreatePoolInput = {
  /** What the group is committing to. Offchain text. */
  commitment: string;
  /** Which number everybody reports each day. */
  metric: BehaviourMetric;
  stakePaise: bigint;
  /** Unix seconds, exclusive: days can be marked strictly before this. */
  deadline: bigint;
  requiredDays: number;
  graceDays: number;
  maxMembers: number;
  /** Shown to the rest of the group. Optional. */
  myName: string;
  /** Current allowance, so the one-time approval only happens once. */
  allowance: bigint;
};

/**
 * Start a pool, and stake in it — `createPool` joins the creator in the same
 * call, so this is one action and not two.
 *
 * The ERC-20 approval is folded in rather than shown as a step. A person
 * starting a pool has one intention, and asking them to authorise a thing they
 * never asked about would be the clearest possible signal that there is a
 * blockchain under here.
 */
export function useCreatePool() {
  const call = useSponsoredCall();
  const { address } = useAppWallet();
  const refresh = useRefreshPools();

  return useMutation({
    mutationFn: async (input: CreatePoolInput) => {
      // Restated from the contract so a bad form is refused in words here
      // rather than as an InvalidParams revert after a wait.
      if (input.stakePaise <= 0n) throw new Error("Set a stake above zero.");
      if (input.requiredDays < 1) throw new Error("Ask for at least one day.");
      if (input.graceDays >= input.requiredDays) {
        throw new Error(
          "The days you may miss have to be fewer than the days you ask for."
        );
      }

      if (input.allowance < input.stakePaise) {
        await call({
          address: TEST_RUPEE_ADDRESS,
          abi: testRupeeAbi,
          functionName: "approve",
          args: [ACCOUNTABILITY_POOL_ADDRESS, maxUint256],
        });
      }

      const receipt = await call({
        address: ACCOUNTABILITY_POOL_ADDRESS,
        abi: accountabilityPoolAbi,
        functionName: "createPool",
        args: [
          input.stakePaise,
          input.deadline,
          input.requiredDays,
          input.graceDays,
          input.maxMembers,
        ],
      });

      // The pool id comes from the receipt rather than from `poolCount`:
      // reading the counter afterwards would hand back somebody else's pool if
      // two people created one in the same block.
      const events = parseEventLogs({
        abi: accountabilityPoolAbi,
        eventName: "PoolCreated",
        logs: receipt.logs,
      });
      const created = events[0];
      if (!created) {
        throw new Error("The pool was made but we couldn't read it back.");
      }
      const poolId = Number((created.args as { poolId: bigint }).poolId);

      // Saved after the pool exists, not before: a commitment stored for a
      // pool that never happened would show up as a phantom row.
      await saveMemo(
        poolNoteKey(poolId),
        encodePoolNote({
          commitment: input.commitment.trim(),
          metric: input.metric,
        })
      );
      if (address && input.myName.trim()) {
        await saveDisplayName(address, input.myName.trim());
      }

      return poolId;
    },
    onSuccess: (poolId) => refresh(poolId),
  });
}

/**
 * Join a pool and stake.
 *
 * `joinPool` is permissionless up to `maxMembers` — there is no invite code in
 * this contract, unlike a pot. Anybody holding the link can join until it is
 * full, and the screens say that rather than implying a closed list.
 */
export function useJoinPool() {
  const call = useSponsoredCall();
  const { address } = useAppWallet();
  const refresh = useRefreshPools();

  return useMutation({
    mutationFn: async (input: {
      poolId: number;
      stakePaise: bigint;
      allowance: bigint;
      myName: string;
    }) => {
      if (input.allowance < input.stakePaise) {
        await call({
          address: TEST_RUPEE_ADDRESS,
          abi: testRupeeAbi,
          functionName: "approve",
          args: [ACCOUNTABILITY_POOL_ADDRESS, maxUint256],
        });
      }

      await call({
        address: ACCOUNTABILITY_POOL_ADDRESS,
        abi: accountabilityPoolAbi,
        functionName: "joinPool",
        args: [BigInt(input.poolId)],
      });

      if (address && input.myName.trim()) {
        await saveDisplayName(address, input.myName.trim());
      }
      return input.poolId;
    },
    onSuccess: (poolId) => refresh(poolId),
  });
}

/**
 * Mark today.
 *
 * Two steps that are one action for the person: the server signs the day, then
 * the person's own wallet sends it. The server cannot send it — it holds no
 * money and no transaction here is sent on anybody's behalf — and the contract
 * will not take the day without the signature, so neither half works alone.
 *
 * What this does NOT do is check anything. The number is whatever was typed.
 */
export function useMarkToday() {
  const call = useSponsoredCall();
  const refresh = useRefreshPools();

  return useMutation({
    mutationFn: async (input: {
      poolId: number;
      metric: BehaviourMetric;
      value: number;
    }) => {
      const auth = await authorizeDay({
        poolId: input.poolId,
        metric: input.metric,
        value: input.value,
        // The member's own local date. A server computing UTC midnight would
        // file a Delhi evening as tomorrow and the day would be refused.
        forDay: localDayString(Date.now()),
      });

      await call({
        address: ACCOUNTABILITY_POOL_ADDRESS,
        abi: accountabilityPoolAbi,
        functionName: "attestDay",
        args: [
          BigInt(input.poolId),
          auth.member,
          BigInt(auth.day),
          auth.signature,
        ],
      });

      return input.poolId;
    },
    onSuccess: (poolId) => refresh(poolId),
  });
}

/**
 * Tally the pool after the last day. Moves no money.
 *
 * Permissionless on purpose: all it can do is record an outcome the marked days
 * already determined, so nobody has to wait on the creator to be allowed to
 * take their stake back. Which also means it does not happen by itself — a
 * person has to tap, and the screens must not imply the money comes back at
 * the deadline on its own.
 */
export function useSettlePool() {
  const call = useSponsoredCall();
  const refresh = useRefreshPools();

  return useMutation({
    mutationFn: async (poolId: number) => {
      await call({
        address: ACCOUNTABILITY_POOL_ADDRESS,
        abi: accountabilityPoolAbi,
        functionName: "finalise",
        args: [BigInt(poolId)],
      });
      return poolId;
    },
    onSuccess: (poolId) => refresh(poolId),
  });
}

/** Take your stake back, plus your share of the forfeits if you kept it. */
export function useClaimPool() {
  const call = useSponsoredCall();
  const refresh = useRefreshPools();

  return useMutation({
    mutationFn: async (poolId: number) => {
      await call({
        address: ACCOUNTABILITY_POOL_ADDRESS,
        abi: accountabilityPoolAbi,
        functionName: "claim",
        args: [BigInt(poolId)],
      });
      return poolId;
    },
    onSuccess: (poolId) => refresh(poolId),
  });
}

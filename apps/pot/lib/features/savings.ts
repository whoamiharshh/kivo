"use client";

/**
 * Save towards something — the data layer for BehaviourSavings.
 *
 * ──────────────── what the contract actually does ────────────────
 *
 * You commit to a target by a date. Creating the goal takes a stake of 10% of
 * that target out of your balance there and then. You top the goal up over
 * time; after the date somebody closes it, and the contract decides whether
 * you met the goal.
 *
 * Two pots of money, and the UI must never let them blur into one:
 *
 *   your savings  come back in full the moment the goal is closed, met or
 *                 missed. This is not a promise in the copy, it is the
 *                 contract's first transfer and a tested invariant.
 *   your stake    comes back only if you met the goal — plus a share of the
 *                 stakes forfeited by people who picked the same date and
 *                 missed theirs.
 *
 * That last clause is the whole product and the whole honesty problem. A bonus
 * is funded by other savers failing. Nothing else funds it: no sponsor, no
 * fund, no interest. So "no bonus" is a completely normal outcome, and the
 * screens say so rather than looking like a return failed to arrive.
 *
 * ──────────────── the settling is two steps on purpose ────────────────
 *
 * `finalise` tallies one goal and returns its principal. `claimOutcome` pays
 * the stake and any bonus, and only works once *every* goal sharing that
 * deadline has been finalised — a pro-rata share cannot be computed before
 * then. So a person can be left looking at a closed goal they cannot collect
 * yet, waiting on strangers. The detail screen has to name that wait instead
 * of showing a button that reverts.
 *
 * ──────────────── why this file is separate ────────────────
 *
 * Same reason as `pay.ts`: one file per feature under lib/features/ keeps each
 * screen's bundle to the contract it actually talks to, rather than every
 * screen importing all eight features' event lists.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import {
  maxUint256,
  parseEventLogs,
  zeroAddress,
  type PublicClient,
} from "viem";
import {
  BEHAVIOUR_SAVINGS_ADDRESS,
  TEST_RUPEE_ADDRESS,
  behaviourSavingsAbi,
  ready,
  testRupeeAbi,
} from "../contracts";
import { loadMemos, saveMemo } from "../store";
import { attestBehaviour } from "../trust/client";
import { useAppWallet, useSponsoredCall } from "../tx";

/**
 * The enums, shapes and pure helpers live in `savings-state.ts` so a Server
 * Component can use them — this module is "use client", and that directive
 * would otherwise make even a pure function unusable from the server. They are
 * re-exported here so client code can keep importing from one place.
 */
export {
  BehaviourType,
  GoalState,
  MIN_DEPOSITS,
  MIN_DAYS_AHEAD,
  MAX_DAYS_AHEAD,
  STAKE_BPS,
  BONUS_SOURCE,
  SELF_REPORTED_CONSEQUENCE,
  SELF_REPORTED_DISCLOSURE,
  amountLeft,
  dateInputDaysAhead,
  deadlineFromDateInput,
  decodeGoalMeta,
  depositsLeft,
  describeGoal,
  encodeGoalMeta,
  goalMetaHash,
  habitOptions,
  habitProgress,
  isOnTrack,
  nextStep,
  outcomeFor,
  stakeFor,
} from "./savings-state";
export type {
  BehaviourTypeValue,
  Cohort,
  Goal,
  GoalMeta,
  GoalStateValue,
  GoalView,
  HabitKind,
  HabitOption,
  NextStep,
  Outcome,
} from "./savings-state";

import {
  BehaviourType,
  GoalState,
  decodeGoalMeta,
  encodeGoalMeta,
  goalMetaHash,
  stakeFor,
  type Cohort,
  type Goal,
  type GoalMeta,
  type GoalView,
  type HabitKind,
} from "./savings-state";


/* ═══════════════════════════ reads ═══════════════════════════ */

/**
 * Every goal this person has, newest first.
 *
 * Found by walking `goalCount` and keeping the ones this person owns. That
 * reads every goal anybody has made, which is more work than an indexed log
 * scan would be — but Monad's RPC refuses log scans wider than 100 blocks, so
 * the cheaper route is not available at any price. See the note inside.
 */
export function useMyGoals() {
  const { address } = useAppWallet();
  const client = usePublicClient();

  return useQuery({
    queryKey: ["savings-goals", address],
    enabled: Boolean(address && client && ready.savings),
    refetchInterval: 45_000,
    queryFn: async (): Promise<GoalView[]> => {
      if (!client || !address) return [];
      const c = client as PublicClient;

      // Read, don't replay. Monad's RPC refuses any log scan wider than 100
      // blocks (HTTP 413, `eth_getLogs is limited to a 100 range`), and the
      // deploy block is far further back than that, so finding goals by their
      // `GoalCreated` event stopped being possible minutes after launch. The
      // contract can be asked directly instead: `goalCount()` says how many
      // exist and each `getGoal` names its owner.
      const count = Number(
        (await c.readContract({
          address: BEHAVIOUR_SAVINGS_ADDRESS,
          abi: behaviourSavingsAbi,
          functionName: "goalCount",
        })) as bigint
      );
      if (count === 0) return [];

      const everyId = Array.from({ length: count }, (_, i) => i);
      const everyGoal = (await c.multicall({
        allowFailure: false,
        contracts: everyId.map((id) => ({
          address: BEHAVIOUR_SAVINGS_ADDRESS,
          abi: behaviourSavingsAbi,
          functionName: "getGoal" as const,
          args: [BigInt(id)],
        })),
      })) as unknown as Goal[];

      const mine = address.toLowerCase();
      const ids: number[] = [];
      const goals: Goal[] = [];
      everyId.forEach((id, i) => {
        const g = everyGoal[i]!;
        if (g.user.toLowerCase() === mine) {
          ids.push(id);
          goals.push(g);
        }
      });
      if (ids.length === 0) return [];

      const views = await decorate(
        ids.map((id, i) => ({ id, goal: goals[i]! }))
      );
      // Soonest deadline first: the thing that needs attention is the thing
      // running out of time, not the thing made most recently.
      return views.sort((a, b) => Number(a.deadline - b.deadline));
    },
  });
}

/**
 * One goal, with the contract's own verdict and its cohort.
 *
 * `onTrack` and `remaining` are asked of the contract here even though
 * `savings-state.ts` can compute both from the struct. Deliberate: this is one
 * goal, so it costs nothing, and it means the rule the list screen duplicates
 * for speed is checked against the original every time somebody opens a goal.
 *
 * The cohort is read in a second round trip because its key is the goal's
 * deadline, which the first read is what tells us.
 */
export function useGoal(goalId: number | undefined) {
  const client = usePublicClient();

  return useQuery({
    queryKey: ["savings-goal", goalId],
    enabled: Boolean(goalId !== undefined && client && ready.savings),
    refetchInterval: 30_000,
    queryFn: async (): Promise<{
      goal: GoalView;
      cohort: Cohort;
      onTrack: boolean;
      amountLeft: bigint;
      depositsLeft: number;
    } | null> => {
      if (!client || goalId === undefined) return null;
      const c = client as PublicClient;

      const [goal, onTrack, remaining] = (await c.multicall({
        allowFailure: false,
        contracts: [
          {
            address: BEHAVIOUR_SAVINGS_ADDRESS,
            abi: behaviourSavingsAbi,
            functionName: "getGoal",
            args: [BigInt(goalId)],
          },
          {
            address: BEHAVIOUR_SAVINGS_ADDRESS,
            abi: behaviourSavingsAbi,
            functionName: "onTrack",
            args: [BigInt(goalId)],
          },
          {
            address: BEHAVIOUR_SAVINGS_ADDRESS,
            abi: behaviourSavingsAbi,
            functionName: "remaining",
            args: [BigInt(goalId)],
          },
        ],
      })) as unknown as [Goal, boolean, [bigint, number]];

      if (goal.state === GoalState.None) return null;

      const cohort = (await c.readContract({
        address: BEHAVIOUR_SAVINGS_ADDRESS,
        abi: behaviourSavingsAbi,
        functionName: "getCohort",
        args: [goal.deadline],
      })) as Cohort;

      const [view] = await decorate([{ id: goalId, goal }]);

      return {
        goal: view!,
        cohort,
        onTrack,
        amountLeft: remaining[0],
        depositsLeft: Number(remaining[1]),
      };
    },
  });
}

/**
 * Whether an external-signal goal can be created at all.
 *
 * The contract assigns such a goal the verifier the admin has appointed, and
 * reverts with `VerifierRequired` when none is. A fresh deployment has none —
 * `test_AFreshDeploymentHasNoVerifier` — so this is the normal state, not an
 * error, and the create screen greys the option out instead of offering a
 * guaranteed failure.
 */
export function useExternalSignalReady() {
  const client = usePublicClient();

  return useQuery({
    queryKey: ["savings-verifier"],
    enabled: Boolean(client && ready.savings),
    // Changes only when an admin runs a one-off call, so this is as close to
    // static as anything the app reads.
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<boolean> => {
      if (!client) return false;
      const verifier = (await (client as PublicClient).readContract({
        address: BEHAVIOUR_SAVINGS_ADDRESS,
        abi: behaviourSavingsAbi,
        functionName: "behaviourVerifier",
      })) as `0x${string}`;
      return verifier !== zeroAddress;
    },
  });
}

/**
 * What happened to one goal, oldest first, for its detail screen.
 *
 * ──────────────── derived from the goal, not from its events ────────────────
 *
 * This was six parallel log scans. Monad's RPC caps a scan at 100 blocks and
 * answers HTTP 413 beyond it, so all six failed on every poll and the feed was
 * permanently empty. Everything it showed is recoverable from the goal struct
 * itself, so it is read rather than replayed.
 *
 * Two things are genuinely lost, and neither is papered over:
 *
 *  - **No times.** The struct knows the state, not when it was reached. The
 *    feed is ordered, not dated, and no line claims an hour it cannot know.
 *  - **Top-ups collapse.** `depositCount` says how many were made, not when or
 *    for how much each, so they read as one line with the total and a count.
 *
 * Both come back the day events are indexed server-side into the store that
 * already holds goal names. This function's shape would not change.
 */
export function useGoalActivity(goalId: number | undefined) {
  const client = usePublicClient();

  return useQuery({
    queryKey: ["savings-activity", goalId],
    enabled: Boolean(goalId !== undefined && client && ready.savings),
    refetchInterval: 45_000,
    queryFn: async (): Promise<GoalActivityEntry[]> => {
      if (!client || goalId === undefined) return [];
      const c = client as PublicClient;

      const goal = (await c.readContract({
        address: BEHAVIOUR_SAVINGS_ADDRESS,
        abi: behaviourSavingsAbi,
        functionName: "getGoal",
        args: [BigInt(goalId)],
      })) as unknown as Goal;

      if (goal.state === GoalState.None) return [];

      // `seq` stands in for a block number: things are numbered in the order
      // they must have happened, and the screen reads them newest-last.
      let seq = 0;
      const entries: GoalActivityEntry[] = [
        { key: "created", kind: "created", seq: seq++ },
      ];

      if (goal.depositCount > 0) {
        entries.push({
          key: "added",
          kind: "added",
          amount: goal.saved,
          count: goal.depositCount,
          seq: seq++,
        });
      }

      if (goal.behaviourVerified) {
        entries.push({ key: "habit", kind: "habit", seq: seq++ });
      }

      if (goal.state === GoalState.Finalised || goal.state === GoalState.Settled) {
        entries.push({
          key: "closed",
          kind: goal.succeeded ? "closed" : "forfeited",
          seq: seq++,
        });
      }

      if (goal.state === GoalState.Settled) {
        entries.push({ key: "settled", kind: "settled", seq: seq++ });
      }

      return entries;
    },
  });
}

/** One line of a goal's history. Ordered by `seq`; it carries no timestamp. */
export type GoalActivityEntry = {
  key: string;
  kind: "created" | "added" | "habit" | "closed" | "forfeited" | "settled";
  /** Total saved, on an "added" entry. */
  amount?: bigint;
  /** How many top-ups that total is made of. */
  count?: number;
  seq: number;
};

/**
 * Attach the offchain half: what the goal is called and which habit was meant.
 *
 * One batched read for every goal on screen rather than one per row — a list
 * of twenty goals must not become twenty requests.
 */
async function decorate(
  rows: { id: number; goal: Goal }[]
): Promise<GoalView[]> {
  const metas = await loadMemos(rows.map((r) => goalMetaHash(r.id)));
  return rows.map(({ id, goal }) => {
    // loadMemos lowercases its keys, so the lookup has to as well.
    const stored = metas[goalMetaHash(id).toLowerCase()];
    const meta = decodeGoalMeta(stored, goal.behaviour);
    return { ...goal, id, ...meta };
  });
}

/* ═══════════════════════════ writes ═══════════════════════════ */

function useRefreshGoals() {
  const qc = useQueryClient();
  return (goalId?: number) => {
    void qc.invalidateQueries({ queryKey: ["token-state"] });
    void qc.invalidateQueries({ queryKey: ["test-money"] });
    void qc.invalidateQueries({ queryKey: ["savings-goals"] });
    if (goalId !== undefined) {
      void qc.invalidateQueries({ queryKey: ["savings-goal", goalId] });
      void qc.invalidateQueries({ queryKey: ["savings-activity", goalId] });
    }
  };
}

export type CreateGoalInput = {
  name: string;
  targetPaise: bigint;
  /** Unix seconds, midnight UTC. See `deadlineFromDateInput`. */
  deadline: bigint;
  habit: HabitKind;
  /** Steps a day, for a self-reported habit. A note to yourself, not a rule. */
  dailyTarget?: number;
  /** Current allowance, so the one-time approval only happens once. */
  allowance: bigint;
};

/**
 * Commit to a goal, and put the stake up.
 *
 * The approval is folded into the same action rather than shown as a separate
 * step, exactly as in `useSendPayment`. Note that the stake — not the first
 * top-up — is what needs it here: `createSavingsGoal` transfers 10% of the
 * target as its last act, so a goal created without an allowance fails at
 * creation rather than later.
 *
 * The name is saved *after* the goal exists, so a goal that never got created
 * cannot leave a stray name behind for a future goal to inherit by id.
 */
export function useCreateGoal() {
  const call = useSponsoredCall();
  const { address } = useAppWallet();
  const refresh = useRefreshGoals();

  return useMutation({
    mutationFn: async (input: CreateGoalInput): Promise<{ goalId: number }> => {
      if (!address) throw new Error("Still setting up your account — try again in a moment.");
      if (input.targetPaise <= 0n) throw new Error("Set a target first.");

      const stake = stakeFor(input.targetPaise);
      if (stake === 0n) {
        throw new Error("That target is too small to stake anything on.");
      }

      if (input.allowance < stake) {
        await call({
          address: TEST_RUPEE_ADDRESS,
          abi: testRupeeAbi,
          functionName: "approve",
          args: [BEHAVIOUR_SAVINGS_ADDRESS, maxUint256],
        });
      }

      const behaviour =
        input.habit === "consistent"
          ? BehaviourType.SaveConsistently
          : BehaviourType.ExternalSignal;

      const receipt = await call({
        address: BEHAVIOUR_SAVINGS_ADDRESS,
        abi: behaviourSavingsAbi,
        functionName: "createSavingsGoal",
        args: [address, input.targetPaise, input.deadline, behaviour],
      });

      // The id comes from the event rather than from `goalCount`, which
      // another person's goal could have moved between the send and the read.
      const logs = parseEventLogs({
        abi: behaviourSavingsAbi,
        eventName: "GoalCreated",
        logs: receipt.logs,
      }) as unknown as { args: { goalId: bigint } }[];
      const goalId = Number(logs[0]?.args.goalId ?? 0n);

      const meta: GoalMeta = {
        name: input.name.trim() || "Savings goal",
        habit: input.habit,
        dailyTarget: input.dailyTarget,
      };
      await saveMemo(goalMetaHash(goalId), encodeGoalMeta(meta));

      return { goalId };
    },
    onSuccess: ({ goalId }) => refresh(goalId),
  });
}

/** Put more money towards the target. Always yours, whatever happens. */
export function useAddToGoal() {
  const call = useSponsoredCall();
  const refresh = useRefreshGoals();

  return useMutation({
    mutationFn: async (input: {
      goalId: number;
      amountPaise: bigint;
      allowance: bigint;
    }) => {
      if (input.amountPaise <= 0n) throw new Error("Enter an amount first.");

      if (input.allowance < input.amountPaise) {
        await call({
          address: TEST_RUPEE_ADDRESS,
          abi: testRupeeAbi,
          functionName: "approve",
          args: [BEHAVIOUR_SAVINGS_ADDRESS, maxUint256],
        });
      }

      await call({
        address: BEHAVIOUR_SAVINGS_ADDRESS,
        abi: behaviourSavingsAbi,
        functionName: "deposit",
        args: [BigInt(input.goalId), input.amountPaise],
      });
      return input.goalId;
    },
    onSuccess: (goalId) => refresh(goalId),
  });
}

/**
 * Submit the figure for a self-reported habit.
 *
 * Two hops: the trust layer records the number and signs for it, then that
 * signature goes to the contract, which checks it came from the verifier it
 * was assigned. The person's own wallet sends the second hop — the server
 * cannot, and holds no money either way.
 *
 * What this does NOT do, and what the screen calling it says out loud: compare
 * the figure with anything. The contract records that a signature arrived, so
 * one submission marks the habit as kept whatever number went in, and a second
 * reverts with `AlreadyVerified`. Nothing anywhere reads a pedometer.
 */
export function useSubmitHabit() {
  const call = useSponsoredCall();
  const refresh = useRefreshGoals();

  return useMutation({
    mutationFn: async (input: { goalId: number; value: number }) => {
      if (!Number.isSafeInteger(input.value) || input.value < 0) {
        throw new Error("Enter a whole number.");
      }

      const attestation = await attestBehaviour({
        subject: "savings_goal",
        subjectId: input.goalId,
        goalId: input.goalId,
        metric: "steps",
        value: input.value,
      });

      await call({
        address: BEHAVIOUR_SAVINGS_ADDRESS,
        abi: behaviourSavingsAbi,
        functionName: "submitBehaviour",
        args: [
          BigInt(input.goalId),
          attestation.signalHash,
          attestation.signature,
        ],
      });
      return input.goalId;
    },
    onSuccess: (goalId) => refresh(goalId),
  });
}

/**
 * Close the goal after its date: the verdict is recorded and the savings come
 * straight back.
 *
 * Permissionless on the contract, because all it can do is return somebody
 * their own money and write down what happened. The UI only ever offers it for
 * your own goal, but nothing breaks if a stranger gets there first.
 */
export function useCloseGoal() {
  const call = useSponsoredCall();
  const refresh = useRefreshGoals();

  return useMutation({
    mutationFn: async (goalId: number) => {
      await call({
        address: BEHAVIOUR_SAVINGS_ADDRESS,
        abi: behaviourSavingsAbi,
        functionName: "finalise",
        args: [BigInt(goalId)],
      });
      return goalId;
    },
    onSuccess: (goalId) => refresh(goalId),
  });
}

/** Collect the stake, and the bonus if there is one to collect. */
export function useClaimOutcome() {
  const call = useSponsoredCall();
  const refresh = useRefreshGoals();

  return useMutation({
    mutationFn: async (goalId: number) => {
      await call({
        address: BEHAVIOUR_SAVINGS_ADDRESS,
        abi: behaviourSavingsAbi,
        functionName: "claimOutcome",
        args: [BigInt(goalId)],
      });
      return goalId;
    },
    onSuccess: (goalId) => refresh(goalId),
  });
}

/* ═══════════════════════════ errors ═══════════════════════════ */

/**
 * BehaviourSavings' own reverts, in words.
 *
 * Its errors are mostly *not* the ones in `readableError`'s map — `WrongState`,
 * `CohortNotComplete`, `BehaviourNotSignable` and the rest belong to this
 * contract alone — and a few names it shares with PotManager mean something
 * different here. `DeadlinePassed` in a pot means money can no longer go in; in
 * a goal it means the date for saving is behind you and the goal is waiting to
 * be closed. So this feature carries its own map rather than widening the
 * shared one, and falls through to the shared one for the ERC-20 and wallet
 * cases that are genuinely common.
 */
export function savingsError(err: unknown): string {
  const raw =
    err instanceof Error ? err.message : typeof err === "string" ? err : "";

  const map: Record<string, string> = {
    GoalNotFound: "We couldn't find that goal.",
    WrongState: "That has already been done — pull down to refresh the goal.",
    NotYourGoal: "This is somebody else's goal.",
    ZeroAmount: "Enter an amount first.",
    TargetTooSmall: "That target is too small to stake anything on.",
    DurationOutOfRange:
      "Pick a date between 3 days and about a year from now.",
    DeadlinePassed:
      "The date for this goal has passed, so money can't go in any more. Close it to get your savings back.",
    DeadlineNotReached: "This goal's date hasn't arrived yet.",
    CohortNotComplete:
      "Still waiting on other savers who picked the same date. Your share can't be worked out until every one of them is closed.",
    VerifierRequired:
      "Self-reported habits aren't switched on yet. Pick saving a bit at a time instead.",
    SelfVerification: "That habit isn't available on this goal.",
    BehaviourNotSignable:
      "This goal is checked from your own top-ups, so there's nothing to submit.",
    BadSignature: "That submission wasn't accepted. Please try again.",
    AlreadyVerified: "You've already submitted for this goal.",
    NothingToClaim:
      "There's nothing to collect: the stake went to the savers who met their goal.",
    ZeroAddress: "Something's missing. Please try again.",
    ERC20InsufficientBalance:
      "You don't have enough test money. Collect some on the home screen first.",
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
  // A sentence we wrote ourselves (bounds, empty amount, the trust layer's own
  // messages) is already readable, so it is passed through rather than mashed
  // into "something went wrong".
  if (raw && !raw.includes("0x") && raw.length < 160) return raw;
  return "Something went wrong. Please try again.";
}

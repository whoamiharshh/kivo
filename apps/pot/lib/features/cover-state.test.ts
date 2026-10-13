import { describe, expect, it } from "vitest";
import {
  BIND_WINDOW_SECONDS,
  CLAIM_WINDOW_SECONDS,
  ClaimState,
  allPolicyIds,
  PolicyState,
  coverInForce,
  describe as describePolicy,
  pendingAction,
  refundOpensAt,
  type PolicyView,
} from "./cover-state";

const ME = "0x1111111111111111111111111111111111111111" as const;
const OTHER = "0x2222222222222222222222222222222222222222" as const;
const ZERO_HASH = `0x${"0".repeat(64)}` as const;

const T0 = 1_800_000_000; // an arbitrary "now"
const HOUR = 3600;
const DAY = 24 * HOUR;

function policy(overrides: Partial<PolicyView> = {}): PolicyView {
  return {
    id: 0,
    insured: ME,
    payer: ME,
    premium: 5_000n,
    coverage: 50_000n,
    // Cover runs from T0 to T0 + 1 day.
    startTime: BigInt(T0),
    endTime: BigInt(T0 + DAY),
    createdAt: BigInt(T0),
    policyTermsHash: ZERO_HASH,
    state: PolicyState.Escrowed,
    claim: {
      evidenceHash: ZERO_HASH,
      payout: 0n,
      submittedAt: 0n,
      settledAt: 0n,
      state: ClaimState.None,
    },
    terms: "",
    evidence: "",
    insuredIsMe: true,
    payerIsMe: true,
    ...overrides,
  };
}

describe("policy numbering", () => {
  // MicroCover does `policyId = ++policyCount`, so the first policy is #1 and
  // getPolicy(0) reverts. A list that walked 0..count-1 would fail as soon as
  // one policy existed, and never reach the newest.
  it("starts at 1 and ends at the count", () => {
    expect(allPolicyIds(3)).toEqual([1, 2, 3]);
  });

  it("never includes 0, which is not a policy", () => {
    expect(allPolicyIds(5)).not.toContain(0);
  });

  it("is empty when nothing exists", () => {
    expect(allPolicyIds(0)).toEqual([]);
  });

  it("reaches the newest policy", () => {
    const count = 7;
    expect(allPolicyIds(count)[count - 1]).toBe(count);
  });
});

describe("a premium in holding is never described as cover", () => {
  it("says 'Not covered yet' for held money, at any time", () => {
    for (const now of [T0 - HOUR, T0 + HOUR, T0 + 3 * DAY]) {
      expect(describePolicy(policy(), now).status).toBe("Not covered yet");
    }
  });

  it("is not in force while the premium is only held", () => {
    expect(coverInForce(policy(), T0 + HOUR)).toBe(false);
  });

  it("is in force only between start and end, and only once an insurer bound it", () => {
    const bound = policy({ state: PolicyState.Active });
    expect(coverInForce(bound, T0 - 1)).toBe(false); // bought for later
    expect(coverInForce(bound, T0)).toBe(true);
    expect(coverInForce(bound, T0 + DAY)).toBe(true);
    expect(coverInForce(bound, T0 + DAY + 1)).toBe(false);
  });

  it("does not call bought-for-later cover 'covered'", () => {
    const later = policy({ state: PolicyState.Active, startTime: BigInt(T0 + DAY) });
    expect(describePolicy(later, T0).status).toBe("Starts later");
  });
});

describe("when the premium can be taken back", () => {
  it("opens one day after creation when the cover runs longer", () => {
    const long = policy({ endTime: BigInt(T0 + 30 * DAY) });
    expect(refundOpensAt(long)).toBe(T0 + BIND_WINDOW_SECONDS);
  });

  it("opens at the end of a cover shorter than a day", () => {
    const short = policy({ endTime: BigInt(T0 + 3 * HOUR) });
    expect(refundOpensAt(short)).toBe(T0 + 3 * HOUR);
  });

  it("offers it to the person who paid, only once the wait is over", () => {
    const held = policy({ endTime: BigInt(T0 + 30 * DAY) });
    expect(pendingAction(held, T0 + BIND_WINDOW_SECONDS - 1)).toBeNull();
    expect(pendingAction(held, T0 + BIND_WINDOW_SECONDS + 1)).toBe(
      "take-back-premium"
    );
  });

  it("never offers it to somebody who did not pay", () => {
    const notMine = policy({ payerIsMe: false, payer: OTHER });
    expect(pendingAction(notMine, T0 + 10 * DAY)).toBeNull();
  });
});

describe("claims and closing", () => {
  const active = (o: Partial<PolicyView> = {}) =>
    policy({ state: PolicyState.Active, ...o });

  it("lets the covered person record a claim while cover is live", () => {
    expect(pendingAction(active(), T0 + HOUR)).toBe("claim");
  });

  it("does not offer a claim before cover starts", () => {
    const later = active({ startTime: BigInt(T0 + DAY), endTime: BigInt(T0 + 2 * DAY) });
    expect(pendingAction(later, T0)).toBeNull();
  });

  it("does not offer a claim to somebody who is not covered", () => {
    expect(pendingAction(active({ insuredIsMe: false, insured: OTHER }), T0 + HOUR)).toBeNull();
  });

  it("still allows a claim during the reporting window after cover ends", () => {
    const justAfter = T0 + DAY + CLAIM_WINDOW_SECONDS - 1;
    expect(pendingAction(active(), justAfter)).toBe("claim");
  });

  it("offers closing — to anyone — once the reporting window shuts", () => {
    const after = T0 + DAY + CLAIM_WINDOW_SECONDS + 1;
    expect(pendingAction(active(), after)).toBe("close");
    expect(
      pendingAction(active({ insuredIsMe: false, payerIsMe: false }), after)
    ).toBe("close");
  });

  it("reports a recorded claim as undecided, not paid", () => {
    const claimed = active({
      claim: {
        evidenceHash: `0x${"a".repeat(64)}`,
        payout: 0n,
        submittedAt: BigInt(T0 + HOUR),
        settledAt: 0n,
        state: ClaimState.Submitted,
      },
    });
    expect(describePolicy(claimed, T0 + 2 * HOUR).status).toBe("Claim being decided");
    expect(pendingAction(claimed, T0 + 2 * HOUR)).toBe("trigger");
  });

  it("offers nothing on a policy that is already finished", () => {
    for (const state of [PolicyState.Refunded, PolicyState.Closed] as const) {
      expect(pendingAction(policy({ state }), T0 + 100 * DAY)).toBeNull();
    }
  });
});

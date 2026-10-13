import { describe, expect, it } from "vitest";
import {
  AgreementState,
  describe as describeAgreement,
  explain,
  isFinished,
  monthlyShare,
  pendingAction,
  remainingToCap,
  shareAfterCap,
  termsDocument,
  type AgreementView,
} from "./agreement-state";

const ME = "0x1111111111111111111111111111111111111111" as const;
const OTHER = "0x2222222222222222222222222222222222222222" as const;

const T0 = 1_800_000_000;
const DAY = 86_400;

function agreement(overrides: Partial<AgreementView> = {}): AgreementView {
  return {
    id: 0,
    funder: OTHER,
    recipient: ME,
    fundingAmount: 100_000n,
    repaymentPercent: 10n,
    cap: 150_000n,
    totalRepaid: 0n,
    termEnd: BigInt(T0 + 365 * DAY),
    repaymentCount: 0,
    agreementHash: `0x${"b".repeat(64)}`,
    state: AgreementState.Active,
    role: "recipient",
    otherName: "Priya",
    otherAddress: OTHER,
    funderName: "Priya",
    recipientName: "You",
    terms: "",
    termsMatch: null,
    ...overrides,
  };
}

describe("the share of income", () => {
  it("is whole-percent integer arithmetic, truncating toward the recipient", () => {
    expect(monthlyShare(1_000_000n, 10n)).toBe(100_000n);
    // 333 paise at 10% is 33.3 — truncated, never rounded up into a debt.
    expect(monthlyShare(333n, 10n)).toBe(33n);
  });

  it("is zero for no income or no percent", () => {
    expect(monthlyShare(0n, 10n)).toBe(0n);
    expect(monthlyShare(-5n, 10n)).toBe(0n);
    expect(monthlyShare(1_000n, 0n)).toBe(0n);
  });

  it("never records more than is left under the cap", () => {
    const nearlyDone = agreement({ totalRepaid: 149_000n });
    // 10% of ₹1,00,000 is ₹10,000 but only ₹10 is left.
    expect(shareAfterCap(nearlyDone, 10_000_000n)).toBe(1_000n);
  });

  it("reports what is left under the cap, and zero once reached", () => {
    expect(remainingToCap(agreement({ totalRepaid: 40_000n }))).toBe(110_000n);
    expect(remainingToCap(agreement({ totalRepaid: 150_000n }))).toBe(0n);
    expect(remainingToCap(agreement({ totalRepaid: 999_999n }))).toBe(0n);
  });
});

describe("when an agreement is finished", () => {
  it("is not finished mid-term below the cap", () => {
    expect(isFinished(agreement(), T0)).toBe(false);
  });

  it("is finished once the cap is reached", () => {
    expect(isFinished(agreement({ totalRepaid: 150_000n }), T0)).toBe(true);
  });

  it("is finished at the moment the term ends, not a second before", () => {
    const a = agreement();
    const end = Number(a.termEnd);
    expect(isFinished(a, end - 1)).toBe(false);
    expect(isFinished(a, end)).toBe(true);
  });
});

describe("what each side sees", () => {
  it("reads the same active agreement differently for each side", () => {
    expect(describeAgreement(agreement({ role: "recipient" }), T0).status).toBe(
      "You are repaying"
    );
    expect(describeAgreement(agreement({ role: "funder" }), T0).status).toBe(
      "Being repaid"
    );
  });

  it("calls the cap being reached a good ending and a short term just an ending", () => {
    const capped = agreement({
      state: AgreementState.Complete,
      totalRepaid: 150_000n,
    });
    const shortTerm = agreement({
      state: AgreementState.Complete,
      totalRepaid: 20_000n,
    });
    expect(describeAgreement(capped, T0).status).toBe("Fully repaid");
    expect(describeAgreement(capped, T0).tone).toBe("good");
    expect(describeAgreement(shortTerm, T0).status).toBe("Closed out");
    expect(describeAgreement(shortTerm, T0).tone).toBe("over");
  });

  it("says nothing further is owed once complete", () => {
    expect(
      explain(agreement({ state: AgreementState.Complete, totalRepaid: 150_000n }), T0)
    ).toContain("Nothing further is owed");
  });
});

describe("what can be done about an agreement", () => {
  it("offers closing out to anyone once it is finished", () => {
    const over = agreement({ totalRepaid: 150_000n });
    expect(pendingAction(over, T0)).toBe("close");
    expect(pendingAction({ ...over, role: "funder" }, T0)).toBe("close");
  });

  it("offers closing out when the term has ended", () => {
    const a = agreement();
    expect(pendingAction(a, Number(a.termEnd))).toBe("close");
  });

  it("has the recipient as the only person with anything to declare mid-term", () => {
    expect(pendingAction(agreement({ role: "recipient" }), T0)).toBe("declare");
    expect(pendingAction(agreement({ role: "funder" }), T0)).toBeNull();
  });

  it("offers nothing on a completed agreement", () => {
    expect(
      pendingAction(agreement({ state: AgreementState.Complete }), T0)
    ).toBeNull();
  });
});

describe("the recorded wording", () => {
  const input = {
    funderName: "Priya",
    recipientName: "Rahul",
    fundingPaise: 100_000n,
    percent: 10,
    capPaise: 150_000n,
    termEndSeconds: T0 + 365 * DAY,
    drawnUpOn: new Date("2026-10-12T10:00:00Z"),
  };

  it("is byte-identical for identical input, so a hash of it is stable", () => {
    expect(termsDocument(input)).toBe(termsDocument({ ...input }));
  });

  it("names both people and the figures that were agreed", () => {
    const text = termsDocument(input);
    expect(text).toContain("Priya funds Rahul");
    expect(text).toContain("10% of their income");
    expect(text).toContain("₹1,500");
  });

  it("differs when drawn up on a different day, so two agreements do not collide", () => {
    const later = termsDocument({
      ...input,
      drawnUpOn: new Date("2026-10-13T10:00:00Z"),
    });
    expect(later).not.toBe(termsDocument(input));
  });

  it("says plainly that it is not a loan, not signed and has no legal force", () => {
    const text = termsDocument(input);
    expect(text).toContain("not a loan agreement");
    expect(text).toContain("nothing here has been signed");
    expect(text).toContain("no legal force");
  });
});

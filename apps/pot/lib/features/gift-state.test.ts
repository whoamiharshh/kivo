/**
 * Which button a gift offers, and to whom.
 *
 * ──────────────── why this is worth testing ────────────────
 *
 * A gift is the only thing in this app read by three different people — the
 * giver, the recipient, and a confirmer who is neither. Each sees one button,
 * chosen by `pendingAction`. Get it wrong and somebody is offered an action
 * the contract will reject, or worse, is offered nothing while their money
 * waits on a tap they were never shown.
 *
 * Clicking through a browser cannot check this: every screen sits behind a
 * Google sign-in, so a manual pass proves one person's path at best. These
 * are pure functions of a gift, a viewer and a clock, so all three roles can
 * be checked at once — including the states that take a month of real time to
 * reach.
 *
 * Every expectation below mirrors a rule in Gift.sol, and where the two could
 * drift the comment names the rule being mirrored.
 */

import { describe, expect, it } from "vitest";
import {
  ConditionType,
  GiftState,
  describeGift,
  pendingAction,
  secondsUntilTimeout,
  waitLabel,
  type GiftView,
} from "./gift-state";

const GIVER = "0x1111111111111111111111111111111111111111" as const;
const TAKER = "0x2222222222222222222222222222222222222222" as const;
const CONFIRMER = "0x3333333333333333333333333333333333333333" as const;
const NOBODY = "0x9999999999999999999999999999999999999999" as const;

const NOW = 1_800_000_000;
const DAY = 86_400;

/** A condition gift, pending, seen by whoever is asking. */
function gift(over: Partial<GiftView> = {}): GiftView {
  return {
    sender: GIVER,
    recipient: TAKER,
    amount: 50_00n,
    conditionHash: `0x${"ab".repeat(32)}` as `0x${string}`,
    releaseTime: 0n,
    attester: CONFIRMER,
    irrevocable: false,
    createdAt: BigInt(NOW - DAY),
    timeoutAt: BigInt(NOW + 30 * DAY),
    conditionType: ConditionType.Attestation,
    state: GiftState.Pending,
    id: 1,
    message: "When you finish your exams",
    sending: false,
    otherName: "Someone",
    otherAddress: GIVER,
    ...over,
  };
}

describe("who is offered what, while a condition gift waits", () => {
  it("asks the confirmer to confirm", () => {
    expect(pendingAction(gift(), CONFIRMER, NOW)).toBe("confirm");
  });

  it("offers the giver the chance to take it back", () => {
    expect(pendingAction(gift(), GIVER, NOW)).toBe("cancel");
  });

  it("offers the recipient nothing until it is confirmed", () => {
    // Gift.sol: claim() requires state == Attested. A button here would be a
    // button that is guaranteed to revert.
    expect(pendingAction(gift(), TAKER, NOW)).toBeNull();
  });

  it("offers a bystander nothing", () => {
    expect(pendingAction(gift(), NOBODY, NOW)).toBeNull();
  });

  it("offers nothing at all when nobody is signed in", () => {
    expect(pendingAction(gift(), undefined, NOW)).toBeNull();
  });
});

describe("a firm promise cannot be taken back", () => {
  it("withdraws the giver's cancel once it is irrevocable", () => {
    // Gift.sol: cancel() reverts with GiftIsIrrevocable.
    expect(pendingAction(gift({ irrevocable: true }), GIVER, NOW)).toBeNull();
  });

  it("still lets the confirmer confirm it", () => {
    expect(pendingAction(gift({ irrevocable: true }), CONFIRMER, NOW)).toBe(
      "confirm"
    );
  });
});

describe("once it is confirmed", () => {
  const attested = gift({ state: GiftState.Attested });

  it("offers the recipient the money", () => {
    expect(pendingAction(attested, TAKER, NOW)).toBe("claim");
  });

  it("offers the giver nothing — it is no longer theirs to pull", () => {
    expect(pendingAction(attested, GIVER, NOW)).toBeNull();
  });

  it("offers the confirmer nothing more to do", () => {
    expect(pendingAction(attested, CONFIRMER, NOW)).toBeNull();
  });
});

describe("the escape hatch, when nobody ever confirms", () => {
  it("offers the recipient nothing while the wait is still running", () => {
    expect(pendingAction(gift(), TAKER, NOW)).toBeNull();
  });

  it("lets the recipient take it once the wait has run out", () => {
    // Gift.sol: requestTimeoutRelease() requires now >= timeoutAt.
    expect(pendingAction(gift(), TAKER, NOW + 31 * DAY)).toBe("release");
  });

  it("does not offer that escape to anybody else", () => {
    const later = NOW + 31 * DAY;
    expect(pendingAction(gift(), NOBODY, later)).toBeNull();
    expect(pendingAction(gift(), CONFIRMER, later)).toBe("confirm");
  });
});

describe("a date gift involves nobody", () => {
  const dated = gift({
    conditionType: ConditionType.Time,
    attester: "0x0000000000000000000000000000000000000000",
    releaseTime: BigInt(NOW + 10 * DAY),
  });

  it("offers the recipient nothing before the date", () => {
    expect(pendingAction(dated, TAKER, NOW)).toBeNull();
  });

  it("offers the recipient the money on the day", () => {
    expect(pendingAction(dated, TAKER, NOW + 10 * DAY)).toBe("claim");
  });

  it("lets the giver take it back while it waits", () => {
    expect(pendingAction(dated, GIVER, NOW)).toBe("cancel");
  });
});

describe("a finished gift offers nothing to anybody", () => {
  for (const state of [
    GiftState.Claimed,
    GiftState.Cancelled,
    GiftState.Released,
  ]) {
    it(`state ${state}`, () => {
      const done = gift({ state });
      for (const who of [GIVER, TAKER, CONFIRMER, NOBODY]) {
        expect(pendingAction(done, who, NOW)).toBeNull();
      }
    });
  }
});

describe("the words each side reads", () => {
  it("says the same gift differently to each party", () => {
    const attested = gift({ state: GiftState.Attested });
    expect(describeGift({ ...attested, sending: true }, NOW).status).toBe(
      "Ready for them"
    );
    expect(describeGift({ ...attested, sending: false }, NOW).status).toBe(
      "Ready to take"
    );
  });

  it("calls a date gift ready once its day arrives", () => {
    const dated = gift({
      conditionType: ConditionType.Time,
      releaseTime: BigInt(NOW + DAY),
    });
    expect(describeGift(dated, NOW).status).toBe("Waiting for the date");
    expect(describeGift(dated, NOW + DAY).tone).toBe("good");
  });

  it("never claims anything was verified", () => {
    // The feature's standing rule: a person said so. No status may imply the
    // software checked anything.
    const states = [
      GiftState.Pending,
      GiftState.Attested,
      GiftState.Claimed,
      GiftState.Cancelled,
      GiftState.Released,
    ];
    for (const state of states) {
      for (const sending of [true, false]) {
        const { status } = describeGift(gift({ state, sending }), NOW);
        expect(status.toLowerCase()).not.toContain("verif");
      }
    }
  });
});

describe("the wait, in words", () => {
  it("never reports a negative wait", () => {
    expect(secondsUntilTimeout(gift(), NOW + 999 * DAY)).toBe(0);
    expect(waitLabel(-5)).toBe("now");
  });

  it("reads as a person would say it", () => {
    expect(waitLabel(3 * DAY)).toBe("in 3 days");
    expect(waitLabel(DAY + 100)).toBe("tomorrow");
    expect(waitLabel(5 * 3600)).toBe("in 5 hours");
    expect(waitLabel(60)).toBe("within the hour");
  });
});

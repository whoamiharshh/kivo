/**
 * Share what you earn — the types and the state logic, with no client
 * dependency.
 *
 * ──────────────── why this is a separate file ────────────────
 *
 * Same reason as `pay-state.ts`: `agreement.ts` carries "use client" because it
 * holds React Query hooks and a wagmi client, and that directive applies to the
 * whole module. A Server Component calling a pure function exported from there
 * gets "Attempted to call describe() from the server but describe is on the
 * client". So the enums, shapes and pure functions live here, where both sides
 * can import them, and `agreement.ts` re-exports them for client code that
 * wants one import.
 *
 * ──────────────── what this feature actually is ────────────────
 *
 * **IncomeShare holds no money. It is a ledger, not an escrow.**
 *
 * There is no `transfer` in the contract, it has no balance, and there is
 * nothing to withdraw — the test it is proudest of is literally called
 * `test_TheContractNeverHoldsAnything`. Somebody funds somebody else on a
 * licensed counterparty's payment rails, outside this app entirely, and what
 * gets kept here is an account of it that neither side can quietly edit: the
 * terms, the hash of the agreement they signed, and each repayment the
 * recipient themselves confirmed.
 *
 * That is why `ready.agreements` in `lib/contracts.ts` does not require the
 * test-money address, unlike every other feature's flag. No token ever touches
 * this contract, so there is no token address to need.
 *
 * Every word in this module is chosen so the UI cannot drift into implying
 * otherwise. "Recorded" and "on record", never "paid" or "held".
 */

/** Mirrors IncomeShare.State. Index matters: it is the on-chain enum. */
export const AgreementState = {
  None: 0,
  Active: 1,
  Complete: 2,
} as const;
export type AgreementStateValue =
  (typeof AgreementState)[keyof typeof AgreementState];

/**
 * Mirrors IncomeShare.Agreement.
 *
 * Amounts are paise. `termEnd` is unix seconds. `repaymentPercent` is whole
 * percent, 1 to 100 — the contract's own unit, so nothing here has to divide by
 * 100 twice.
 *
 * `repaymentCount` is a `number` rather than a `bigint` because it is a uint32
 * on the wire and viem decodes anything up to uint48 as a plain number.
 */
export type Agreement = {
  funder: `0x${string}`;
  recipient: `0x${string}`;
  fundingAmount: bigint;
  repaymentPercent: bigint;
  cap: bigint;
  totalRepaid: bigint;
  termEnd: bigint;
  repaymentCount: number;
  /** Hash of the plain-language terms both sides agreed. Never zero. */
  agreementHash: `0x${string}`;
  state: AgreementStateValue;
};

/** Mirrors IncomeShare.Repayment — one month on record. */
export type Repayment = {
  /** The income figure the recipient declared. Self-declared. See below. */
  income: bigint;
  /** The share of it that went on record as repaid. */
  amount: bigint;
  recordedAt: bigint;
};

/** An agreement plus everything the UI needs that is not on the chain. */
export type AgreementView = Agreement & {
  id: number;
  /**
   * Which side the signed-in person is on. Decides every label on screen, and
   * getting it backwards would tell somebody they owe money they are owed.
   */
  role: "funder" | "recipient";
  /** The other party's display name, or a shortened tag as a fallback. */
  otherName: string;
  otherAddress: `0x${string}`;
  funderName: string;
  recipientName: string;
  /**
   * The plain-language terms text, recovered from Supabase by its hash. Empty
   * when this browser and this project have never seen the document — which is
   * possible and must not look like an error.
   */
  terms: string;
  /**
   * Whether the terms text we recovered really hashes to the hash on record.
   *
   * `null` means there is no text on file to check, which is different from
   * "checked and wrong" and has to read differently on screen.
   * `test_TheDocumentHashIsWhatTiesTheRecordToTheAgreement` is the contract
   * side of this: the hash exists so an edit to the document is detectable.
   */
  termsMatch: boolean | null;
};

/** The contract's own bounds on the share of income (`BadPercent`). */
export const MIN_PERCENT = 1;
export const MAX_PERCENT = 100;

/**
 * 0x1234…abcd — but prefixed, because this app never shows a bare address.
 *
 * Imported from `pay-state.ts` rather than copied: it is one pure function with
 * no feature knowledge in it, and two copies would be two places to get the
 * slice indices wrong.
 */
export { shortAddress } from "./pay-state";

/**
 * The share of one month's income, in paise.
 *
 * ──────────────── why this arithmetic is duplicated on purpose ────────────────
 *
 * The contract does NOT compute this. `recordRepayment` records the figure the
 * recipient signed and checks only that it does not breach the cap, because the
 * agreement's definition of income, its rounding and any floor live in the
 * legal document rather than in Solidity.
 *
 * `app/api/trust/attest-income/route.ts` is the authority on the number that
 * actually gets recorded; this is the preview the recipient sees *before* they
 * confirm. The two must agree to the paisa, so this is a deliberate mirror of
 * that line — integer division included. Truncating favours the recipient by at
 * most one paisa a month, and rounding a debt upward would be worse.
 *
 * All of it in `bigint`: a float here would be a product that charges somebody
 * ₹1,666.6666666666667.
 */
export function monthlyShare(incomePaise: bigint, percent: bigint): bigint {
  if (incomePaise <= 0n || percent <= 0n) return 0n;
  return (incomePaise * percent) / 100n;
}

/** How much more could ever go on record. Mirrors `remainingToCap`. */
export function remainingToCap(a: Pick<Agreement, "cap" | "totalRepaid">) {
  return a.totalRepaid >= a.cap ? 0n : a.cap - a.totalRepaid;
}

/**
 * What would actually be recorded for a given income, clipped to the cap.
 *
 * The server clips rather than letting the contract revert `CapExceeded`, so
 * the preview has to clip too — otherwise the last month of an agreement shows
 * a figure nobody will ever confirm.
 */
export function shareAfterCap(
  a: Pick<Agreement, "cap" | "totalRepaid" | "repaymentPercent">,
  incomePaise: bigint
): bigint {
  const share = monthlyShare(incomePaise, a.repaymentPercent);
  const left = remainingToCap(a);
  return share < left ? share : left;
}

/** True once the cap is reached or the term has run out. Mirrors `isFinished`. */
export function isFinished(
  a: Pick<Agreement, "cap" | "totalRepaid" | "termEnd">,
  nowSeconds: number
): boolean {
  return a.totalRepaid >= a.cap || nowSeconds >= Number(a.termEnd);
}

/**
 * The word and tone for an agreement, from the signed-in person's point of
 * view.
 *
 * ──────────────── one state, two readings ────────────────
 *
 * `Active` means something completely different depending on which side you are
 * on. The recipient is the one who owes a declaration each month; the funder is
 * waiting and has nothing to do. The same row therefore has to say "You are
 * repaying" to one person and "Being repaid" to the other, exactly as
 * `describe()` in `pay-state.ts` does for a held payment.
 *
 * `nowSeconds` is optional for the same reason it is there: without it a live
 * agreement always reads as live, which is wrong the moment the term runs out
 * and the thing is waiting to be closed out.
 */
export function describe(
  a: AgreementView,
  nowSeconds?: number
): { status: string; tone: "progress" | "good" | "attention" | "over" } {
  switch (a.state) {
    case AgreementState.Active: {
      // The cap closes an agreement by itself, so Active plus a reached cap can
      // only mean the closing record has not landed yet. Rare, and it still has
      // to say something true.
      if (a.totalRepaid >= a.cap) {
        return { status: "Ready to close", tone: "attention" };
      }
      const termOver =
        nowSeconds !== undefined && nowSeconds >= Number(a.termEnd);
      if (termOver) return { status: "Term over", tone: "attention" };
      return a.role === "recipient"
        ? { status: "You are repaying", tone: "progress" }
        : { status: "Being repaid", tone: "progress" };
    }
    case AgreementState.Complete:
      // Reaching the cap is the good ending for both sides: the recipient owes
      // nothing more, the funder got everything the terms allowed. Running out
      // of term is just an ending, so it gets the quiet tone rather than the
      // green one — calling a short-fall "complete" in emerald would be a lie
      // told in colour.
      return a.totalRepaid >= a.cap
        ? { status: "Fully repaid", tone: "good" }
        : { status: "Closed out", tone: "over" };
    default:
      return { status: "Unknown", tone: "over" };
  }
}

/**
 * The one sentence under the status, which says what is true rather than
 * repeating the badge.
 */
export function explain(a: AgreementView, nowSeconds: number): string {
  if (a.state === AgreementState.Complete) {
    return a.totalRepaid >= a.cap
      ? "The cap was reached. Nothing further is owed."
      : "The term ended. Nothing further is owed.";
  }
  if (a.totalRepaid >= a.cap) {
    return "The cap has been reached. Anyone can close this out now.";
  }
  if (nowSeconds >= Number(a.termEnd)) {
    return "The term has ended. Anyone can close this out now.";
  }
  return a.role === "recipient"
    ? `You repay ${a.repaymentPercent}% of what you earn each month, up to the cap.`
    : `${a.recipientName} repays ${a.repaymentPercent}% of what they earn each month, up to the cap.`;
}

/**
 * What this person can do about this agreement right now, if anything.
 *
 * `nowSeconds` is a parameter rather than a call to the clock so the same input
 * always gives the same answer — a server render and the browser render that
 * follows it must agree, or the row flickers on hydration.
 *
 * Note what is deliberately NOT here: there is no "sign" action. The contract
 * has no acceptance step — the terms and the document hash are fixed at
 * creation and can never be rewritten. The recipient's consent is given per
 * repayment, with their own confirmation over that exact income figure, which
 * is the thing `recordRepayment` will not proceed without. A screen offering a
 * one-off "sign the agreement" button would be inventing a step the contract
 * does not have.
 */
export function pendingAction(
  a: AgreementView,
  nowSeconds: number
): "declare" | "close" | null {
  if (a.state !== AgreementState.Active) return null;

  // Closing out comes first when it is possible, because it is the objective
  // fact — both conditions are permissionless and either side can act on them.
  if (isFinished(a, nowSeconds)) return "close";

  return a.role === "recipient" ? "declare" : null;
}

/* ═══════════════════════════ the document ═══════════════════════════ */

/**
 * The plain-language terms, built from the fields, as one exact string.
 *
 * ──────────────── why this function exists at all ────────────────
 *
 * `createAgreement` refuses a zero `agreementHash`
 * (`test_RevertWhen_ThereIsNoSignedDocument`): an agreement with no document
 * behind it is not an agreement. In a real product that hash is of a signed PDF
 * from a licensed lending partner. There is no such partner and no such PDF
 * here — see docs/limitations.md, "What requires a licensed partner" — so
 * inventing a hash of nothing would be the dishonest option, and so would
 * hashing a document the person never read.
 *
 * What this does instead: write the terms out in words, show that exact text on
 * screen before anything is recorded, and hash what was shown. The hash on
 * record then really does identify a document both people could read, and a
 * later edit to our stored copy is detectable, which is the whole point of the
 * hash. It is not a legal agreement and the screen says so in these words.
 *
 * The string must be byte-identical between the preview and the hashing, so it
 * is built once, here, and passed around — never rebuilt from the fields a
 * second time.
 *
 * `drawnUpOn` is in the text so two agreements with identical numbers do not
 * collide onto one hash and one stored document.
 */
export function termsDocument(input: {
  funderName: string;
  recipientName: string;
  fundingPaise: bigint;
  percent: number;
  capPaise: bigint;
  termEndSeconds: number;
  drawnUpOn: Date;
}): string {
  const rupees = (paise: bigint) => {
    const whole = paise / 100n;
    const frac = paise % 100n;
    const tail = frac === 0n ? "" : `.${frac.toString().padStart(2, "0")}`;
    return `₹${whole.toLocaleString("en-IN")}${tail}`;
  };
  const date = (seconds: number) =>
    new Date(seconds * 1000).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });

  return [
    "INCOME SHARE — AGREED TERMS",
    "",
    `Drawn up on ${date(Math.floor(input.drawnUpOn.getTime() / 1000))}.`,
    "",
    `1. ${input.funderName} funds ${input.recipientName} ${rupees(input.fundingPaise)}.`,
    `2. ${input.recipientName} repays ${input.percent}% of their income each month.`,
    `3. Repayments stop at a total of ${rupees(input.capPaise)}, or on ${date(input.termEndSeconds)}, whichever comes first.`,
    `4. ${input.recipientName} owes nothing after that, whatever the total reached.`,
    "",
    "HOW INCOME IS ESTABLISHED",
    `Each month ${input.recipientName} states what they earned. Nothing checks`,
    "that figure against a bank, a payslip or any other source. It is a",
    "self-declaration and both people are agreeing to treat it as one.",
    "",
    "WHERE THE MONEY IS",
    "No money moves through this app and none is held by it. The funding and",
    "every repayment happen between the two people, elsewhere. What is kept",
    "here is only a record of what was agreed and what was confirmed.",
    "",
    "WHAT THIS IS NOT",
    "This is a prototype running on test money. It is not a loan agreement,",
    "nothing here has been signed, and no lending partner is involved. It",
    "carries no interest, no fees and no legal force.",
  ].join("\n");
}

/**
 * The month a declaration is filed under, as YYYY-MM-01.
 *
 * The first of the month rather than today, because the server stores one row
 * per agreement per month and rejects a second — filing under today's date
 * would let somebody declare again tomorrow for the same month.
 *
 * Built from the BROWSER's calendar on purpose: somebody declaring October's
 * income at 11pm on the 31st in Delhi means October, and a server computing UTC
 * would file it as November.
 */
export function monthKey(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
}

/** "October 2026", for showing which month a declaration covers. */
export function monthLabel(key: string): string {
  const parsed = new Date(`${key}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return key;
  return parsed.toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

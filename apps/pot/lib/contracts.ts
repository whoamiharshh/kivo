import { monadTestnet } from "viem/chains";

export const chain = monadTestnet;

/**
 * Where each contract lives, filled in after the one-time deploy (README,
 * step 2). Addresses are public information, so they are NEXT_PUBLIC_*.
 *
 * Each feature checks its OWN address rather than one global flag, so a
 * half-configured deployment shows "not set up yet" on the screens that need
 * the missing contract and works normally everywhere else. A single
 * `contractsConfigured` would make every screen fail because one address was
 * blank, which is how a demo dies on stage.
 */
/**
 * Each name is written out IN FULL, deliberately.
 *
 * Next.js replaces `process.env.NEXT_PUBLIC_FOO` in browser code by matching
 * that text and substituting the value at build time. It is a textual
 * substitution, not a lookup, so a computed access — `process.env[name]`, as
 * this file used to do — is never substituted and reads as `undefined` in the
 * browser. Every address silently became "", `ready.*` was false everywhere,
 * and all eight features showed "not set up yet" however carefully the
 * environment had been filled in.
 *
 * Verified rather than assumed: building with a sentinel value, the literal
 * form appears in `.next/static`, the computed form does not.
 *
 * The cost of the honest version is one line per contract and no helper. Keep
 * it that way — a loop over names here is the same bug written differently.
 */
const clean = (value: string | undefined): `0x${string}` =>
  (value ?? "") as `0x${string}`;

export const TEST_RUPEE_ADDRESS = clean(
  process.env.NEXT_PUBLIC_TEST_RUPEE_ADDRESS
);
export const POT_MANAGER_ADDRESS = clean(
  process.env.NEXT_PUBLIC_POT_MANAGER_ADDRESS
);
export const SOCIAL_PAY_ADDRESS = clean(
  process.env.NEXT_PUBLIC_SOCIAL_PAY_ADDRESS
);
export const GIFT_ADDRESS = clean(process.env.NEXT_PUBLIC_GIFT_ADDRESS);
export const BEHAVIOUR_SAVINGS_ADDRESS = clean(
  process.env.NEXT_PUBLIC_BEHAVIOUR_SAVINGS_ADDRESS
);
export const SALARY_STREAM_ADDRESS = clean(
  process.env.NEXT_PUBLIC_SALARY_STREAM_ADDRESS
);
export const INCOME_SHARE_ADDRESS = clean(
  process.env.NEXT_PUBLIC_INCOME_SHARE_ADDRESS
);
export const MICRO_COVER_ADDRESS = clean(
  process.env.NEXT_PUBLIC_MICRO_COVER_ADDRESS
);
export const ACCOUNTABILITY_POOL_ADDRESS = clean(
  process.env.NEXT_PUBLIC_ACCOUNTABILITY_POOL_ADDRESS
);

const looksLikeAddress = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a);

/** Is one address usable? */
export const isSet = looksLikeAddress;

/** Every feature needs test money, so every feature needs this too. */
export const tokenConfigured = looksLikeAddress(TEST_RUPEE_ADDRESS);

/** Per-feature readiness. The UI asks these, not a single global. */
export const ready = {
  pots: tokenConfigured && looksLikeAddress(POT_MANAGER_ADDRESS),
  pay: tokenConfigured && looksLikeAddress(SOCIAL_PAY_ADDRESS),
  gifts: tokenConfigured && looksLikeAddress(GIFT_ADDRESS),
  savings: tokenConfigured && looksLikeAddress(BEHAVIOUR_SAVINGS_ADDRESS),
  streams: tokenConfigured && looksLikeAddress(SALARY_STREAM_ADDRESS),
  agreements: looksLikeAddress(INCOME_SHARE_ADDRESS),
  policies: tokenConfigured && looksLikeAddress(MICRO_COVER_ADDRESS),
  pools: tokenConfigured && looksLikeAddress(ACCOUNTABILITY_POOL_ADDRESS),
} as const;

/** Kept for the screens written before the split. */
export const contractsConfigured = ready.pots;

/** Block the contracts were deployed in — keeps every log scan cheap. */
export const DEPLOY_BLOCK = BigInt(process.env.NEXT_PUBLIC_DEPLOY_BLOCK ?? "0");

export {
  potManagerAbi,
  testRupeeAbi,
  socialPayAbi,
  giftAbi,
  behaviourSavingsAbi,
  salaryStreamAbi,
  incomeShareAbi,
  microCoverAbi,
  accountabilityPoolAbi,
} from "./abis";

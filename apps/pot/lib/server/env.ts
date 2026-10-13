/**
 * Server-only configuration.
 *
 * Importing this from a client component is a build error, which is the point:
 * none of these values may ever reach the browser. Every getter fails closed —
 * a missing secret throws rather than quietly degrading, because the thing it
 * would degrade into is "trust whatever the frontend said".
 */
import "server-only";
import { privateKeyToAccount } from "viem/accounts";

const COMPROMISED_TRUST_SIGNER_ADDRESS =
  "0xbe4ad8cc900e5824440526e7669a82881c661d94";

export class TrustSignerUnavailableError extends Error {
  readonly reason = "signer_unavailable";

  constructor(message: string) {
    super(message);
    this.name = "TrustSignerUnavailableError";
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. The trust layer refuses to run without it — see README, "Trust layer setup".`
    );
  }
  return value;
}

/** Privy app ID. Public, but read here so the server never depends on the client's copy. */
export const PRIVY_APP_ID = () => required("NEXT_PUBLIC_PRIVY_APP_ID");

/** Privy app secret. Server only, never NEXT_PUBLIC_. */
export const PRIVY_APP_SECRET = () => required("PRIVY_APP_SECRET");

/**
 * The token verification key from the Privy dashboard
 * (Settings → Basics → Verification key), as an SPKI PEM.
 *
 * Privy's SDK can also fetch this over the network per request. We require it
 * up front instead: one less network dependency on the path that decides
 * whether a caller is who they claim to be.
 */
export const PRIVY_VERIFICATION_KEY = () =>
  required("PRIVY_VERIFICATION_KEY").replace(/\\n/g, "\n");

/** Supabase project URL. */
export const SUPABASE_URL = () => required("NEXT_PUBLIC_SUPABASE_URL");

/**
 * The Supabase secret (service-role) key. Bypasses RLS, so it lives only here.
 * If this ever appears in a NEXT_PUBLIC_ variable, every row in the database is
 * readable by anyone who opens the site.
 */
export const SUPABASE_SECRET_KEY = () => required("SUPABASE_SECRET_KEY");

/** Secret used only by the scheduled server-side Pot history indexer. */
export const POT_INDEXER_SECRET = () => required("POT_INDEXER_SECRET");

/**
 * The private key the server signs authorizations with, as 0x + 64 hex.
 *
 * This key signs authorizations and attestations trusted by deployed
 * contracts. On the current testnet deployment it is PotManager's join
 * signer, AccountabilityPool's attester, IncomeShare's recorder, and
 * MicroCover's insurer signer. The server also submits IncomeShare repayment
 * records with it. It is not a generic contract admin, but its signatures can
 * affect contract outcomes; a leaked key must be treated as compromised.
 * These contract roles are immutable, so changing this environment value alone
 * does not revoke the old key and can make existing actions fail.
 *
 * Generate one with:  openssl rand -hex 32
 * and prefix it with 0x. Never reuse a key that holds funds.
 */
export const TRUST_SIGNER_KEY = () => {
  assertTrustSignerEnabled();
  const key = required('TRUST_SIGNER_KEY');
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(
      'TRUST_SIGNER_KEY must be 0x followed by 64 hex characters. ' +
        'Generate one with: openssl rand -hex 32'
    );
  }
    assertTrustSignerEnabled(privateKeyToAccount(key as `0x${string}`).address);
  return key as `0x${string}`;
};

  export function assertTrustSignerEnabled(address?: string): void {
    if (process.env.TRUST_SIGNER_ENABLED !== "true") {
      throw new TrustSignerUnavailableError(
        "Server signing is disabled. Enable it only after an approved replacement signer is deployed and verified."
      );
    }

    if (address?.toLowerCase() === COMPROMISED_TRUST_SIGNER_ADDRESS) {
      throw new TrustSignerUnavailableError(
        "The configured signer is the compromised legacy signer; refusing to sign or write."
      );
    }
  }

/**
 * The address allowed to resolve disputes, matching SocialPay's arbitrator.
 * A placeholder for a decentralised arbitration layer — see README.
 */
export const ARBITRATOR_ADDRESS = () =>
  required("NEXT_PUBLIC_ARBITRATOR_ADDRESS").toLowerCase();

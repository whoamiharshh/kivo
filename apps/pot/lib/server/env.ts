/**
 * Server-only configuration.
 *
 * Importing this from a client component is a build error, which is the point:
 * none of these values may ever reach the browser. Every getter fails closed —
 * a missing secret throws rather than quietly degrading, because the thing it
 * would degrade into is "trust whatever the frontend said".
 */
import "server-only";

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

/**
 * The private key the server signs authorizations with, as 0x + 64 hex.
 *
 * This is the `trustSigner` passed to PotManager at deploy time. What it can
 * do: admit a joiner to a pot whose invite code the server has checked. What it
 * cannot do: spend, approve, close or refund anything. Still a secret worth
 * keeping - a leak lets somebody add themselves to any open pot.
 *
 * Generate one with:  openssl rand -hex 32
 * and prefix it with 0x. Never reuse a key that holds funds.
 */
export const TRUST_SIGNER_KEY = () => {
  const key = required('TRUST_SIGNER_KEY');
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(
      'TRUST_SIGNER_KEY must be 0x followed by 64 hex characters. ' +
        'Generate one with: openssl rand -hex 32'
    );
  }
  return key as `0x${string}`;
};

/**
 * The address allowed to resolve disputes, matching SocialPay's arbitrator.
 * A placeholder for a decentralised arbitration layer — see README.
 */
export const ARBITRATOR_ADDRESS = () =>
  required("NEXT_PUBLIC_ARBITRATOR_ADDRESS").toLowerCase();

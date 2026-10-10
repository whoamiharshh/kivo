/**
 * Who is calling, according to Privy rather than according to the request body.
 *
 * Two tokens arrive from the browser and both are verified here:
 *
 *   - the **access token** proves a live session and yields the Privy DID;
 *   - the **identity token** carries the user's linked accounts, which is where
 *     the embedded wallet address and the passkey enrolment come from.
 *
 * The address is never taken from the client's JSON. A caller may lie about
 * which address they are sending from; they cannot lie about what Privy has on
 * record for their own DID, because both tokens are signed by Privy and
 * verified against the app's verification key.
 *
 * Verified against @privy-io/node 0.35.0, whose exported signatures are:
 *   verifyAccessToken({ access_token, app_id, verification_key }) -> { user_id, ... }
 *   verifyIdentityToken({ identity_token, app_id, verification_key }) -> User
 *   isEmbeddedWalletLinkedAccount(account) -> account is LinkedAccountEmbeddedWallet
 */
import "server-only";
import {
  verifyAccessToken,
  verifyIdentityToken,
  isEmbeddedWalletLinkedAccount,
  type LinkedAccount,
} from "@privy-io/node";
import { PRIVY_APP_ID, PRIVY_VERIFICATION_KEY } from "./env";

/** A verified caller. Everything here came from a Privy-signed token. */
export type Caller = {
  /** Privy DID, e.g. did:privy:… */
  did: string;
  /** Their embedded Ethereum address, lowercased. */
  address: `0x${string}`;
  /** Whether Privy's own record shows an enrolled passkey. */
  hasPasskey: boolean;
  /** Privy session the access token was issued for. */
  sessionId: string;
};

/** Thrown when a caller cannot be established. Always answered with 401/403. */
export class CallerError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403,
    readonly reason: string
  ) {
    super(message);
    this.name = "CallerError";
  }
}

const ACCESS_HEADER = "authorization";
const IDENTITY_HEADER = "x-privy-id-token";

function readTokens(request: Request) {
  const auth = request.headers.get(ACCESS_HEADER) ?? "";
  const accessToken = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";
  const identityToken = request.headers.get(IDENTITY_HEADER)?.trim() ?? "";
  return { accessToken, identityToken };
}

/** The user's embedded Ethereum wallet, or null if Privy has none on record. */
function embeddedEthereumAddress(
  linkedAccounts: LinkedAccount[]
): `0x${string}` | null {
  for (const account of linkedAccounts) {
    if (!isEmbeddedWalletLinkedAccount(account)) continue;
    if (account.chain_type !== "ethereum") continue;
    return account.address.toLowerCase() as `0x${string}`;
  }
  return null;
}

function hasPasskeyAccount(linkedAccounts: LinkedAccount[]): boolean {
  return linkedAccounts.some((account) => account.type === "passkey");
}

/**
 * Verify both tokens and return the caller. Throws `CallerError` on anything
 * suspicious — there is no "probably fine" branch.
 */
export async function verifyCaller(request: Request): Promise<Caller> {
  const { accessToken, identityToken } = readTokens(request);

  if (!accessToken) {
    throw new CallerError("Not signed in.", 401, "missing_access_token");
  }
  if (!identityToken) {
    // Requires "Return user data in an identity token" to be on in the Privy
    // dashboard (User management → Authentication → Advanced).
    throw new CallerError("Not signed in.", 401, "missing_identity_token");
  }

  const appId = PRIVY_APP_ID();
  const verificationKey = PRIVY_VERIFICATION_KEY();

  let claims;
  try {
    claims = await verifyAccessToken({
      access_token: accessToken,
      app_id: appId,
      verification_key: verificationKey,
    });
  } catch {
    throw new CallerError("Session expired.", 401, "bad_access_token");
  }

  let user;
  try {
    user = await verifyIdentityToken({
      identity_token: identityToken,
      app_id: appId,
      verification_key: verificationKey,
    });
  } catch {
    throw new CallerError("Session expired.", 401, "bad_identity_token");
  }

  // Both tokens must describe the same person. A mismatch means someone is
  // pairing their own session with somebody else's identity token.
  if (!user.id || user.id !== claims.user_id) {
    throw new CallerError("Session mismatch.", 403, "token_subject_mismatch");
  }

  const linkedAccounts = (user.linked_accounts ?? []) as LinkedAccount[];
  const address = embeddedEthereumAddress(linkedAccounts);
  if (!address) {
    throw new CallerError(
      "Your account is still being set up. Try again in a moment.",
      403,
      "no_embedded_wallet"
    );
  }

  return {
    did: claims.user_id,
    address,
    hasPasskey: hasPasskeyAccount(linkedAccounts),
    sessionId: claims.session_id,
  };
}

/**
 * Confirm that an address the client sent is the caller's own.
 *
 * Routes call this rather than reading an address out of the body, so a request
 * can never initiate a payment from an account the caller does not own.
 */
export function assertOwnAddress(caller: Caller, claimed: unknown): void {
  if (typeof claimed !== "string") return; // nothing claimed, nothing to check
  if (claimed.toLowerCase() !== caller.address) {
    throw new CallerError(
      "That account isn't yours.",
      403,
      "address_did_mismatch"
    );
  }
}

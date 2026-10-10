/**
 * Superseded by `trust-signer.ts`.
 *
 * This was the join-only signer written while fixing C-1, before the unified
 * trust layer existed. Everything moved there; this file re-exports rather
 * than keeping a second copy of the digest formula, because two copies of a
 * digest formula is exactly how the server and the contract end up disagreeing.
 *
 * Nothing imports this. It exists so an import written against the old path
 * fails loudly at the type level if the export it wants is gone, rather than
 * resolving to a stale implementation.
 */
import "server-only";

export {
  signJoin,
  joinDigest,
  trustSignerAddress,
  TTL_SECONDS,
  type Authorization,
} from "./trust-signer";

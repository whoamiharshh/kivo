/**
 * POST /api/trust/authorize-join — kept as an alias.
 *
 * This was the narrow, join-only route built while fixing C-1. The unified
 * trust layer replaced it with `authorize-action`, which does the same invite
 * check and also records a nonce. Rather than leave two implementations to
 * drift apart, this path re-exports the real one.
 *
 * It expects the same body as `authorize-action` (`{ action: "join_pot", … }`).
 * Nothing in the app calls it; it exists so a client built against the old URL
 * keeps working instead of getting a 404.
 */
export { POST } from "../authorize-action/route";

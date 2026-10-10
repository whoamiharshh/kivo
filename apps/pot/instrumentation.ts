/**
 * Next.js runs `register()` once, when the server process starts.
 *
 * This is the real home for startup validation. Importing `lib/env` from
 * `app/layout.tsx` alone is not enough: `/` is statically prerendered, so its
 * layout is evaluated during the build and never again, and a misconfigured
 * server answers that page with a cheerful 200. Verified by starting the
 * server with a blank Privy app ID and getting exactly that.
 *
 * Here the check runs on every boot, before the first request is served,
 * whatever mix of static and dynamic routes the app has. The layout import is
 * kept as well, so a dynamic route still fails fast if this hook is ever
 * removed.
 */
export async function register() {
  // Imported for its side effect; the module validates at import time and
  // throws with a message naming every missing or malformed value.
  await import("@/lib/env");
}

/**
 * Two request-level guards that run before a route sees anything.
 *
 * Both are deliberately modest, and it matters that their limits are stated
 * rather than implied.
 *
 * ──────────────── the per-IP throttle is NOT the rate limiter ────────────────
 *
 * The real rate limit in this project is `assertNotTooFrequent` in
 * `lib/server/nonce.ts`: per DID, counted from rows in `trust_nonces`, so it
 * survives a restart and holds across every running instance. The audit found
 * an earlier in-memory limiter bypassable and that is why it was replaced
 * (H-5 in `docs/security-audit.md`).
 *
 * The Map below is a cheap first filter in front of it, and nothing more:
 *
 *  - On Vercel each serverless instance has **its own** Map. Spread requests
 *    across instances and each one gets its own fresh allowance, so this can
 *    be walked around by anybody who knows it is there.
 *  - A phone network or a college wifi puts many people behind one NAT'd
 *    address, so a per-IP count can also punish the innocent. That is the
 *    other reason it is not allowed to be the real control.
 *
 * It is worth keeping anyway: it costs nothing and it absorbs a hot loop from
 * one client before that loop reaches the database. Treat it as a courtesy
 * throttle. Production replaces it with Redis — see README, "Rate limiting".
 */
import "server-only";
import { createHash } from "node:crypto";
import { APP_URL } from "@/lib/env";

export class GuardError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason: string
  ) {
    super(message);
    this.name = "GuardError";
  }
}

// ───────────────────────── per-IP throttle ─────────────────────────

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;

/** ip -> timestamps inside the current window. */
const hits = new Map<string, number[]>();

/**
 * Dropped whenever the Map grows past this, so a long-lived instance cannot
 * accumulate an entry per address it has ever seen. Sweeping on write keeps it
 * bounded without a timer, which a serverless function cannot rely on anyway.
 */
const MAX_TRACKED_IPS = 10_000;

function sweep(now: number) {
  for (const [ip, times] of hits) {
    const live = times.filter((t) => now - t < WINDOW_MS);
    if (live.length === 0) hits.delete(ip);
    else hits.set(ip, live);
  }
}

/**
 * The caller's address as the platform reports it.
 *
 * `x-forwarded-for` is only as trustworthy as the proxy in front of it. On
 * Vercel the left-most entry is set by the platform; run anywhere else and a
 * client can put whatever it likes there. One more reason this is not the real
 * limiter.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * The caller's address as something safe to write down: salted SHA-256.
 *
 * ──────────────── why the salt is not optional ────────────────
 *
 * There are only about 4.3 billion IPv4 addresses. An unsalted SHA-256 of one
 * is therefore **not** anonymised — the whole space can be hashed and looked
 * up in seconds on a laptop, so a bare `sha256(ip)` in a table a user can read
 * is the raw address with extra steps. The secret salt is the only thing that
 * makes the digest unguessable, which is why it lives in the environment and
 * never in the repository.
 *
 * With no salt configured this returns `null` and the field is left out
 * entirely. That is deliberate: a weak hash stored under a name that claims to
 * be a hash is worse than no value at all, because the next reader trusts it.
 * Rotating `IP_HASH_SALT` makes old digests uncorrelatable with new ones,
 * which is a feature — it bounds how long any of this is linkable.
 */
let saltWarningShown = false;

export function hashedIp(request: Request): string | null {
  const salt = process.env.IP_HASH_SALT;
  if (!salt) {
    if (!saltWarningShown) {
      saltWarningShown = true;
      console.warn(
        "[guards] IP_HASH_SALT is not set, so blocked requests are logged without any address. Set it to make rate-limit problems debuggable — see .env.example."
      );
    }
    return null;
  }

  const ip = clientIp(request);
  // Nothing identifying arrived, so there is nothing to record.
  if (ip === "unknown") return null;

  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

/** Test seam: the warning is once-per-process, and a test needs it reset. */
export function resetSaltWarning(): void {
  saltWarningShown = false;
}

/** Throws 429 once an address is over 10 requests in the last minute. */
export function assertIpUnderLimit(request: Request): void {
  const now = Date.now();
  const ip = clientIp(request);

  if (hits.size > MAX_TRACKED_IPS) sweep(now);

  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);

  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(ip, recent);
    throw new GuardError(
      "That is a lot of requests at once. Wait a moment and try again.",
      429,
      "ip_rate_limited"
    );
  }

  recent.push(now);
  hits.set(ip, recent);
}

/** Test seam: the Map is module state, and a test needs a clean one. */
export function resetIpLimiter(): void {
  hits.clear();
}

// ───────────────────────── origin check ─────────────────────────

/**
 * Refuse a request that a *different* site's page sent.
 *
 * Browsers attach `Origin` to every cross-site POST, so comparing it to our
 * own origin is what stops another page calling these routes with a visitor's
 * cookies attached. Two deliberate decisions:
 *
 *  - A request with **no** `Origin` is allowed through. `curl`, a health check
 *    and a server-to-server call have no origin to send, and the routes do not
 *    rely on cookies for authority anyway: `verifyCaller` demands two Privy
 *    bearer tokens, which another site's JavaScript cannot read or attach. So
 *    this check is defence in depth, not the thing standing between an
 *    attacker and the API.
 *  - No `Access-Control-Allow-Origin` is ever returned, because no other
 *    origin is meant to call these routes successfully. Leaving the header off
 *    is the strictest possible CORS posture, not an omission.
 *
 * With `NEXT_PUBLIC_APP_URL` unset, same-origin requests still pass: the
 * request's own host is always allowed. Setting it adds the canonical
 * production origin, which matters behind a proxy that rewrites Host.
 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return;

  const allowed = new Set<string>();

  try {
    allowed.add(new URL(request.url).origin);
  } catch {
    // An unparseable request URL is not something to paper over.
  }

  if (APP_URL) {
    try {
      allowed.add(new URL(APP_URL).origin);
    } catch {
      console.warn(
        `[guards] NEXT_PUBLIC_APP_URL is not a URL: ${APP_URL}. Ignoring it.`
      );
    }
  }

  // Local development, where the port moves around.
  if (process.env.NODE_ENV !== "production") {
    allowed.add("http://localhost:3000");
    allowed.add("http://127.0.0.1:3000");
  }

  if (!allowed.has(origin)) {
    throw new GuardError(
      "That request didn't come from Pot.",
      403,
      "cross_origin_blocked"
    );
  }
}

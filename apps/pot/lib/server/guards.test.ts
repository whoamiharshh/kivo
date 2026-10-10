/**
 * The two request-level guards, and the body size limit they sit beside.
 *
 * These assert the behaviour a caller can observe: a 429 once an address is
 * over its minute allowance, a 403 for a request another site's page sent, and
 * a 413 for a body past 64 KiB. What they deliberately do not claim is that
 * any of this is a sufficient control — `guards.ts` carries that warning, and
 * the per-IP Map is a courtesy throttle in front of the real per-DID limiter.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  assertIpUnderLimit,
  assertSameOrigin,
  clientIp,
  GuardError,
  resetIpLimiter,
} from "./guards";
import { body, MAX_BODY_BYTES } from "./route-kit";

const URL_UNDER_TEST = "https://pot.example/api/trust/attest-day";

/** A POST the guards can read, with whatever headers a case needs. */
function post(headers: Record<string, string>, payload?: unknown): Request {
  return new Request(URL_UNDER_TEST, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

beforeEach(() => {
  resetIpLimiter();
});

describe("assertIpUnderLimit", () => {
  it("allows ten requests in a minute and refuses the eleventh", () => {
    const request = post({ "x-forwarded-for": "203.0.113.7" });

    for (let i = 0; i < 10; i++) {
      expect(() => assertIpUnderLimit(request)).not.toThrow();
    }

    expect(() => assertIpUnderLimit(request)).toThrowError(GuardError);
    try {
      assertIpUnderLimit(request);
    } catch (err) {
      expect(err).toMatchObject({ status: 429, reason: "ip_rate_limited" });
    }
  });

  it("counts each address separately", () => {
    const first = post({ "x-forwarded-for": "203.0.113.7" });
    const second = post({ "x-forwarded-for": "203.0.113.8" });

    for (let i = 0; i < 10; i++) assertIpUnderLimit(first);

    // The second address has spent nothing, so it is unaffected.
    expect(() => assertIpUnderLimit(second)).not.toThrow();
    expect(() => assertIpUnderLimit(first)).toThrowError(GuardError);
  });

  it("reads the left-most entry of a forwarded chain", () => {
    // Everything to the right was added by an upstream hop and is not the
    // client. Counting the whole string would make one header value per proxy
    // path, which is not a per-client count at all.
    expect(
      clientIp(post({ "x-forwarded-for": "203.0.113.7, 70.41.3.18, 150.172.238.178" }))
    ).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip, then to a single bucket", () => {
    expect(clientIp(post({ "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4");
    // No address at all: everything shares one bucket. Stricter than letting
    // an unidentifiable caller through unbounded.
    expect(clientIp(post({}))).toBe("unknown");
  });
});

describe("assertSameOrigin", () => {
  it("allows the app's own origin", () => {
    expect(() =>
      assertSameOrigin(post({ origin: "https://pot.example" }))
    ).not.toThrow();
  });

  it("refuses another site's origin with 403", () => {
    try {
      assertSameOrigin(post({ origin: "https://evil.example" }));
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toMatchObject({
        status: 403,
        reason: "cross_origin_blocked",
      });
    }
  });

  it("allows a request with no Origin header", () => {
    // curl, a health check, a server-to-server call. Authority here comes from
    // two Privy bearer tokens, not from a cookie, so there is nothing for a
    // cross-site page to ride on in the first place.
    expect(() => assertSameOrigin(post({}))).not.toThrow();
  });

  it("refuses a different port on the same host", () => {
    expect(() =>
      assertSameOrigin(post({ origin: "https://pot.example:8443" }))
    ).toThrowError(GuardError);
  });
});

describe("body size limit", () => {
  it("accepts a normal request", async () => {
    const parsed = await body(
      post({}, { poolId: 1, forDay: "2026-10-10", metric: "steps", value: 8000 })
    );
    expect(parsed).toMatchObject({ poolId: 1, metric: "steps" });
  });

  it("refuses a body past the limit with 413", async () => {
    const huge = { note: "x".repeat(MAX_BODY_BYTES + 1) };
    await expect(body(post({}, huge))).rejects.toMatchObject({
      status: 413,
      reason: "payload_too_large",
    });
  });

  it("refuses on a content-length claim before reading the body", async () => {
    // The declared length is a claim by the caller, used only as an early
    // exit. A liar is still caught by the real byte count afterwards.
    await expect(
      body(post({ "content-length": String(MAX_BODY_BYTES + 1) }, { a: 1 }))
    ).rejects.toMatchObject({ status: 413 });
  });

  it("refuses a JSON array or a bare value, not just bad syntax", async () => {
    await expect(body(post({}, [1, 2, 3]))).rejects.toMatchObject({
      reason: "bad_json",
    });
    await expect(body(post({}, "a string"))).rejects.toMatchObject({
      reason: "bad_json",
    });
  });
});

import { describe, expect, it } from "vitest";
import { normalizeSponsoredError, readableError } from "./tx";

/** Same shape as the trust client's error, without importing the auth client. */
function trustError(message: string, status = 503) {
  const e = new Error(message);
  e.name = "TrustCallError";
  return Object.assign(e, { status });
}

describe("readableError", () => {
  it("passes our own server's sentence through instead of hiding it", () => {
    const msg = "This action is temporarily unavailable. Existing funds are unchanged.";
    expect(readableError(trustError(msg))).toBe(msg);
  });

  it("still turns a contract revert into a plain sentence", () => {
    expect(readableError(new Error("execution reverted: BadInviteCode"))).toBe(
      "That invite link isn't valid for this pot."
    );
  });

  it("falls back to a generic line for an unknown failure", () => {
    expect(readableError(new Error("kaboom"))).toBe(
      "Something went wrong. Please try again."
    );
  });

  it("does not trust an ordinary error that merely mentions a trust failure", () => {
    expect(readableError(new Error("TrustCallError somewhere in the text"))).toBe(
      "Something went wrong. Please try again."
    );
  });
});

describe("sponsored action errors", () => {
  it("replaces sponsorship diagnostics with a generic safe message", () => {
    const original = new Error("Gas sponsorship is not enabled", {
      cause: { request: "sensitive provider details" },
    });
    const normalized = normalizeSponsoredError(original);

    expect(normalized).toBeInstanceOf(Error);
    expect((normalized as Error).message).toMatch(/temporarily unavailable/i);
    expect((normalized as Error).message).not.toContain("sensitive");
    expect(normalized).not.toBe(original);
  });

  it("preserves unrelated send failures for the existing safe error mapper", () => {
    const original = new Error("RPC request failed");

    expect(normalizeSponsoredError(original)).toBe(original);
  });
});
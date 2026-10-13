import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertTrustSignerEnabled, TRUST_SIGNER_KEY } from "./env";
import { asResponse } from "./route-kit";
import { TrustSignerUnavailableError } from "./env";

const TEST_KEY =
  "0x1111111111111111111111111111111111111111111111111111111111111111";
const COMPROMISED_SIGNER = "0xbe4ad8cc900e5824440526e7669a82881c661d94";

beforeEach(() => {
  vi.stubEnv("TRUST_SIGNER_KEY", TEST_KEY);
  vi.stubEnv("TRUST_SIGNER_ENABLED", "false");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("server signer safety gate", () => {
  it("refuses to sign unless explicitly enabled", () => {
    expect(() => TRUST_SIGNER_KEY()).toThrow(/signing is disabled/i);
  });

  it("refuses before requiring the private key", () => {
    vi.stubEnv("TRUST_SIGNER_KEY", "");

    expect(() => TRUST_SIGNER_KEY()).toThrow(/signing is disabled/i);
  });

  it("rejects the compromised legacy signer even when enabled", () => {
    vi.stubEnv("TRUST_SIGNER_ENABLED", "true");

    expect(() => assertTrustSignerEnabled(COMPROMISED_SIGNER)).toThrow(
      /compromised legacy signer/i
    );
  });

  it("allows an isolated test signer only when explicitly enabled", () => {
    vi.stubEnv("TRUST_SIGNER_ENABLED", "true");

    expect(TRUST_SIGNER_KEY()).toBe(TEST_KEY);
  });

  it("maps disabled signing to a clear unavailable response", async () => {
    const response = asResponse(
      new TrustSignerUnavailableError("internal safety reason")
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      reason: "signer_unavailable",
      error: expect.stringMatching(/temporarily unavailable/i),
    });
  });
});
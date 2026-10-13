import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function loadEnvironment() {
  vi.resetModules();
  return import("./env");
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXT_PHASE", "phase-production-server");
  vi.stubEnv("NEXT_PUBLIC_PRIVY_APP_ID", "test-privy-app-id");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-anon-key");
  vi.stubEnv("TRUST_SIGNER_ENABLED", "false");
  vi.stubEnv("TRUST_SIGNER_KEY", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("production signer environment validation", () => {
  it("allows startup without a key while server signing is disabled", async () => {
    await expect(loadEnvironment()).resolves.toHaveProperty("APP_URL");
  });

  it("requires a key when server signing is explicitly enabled", async () => {
    vi.stubEnv("TRUST_SIGNER_ENABLED", "true");

    await expect(loadEnvironment()).rejects.toThrow(
      /TRUST_SIGNER_KEY is not set/
    );
  });

  it("rejects an invalid signing flag", async () => {
    vi.stubEnv("TRUST_SIGNER_ENABLED", "yes");

    await expect(loadEnvironment()).rejects.toThrow(/Invalid option/);
  });
});
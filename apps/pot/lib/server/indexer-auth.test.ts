import { describe, expect, it } from "vitest";
import { hasValidIndexerAuthorization } from "./indexer-auth";

describe("Pot indexer authorization", () => {
  it("accepts only the exact bearer secret", () => {
    expect(hasValidIndexerAuthorization("Bearer test-secret", "test-secret")).toBe(
      true
    );
    expect(hasValidIndexerAuthorization("Bearer other-secret", "test-secret")).toBe(
      false
    );
  });

  it("rejects missing, malformed, or empty credentials", () => {
    expect(hasValidIndexerAuthorization(null, "test-secret")).toBe(false);
    expect(hasValidIndexerAuthorization("test-secret", "test-secret")).toBe(
      false
    );
    expect(hasValidIndexerAuthorization("Bearer ", "")).toBe(false);
  });
});
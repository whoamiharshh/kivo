import { describe, expect, it } from "vitest";
import { safeErrorMetadata } from "./logging";

describe("safe server error metadata", () => {
  it("keeps bounded error names and machine codes but drops messages", () => {
    const error = Object.assign(
      new Error("provider URL and request body must not be logged"),
      { code: "23505" }
    );

    expect(safeErrorMetadata(error)).toEqual({
      errorName: "Error",
      code: "23505",
    });
  });

  it("does not include arbitrary values from unknown errors", () => {
    expect(safeErrorMetadata("secret-looking provider response")).toEqual({
      errorName: "UnknownError",
    });
  });
});
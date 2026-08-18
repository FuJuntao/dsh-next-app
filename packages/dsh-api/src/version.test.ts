import { describe, expect, it } from "vitest";
import { assertDshVersion } from "./assert-dsh-version.js";
import { SUPPORTED_DSH_VERSION } from "./version.js";

describe("SUPPORTED_DSH_VERSION", () => {
  it("is pinned to the tested dsh release", () => {
    expect(SUPPORTED_DSH_VERSION).toBe("0.1.0-rc.7");
  });
});

describe("assertDshVersion", () => {
  it("passes silently on an exact match", () => {
    expect(() => assertDshVersion(SUPPORTED_DSH_VERSION)).not.toThrow();
  });

  it("fails loudly on any mismatch", () => {
    expect(() => assertDshVersion("0.1.0-rc.6")).toThrow(/version mismatch/u);
  });
});

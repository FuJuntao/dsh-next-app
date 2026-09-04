/**
 * Drift guard for the session-reference token format (story #117 task #124).
 *
 * The host's `dsh-session-reference` package owns the grammar; the expected
 * values below were produced by that package (dsh 0.1.1-rc.2, lib/types/uri)
 * and pasted verbatim. If the host changes the encoding, escaping, or
 * scheme, these fixtures go stale with the version bump - and this suite
 * fails, which is the point.
 */
import { describe, expect, it } from "vitest";
import { encodeSessionReferenceUri, formatSessionReferenceMention } from "./session-reference";

describe("session-reference - host-produced vectors", () => {
  it("encodes the canonical URI (base64url of the JSON string, unpadded)", () => {
    expect(encodeSessionReferenceUri("session-06d4639c-f3fd-4c26-b91c-ad6ad987b02a")).toBe(
      "dsh-session:InNlc3Npb24tMDZkNDYzOWMtZjNmZC00YzI2LWI5MWMtYWQ2YWQ5ODdiMDJhIg",
    );
  });

  it("escapes only backslash and ] in the label", () => {
    // Host input label: Alpha [x] y\z  (one backslash).
    expect(
      formatSessionReferenceMention({
        sessionId: "session-06d4639c-f3fd-4c26-b91c-ad6ad987b02a",
        label: "Alpha [x] y\\z",
      }),
    ).toBe(
      // Host output mention: the ] and the backslash are escaped; [ is not.
      "@[Alpha [x\\] y\\\\z](dsh-session:InNlc3Npb24tMDZkNDYzOWMtZjNmZC00YzI2LWI5MWMtYWQ2YWQ5ODdiMDJhIg)",
    );
  });

  it("passes unicode labels through verbatim", () => {
    expect(
      formatSessionReferenceMention({ sessionId: "session-abc", label: "部署 pipeline" }),
    ).toBe("@[部署 pipeline](dsh-session:InNlc3Npb24tYWJjIg)");
  });

  it("falls back to the session id when no label is given", () => {
    expect(formatSessionReferenceMention({ sessionId: "session-abc" })).toBe(
      "@[session-abc](dsh-session:InNlc3Npb24tYWJjIg)",
    );
  });
});

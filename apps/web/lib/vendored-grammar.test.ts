/**
 * Drift guard for the vendored `@file` grammar (story #134 task #135
 * commit 10, AC 21). The composer's trigger and insertion are NOT
 * reimplementations - they call @deepseek-ai/dsh-file-reference/grammar
 * directly, so this suite cannot catch encoding drift... what it DOES pin
 * is the CONTRACT the UI relies on: what counts as a trigger, what a
 * quoted directory insertion looks like, and that a directory insertion
 * stays an active token (descent) while a file one closes. A host bump
 * that changes any of that breaks these vectors and the composer behavior
 * they describe together. Same posture as session-reference.test.ts.
 */
import { describe, expect, it } from "vitest";
import { activeAtToken, formatFileMention } from "@deepseek-ai/dsh-file-reference/grammar";

describe("activeAtToken - the composer's trigger contract", () => {
  it("extracts the open token at the cursor", () => {
    expect(activeAtToken("see @src/comp", 14)).toEqual({
      prefix: "@src/comp",
      query: "src/comp",
      quoted: false,
    });
  });

  it("keeps quoted paths with spaces as one token", () => {
    expect(activeAtToken('fix @"my dir/', 13)).toEqual({
      prefix: '@"my dir/',
      query: "my dir/",
      quoted: true,
    });
  });

  it("does not trigger inside another token (emails)", () => {
    expect(activeAtToken("mail a@b.com", 12)).toBeUndefined();
  });

  it("is anchored at the cursor - text after it does not count", () => {
    expect(activeAtToken("@src", 2)?.query).toBe("s");
  });
});

describe("formatFileMention - the insertion contract", () => {
  it("files close the token (@path)", () => {
    expect(formatFileMention({ path: "a.ts", kind: "file" }, false)).toBe("@a.ts");
  });

  it("paths with spaces quote, and directories keep the quote OPEN", () => {
    const dir = formatFileMention({ path: "my dir", kind: "directory" }, false);
    expect(dir).toBe('@"my dir/');
    // The descent rule: a directory insertion is STILL an active token, so
    // the composer must not append a space after it...
    expect(dir !== undefined && activeAtToken(dir, dir.length)).toBeTruthy();
    // ...while a file insertion is only active until the closing space the
    // composer adds.
    const file = formatFileMention({ path: "a.ts", kind: "file" }, false);
    expect(file !== undefined && activeAtToken(file + " ", file.length + 1)).toBeUndefined();
  });
});

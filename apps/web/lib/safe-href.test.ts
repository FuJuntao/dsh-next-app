/**
 * Unit tests for the card-anchor protocol gate (review security finding #13).
 *
 * The web card anchors `view.url` / `source.url`: strings the carrier schema
 * leaves unparsed, because they come out of a host presenter that has already
 * touched fetched and searched content. What matters is not the returned
 * string but that no non-allowlisted scheme can reach an `href`, so the cases
 * below are the parser differentials a raw-string check would miss - embedded
 * tab/newline, leading whitespace, mixed case, NUL.
 */
import { describe, expect, it } from "vitest";
import { safeHref } from "./safe-href";

describe("safeHref (finding #13)", () => {
  it("passes http and https", () => {
    expect(safeHref("https://ok")).toBe("https://ok/");
    expect(safeHref("http://ok")).toBe("http://ok/");
    expect(safeHref("https://ok/a?b=c#d")).toBe("https://ok/a?b=c#d");
  });

  it("normalizes case and surrounding whitespace on an allowed scheme", () => {
    expect(safeHref("HTTPS://OK/x")).toBe("https://ok/x");
    expect(safeHref("  https://ok/x  ")).toBe("https://ok/x");
  });

  it("refuses javascript:, in every shape a browser still parses as one", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("JavaScript:alert(1)")).toBeNull();
    expect(safeHref("  javascript:alert(1)")).toBeNull();
    // A regex anchored at the raw string start waves all three through: the
    // URL spec drops control characters anywhere in the input.
    expect(safeHref("java\tscript:alert(1)")).toBeNull();
    expect(safeHref("java\nscript:alert(1)")).toBeNull();
    expect(safeHref("java\r\nscript:\talert(1)")).toBeNull();
    expect(safeHref("javascript\0:alert(1)")).toBeNull();
  });

  it("refuses other scriptable or origin-less schemes", () => {
    expect(safeHref("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(safeHref("blob:https://ok/11111111-1111-1111-1111-111111111111")).toBeNull();
    expect(safeHref("file:///etc/passwd")).toBeNull();
    expect(safeHref("vbscript:msgbox(1)")).toBeNull();
  });

  it("refuses schemeless strings rather than resolving them against this app", () => {
    // Documented decision: the presenter emits absolute URLs, so a bare path
    // is malformed carrier data - never a link into our own routes.
    expect(safeHref("/foo")).toBeNull();
    expect(safeHref("//evil.example/x")).toBeNull();
    expect(safeHref("#frag")).toBeNull();
    expect(safeHref("?q=1")).toBeNull();
    expect(safeHref("example.com/x")).toBeNull();
  });

  it("refuses empty and host-less inputs", () => {
    expect(safeHref("")).toBeNull();
    expect(safeHref("   ")).toBeNull();
    expect(safeHref("\t\n ")).toBeNull();
    expect(safeHref("http://")).toBeNull();
  });

  it("allows mailto, the one non-http scheme on the list", () => {
    expect(safeHref("mailto:hello@example.com")).toBe("mailto:hello@example.com");
    expect(safeHref("mailto:hello@example.com?subject=hi")).toBe(
      "mailto:hello@example.com?subject=hi",
    );
    // Whitespace is stripped before parsing, so a padded address still works.
    expect(safeHref("  mailto:a@b.c ")).toBe("mailto:a@b.c");
  });

  it("refuses the schemes hast-util-sanitize allows but this gate does not", () => {
    expect(safeHref("irc://irc.libera.chat/dsh")).toBeNull();
    expect(safeHref("ircs://irc.libera.chat:6697/dsh")).toBeNull();
    expect(safeHref("xmpp:dsh@example.com")).toBeNull();
    expect(safeHref("tox:ABCDEF")).toBeNull();
  });
});

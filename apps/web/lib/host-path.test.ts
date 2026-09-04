/**
 * Unit tests for the shared containment fence (host-path.ts, review
 * finding #2 on story #117): the fence the browse door, the skills read,
 * and the session's `cwd` all enforce. The real FS under /tmp gives the
 * canonicalization teeth - above all the case the duplicated fences
 * disagreed on: a MISSING path under a symlinked parent must climb to
 * the real ancestor and be refused, never pass on its unresolved string.
 */
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

const base = realpathSync(mkdtempSync(join(tmpdir(), "host-path-test-")));
const root = join(base, "workspace");
const outside = join(base, "outside");
const evilSibling = join(base, "workspace-evil");
mkdirSync(root);
mkdirSync(outside);
mkdirSync(evilSibling);
symlinkSync(outside, join(root, "escape"));

const fake = vi.hoisted(() => ({
  host: { describe: vi.fn() },
}));

vi.mock("./bridge", () => ({
  getActionBridgeClient: () => fake,
}));

const { fenceInsideHostRoot } = await import("./host-path");

beforeAll(() => {
  fake.host.describe.mockResolvedValue({
    result: {
      ok: true,
      value: {
        cwd: root,
        version: "test",
        attachedSessions: 0,
        home: "/home/tester",
        canOpenPath: false,
      },
    },
  });
});

describe("fenceInsideHostRoot", () => {
  it("accepts the root itself and real subfolders", async () => {
    const atRoot = await fenceInsideHostRoot(root);
    expect(atRoot).toEqual({ ok: true, path: root });
    const sub = join(root, "docs");
    mkdirSync(sub);
    await expect(fenceInsideHostRoot(sub)).resolves.toEqual({ ok: true, path: sub });
  });

  it("accepts a MISSING path under a real subtree directory (climbs, stays in)", async () => {
    const missing = join(root, "docs", "not-yet-created");
    const result = await fenceInsideHostRoot(missing);
    expect(result.ok).toBe(true);
  });

  it("refuses a MISSING path under a symlinked parent (the unresolved-string hole)", async () => {
    // root/escape is a symlink to outside; the tail does not exist, so a
    // naive realpath fallback would test the raw string (which looks
    // inside root) and let the escape through.
    const result = await fenceInsideHostRoot(join(root, "escape", "missing.txt"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("outside");
  });

  it("refuses symlink escapes that exist", async () => {
    const result = await fenceInsideHostRoot(join(root, "escape"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("outside");
  });

  it("refuses prefix-lookalike siblings", async () => {
    const result = await fenceInsideHostRoot(evilSibling);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("outside");
  });

  it("refuses relative paths outright", async () => {
    const result = await fenceInsideHostRoot("docs/../outside");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("relative");
  });
});

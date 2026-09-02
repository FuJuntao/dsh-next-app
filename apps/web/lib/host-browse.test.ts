/**
 * Unit tests for the browse containment (the cwd folder picker's
 * server-side rule, review follow-up on story #117 task #122): browsing
 * is confined to SUBFOLDERS of the host default working folder. The real
 * FS under /tmp gives realpath cases teeth (missing paths, symlink
 * escapes, prefix-lookalike siblings) while the bridge stays mocked.
 */
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

const base = realpathSync(mkdtempSync(join(tmpdir(), "host-browse-test-")));
const root = join(base, "workspace");
const outside = join(base, "outside");
const evilSibling = join(base, "workspace-evil"); // prefix-lookalike, NOT under root
mkdirSync(root);
mkdirSync(outside);
mkdirSync(evilSibling);
mkdirSync(join(root, "docs"));
symlinkSync(outside, join(root, "escape")); // symlink that points out of the subtree

// The mocked bridge: describe names `root` as the host cwd; listDirectory
// echoes a listing with the host's own crumb chain (rooted at "/"), which
// the action must trim to the subtree.
const fake = vi.hoisted(() => ({
  host: {
    describe: vi.fn(),
    listDirectory: vi.fn(),
  },
}));

vi.mock("./bridge", () => ({
  getActionBridgeClient: () => fake,
}));

const { browseDirectory } = await import("./host-browse");

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
  fake.host.listDirectory.mockImplementation((payload: { path?: string }) => {
    const path = payload.path ?? root;
    const chain: { name: string; path: string; hidden: boolean }[] = [];
    // The host's crumb chain: from the filesystem root down, inclusive.
    const parts = path.split(sep).filter((part) => part !== "");
    let walk = "";
    chain.push({ name: "/", path: "/", hidden: false });
    for (const part of parts) {
      walk = walk + sep + part;
      chain.push({ name: part, path: walk, hidden: false });
    }
    return {
      result: {
        ok: true,
        value: { path, home: "/home/tester", crumbs: chain, entries: [], truncated: false },
      },
    };
  });
});

describe("browseDirectory - subtree containment", () => {
  it("lists the default folder itself with no path, marked as the root", async () => {
    const result = await browseDirectory();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.atRoot).toBe(true);
      expect(fake.host.listDirectory).toHaveBeenLastCalledWith({ path: root });
    }
  });

  it("lists and allows a subfolder", async () => {
    const result = await browseDirectory(join(root, "docs"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.atRoot).toBe(false);
      expect(result.listing.path).toBe(join(root, "docs"));
    }
  });

  it("trims the crumb chain to the subtree (no escape hatch to render)", async () => {
    const result = await browseDirectory(join(root, "docs"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        result.listing.crumbs.every(
          (crumb) => crumb.path === root || crumb.path.startsWith(root + sep),
        ),
      ).toBe(true);
      expect(result.listing.crumbs.map((crumb) => crumb.name)).toEqual(["workspace", "docs"]);
    }
  });

  it("refuses absolute paths outside the subtree before any bridge call", async () => {
    fake.host.listDirectory.mockClear();
    const result = await browseDirectory("/etc");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("outside the default working folder");
    expect(fake.host.listDirectory).not.toHaveBeenCalled();
  });

  it("refuses .. traversal (resolved before the containment test)", async () => {
    const result = await browseDirectory(root + "/../outside");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("outside");
  });

  it("refuses a prefix-lookalike sibling (workspace-evil is not under workspace)", async () => {
    const result = await browseDirectory(evilSibling);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("outside");
  });

  it("refuses a symlink inside the subtree that points out of it", async () => {
    const result = await browseDirectory(join(root, "escape"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("outside");
  });

  it("refuses relative paths", async () => {
    const result = await browseDirectory("docs");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("relative");
  });

  it("lets missing subfolders through to the host's own unreadable diagnostic", async () => {
    fake.host.listDirectory.mockClear();
    const result = await browseDirectory(join(root, "not-there-yet"));
    expect(result.ok).toBe(true); // the fake answers ok; the real host answers directory-unreadable
    expect(fake.host.listDirectory).toHaveBeenCalledWith({ path: join(root, "not-there-yet") });
  });
});

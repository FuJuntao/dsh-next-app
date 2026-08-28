/**
 * Unit tests for the pure session-view model (story #107 task #110).
 *
 * The e2e suite covers the rendered list against real profile data, but the
 * pinned host cannot produce every branch through real data: every envelope
 * session carries a cwd, and session.list itself filters cold rows without
 * one - so the Ungrouped fallback and the broken-lineage fallbacks are only
 * reachable here. This suite pins those branches plus the ordering contract
 * the server/client determinism depends on (recency desc, id tie-break).
 */
import { describe, expect, it } from "vitest";
import { arrangeSessions, DEFAULT_GROUP } from "./session-view";
import type { Session } from "./sessions";

/** One row with the noise fields filled; tests override what they read. */
function row(over: Partial<Session> & Pick<Session, "id">): Session {
  return { title: "T " + over.id, updatedAt: 1000, running: false, ...over };
}

describe("arrangeSessions - workspace grouping", () => {
  it("buckets rows without a cwd into an Ungrouped group pinned last", () => {
    // Group order rides each bucket's newest member - but Ungrouped is
    // pinned last even when its newest member would sort above a bucket.
    const groups = arrangeSessions(
      [
        row({ id: "a", cwd: "/w/alpha", updatedAt: 300 }),
        row({ id: "b", updatedAt: 200 }),
        row({ id: "c", cwd: "/w/beta", updatedAt: 100 }),
      ],
      "workspace",
    );
    expect(groups.map((g) => g.label)).toEqual(["alpha", "beta", "Ungrouped"]);
    const ungrouped = groups.at(-1)!;
    expect(ungrouped.key).toBe("");
    expect(ungrouped.rows.map((r) => r.session.id)).toEqual(["b"]);
  });

  it("every row without a cwd lands in the one Ungrouped group", () => {
    const groups = arrangeSessions(
      [row({ id: "a", updatedAt: 200 }), row({ id: "b", updatedAt: 100 })],
      "workspace",
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe("Ungrouped");
    expect(groups[0]?.rows.map((r) => r.session.id)).toEqual(["a", "b"]);
  });

  it("orders workspace groups by their newest member", () => {
    const groups = arrangeSessions(
      [
        row({ id: "old-alpha", cwd: "/w/alpha", updatedAt: 100 }),
        row({ id: "new-alpha", cwd: "/w/alpha", updatedAt: 500 }),
        row({ id: "beta", cwd: "/w/beta", updatedAt: 300 }),
      ],
      "workspace",
    );
    expect(groups.map((g) => g.label)).toEqual(["alpha", "beta"]);
    // Inside a bucket the rows still order by recency.
    expect(groups[0]?.rows.map((r) => r.session.id)).toEqual(["new-alpha", "old-alpha"]);
  });

  it("labels each workspace with its basename and keeps the full path as detail", () => {
    const groups = arrangeSessions([row({ id: "a", cwd: "/home/user/repo" })], "workspace");
    expect(groups[0]?.label).toBe("repo");
    expect(groups[0]?.detail).toBe("/home/user/repo");
  });
});

describe("arrangeSessions - lineage fallbacks", () => {
  it("nests a valid chain to full depth", () => {
    const groups = arrangeSessions(
      [
        row({ id: "root", updatedAt: 300 }),
        row({ id: "child", parentSessionId: "root", updatedAt: 200 }),
        row({ id: "grandchild", parentSessionId: "child", updatedAt: 100 }),
      ],
      "none",
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBeUndefined();
    const top = groups[0]?.rows ?? [];
    expect(top.map((r) => r.session.id)).toEqual(["root"]);
    expect(top[0]?.children.map((r) => r.session.id)).toEqual(["child"]);
    expect(top[0]?.children[0]?.children.map((r) => r.session.id)).toEqual(["grandchild"]);
  });

  it("renders a child whose parent is absent from the list at top level", () => {
    const groups = arrangeSessions(
      [row({ id: "orphan", parentSessionId: "ghost", updatedAt: 200 }), row({ id: "root" })],
      "none",
    );
    // The orphan must not vanish: it renders top-level, in recency order
    // (root's default 1000 beats the orphan's 200).
    expect(groups[0]?.rows.map((r) => r.session.id)).toEqual(["root", "orphan"]);
  });

  it("renders cyclic chains at top level instead of looping", () => {
    const groups = arrangeSessions(
      [
        row({ id: "a", parentSessionId: "b", updatedAt: 300 }),
        row({ id: "b", parentSessionId: "c", updatedAt: 200 }),
        row({ id: "c", parentSessionId: "b", updatedAt: 100 }),
      ],
      "none",
    );
    expect(groups[0]?.rows.map((r) => r.session.id)).toEqual(["a", "b", "c"]);
    for (const top of groups[0]?.rows ?? []) expect(top.children).toHaveLength(0);
  });
});

describe("arrangeSessions - ordering contract", () => {
  it("breaks exact updatedAt ties by id so server and client render identically", () => {
    const groups = arrangeSessions(
      [row({ id: "b", updatedAt: 500 }), row({ id: "a", updatedAt: 500 })],
      "none",
    );
    expect(groups[0]?.rows.map((r) => r.session.id)).toEqual(["a", "b"]);
  });

  it("defaults to the flat view", () => {
    expect(DEFAULT_GROUP).toBe("none");
    const groups = arrangeSessions([row({ id: "a" })], DEFAULT_GROUP);
    expect(groups).toEqual([
      { key: "", label: undefined, rows: [{ session: row({ id: "a" }), children: [] }] },
    ]);
  });
});

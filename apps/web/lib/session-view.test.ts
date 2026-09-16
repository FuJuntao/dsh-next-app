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
import {
  DEFAULT_GROUP,
  SESSION_PAGE_SIZE,
  arrangeSessions,
  sessionPage,
  sessionPageOf,
} from "./session-view";
import type { SessionRow } from "./session-view";
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

describe("sessionPage - windowing top-level rows", () => {
  // 12 parents "p0".."p11" (recency-ordered by arrangeSessions, so build
  // rows straight through it), p1 carrying a nested child plus a deeper
  // grandchild: the window must treat that whole subtree as one unit.
  const sessions: Session[] = Array.from({ length: 12 }, (_, i) =>
    row({ id: "p" + i, updatedAt: 1200 - i * 10 }),
  );
  sessions.push(
    row({ id: "c1", parentSessionId: "p1", updatedAt: 50 }),
    row({ id: "g1", parentSessionId: "c1", updatedAt: 40 }),
  );
  const groups = arrangeSessions(sessions, "none");
  const rows = groups[0]?.rows as SessionRow[];

  it("cuts at the 5-row budget, newest first", () => {
    expect(SESSION_PAGE_SIZE).toBe(5);
    expect(rows).toHaveLength(12);
    const page = sessionPage(rows, 1);
    expect(page.rows.map((r) => r.session.id)).toEqual(["p0", "p1", "p2", "p3", "p4"]);
    expect(page.pageCount).toBe(3);
    expect(page.moreCount).toBe(5);
  });

  it("keeps a nested lineage on its parent's page across the cut", () => {
    // p1 (with child c1 and grandchild g1) sits inside page 1's window;
    // c1/g1 consume no budget - the page still carries 5 top-level rows,
    // and c1 never appears as a top-level row of page 2.
    const page = sessionPage(rows, 1);
    expect(page.rows.map((r) => r.session.id)).toContain("p1");
    expect(page.rows[1]?.children.map((r) => r.session.id)).toEqual(["c1"]);
    expect(page.rows[1]?.children[0]?.children.map((r) => r.session.id)).toEqual(["g1"]);
    const page2 = sessionPage(rows, 2);
    expect(page2.rows.map((r) => r.session.id)).toEqual(["p5", "p6", "p7", "p8", "p9"]);
  });

  it("reports the hidden-row budget for Show more, clamped at the last page", () => {
    // moreCount = min(5, hidden past the window): page 1 has 12-5=7 hidden
    // (capped to 5), page 2 has 12-10=2, the last page has nothing left.
    expect(sessionPage(rows, 1).moreCount).toBe(5);
    expect(sessionPage(rows, 2).moreCount).toBe(2);
    expect(sessionPage(rows, 3).rows.map((r) => r.session.id)).toEqual(["p10", "p11"]);
    expect(sessionPage(rows, 3).moreCount).toBe(0);
  });

  it("clamps out-of-range pages so server and client never disagree", () => {
    expect(sessionPage(rows, 0).page).toBe(1);
    expect(sessionPage(rows, 99).page).toBe(3);
    expect(sessionPage(rows, Number.NaN).page).toBe(1);
    expect(sessionPage(rows, 2.7).page).toBe(2);
    const empty = sessionPage([], 4);
    expect(empty.page).toBe(1);
    expect(empty.pageCount).toBe(1);
    expect(empty.rows).toEqual([]);
    expect(empty.moreCount).toBe(0);
  });

  it("shows no controls for a group within budget", () => {
    const small = sessionPage(rows.slice(0, 5), 1);
    expect(small.moreCount).toBe(0);
    expect(small.pageCount).toBe(1);
    const exact = sessionPage(rows.slice(0, 5), 1);
    expect(exact.rows).toHaveLength(5);
  });
});

describe("sessionPageOf - the page holding a session", () => {
  const sessions: Session[] = Array.from({ length: 7 }, (_, i) =>
    row({ id: "p" + i, updatedAt: 700 - i * 10 }),
  );
  sessions.push(row({ id: "c6", parentSessionId: "p6", updatedAt: 50 }));
  const rows = arrangeSessions(sessions, "none")[0]?.rows as SessionRow[];

  it("finds the 1-based window of a top-level row", () => {
    expect(sessionPageOf(rows, "p0")).toBe(1);
    expect(sessionPageOf(rows, "p4")).toBe(1);
    expect(sessionPageOf(rows, "p5")).toBe(2);
    expect(sessionPageOf(rows, "p6")).toBe(2);
  });

  it("maps a nested child to its parent's page", () => {
    expect(sessionPageOf(rows, "c6")).toBe(2);
  });

  it("is undefined for a session the group does not hold", () => {
    expect(sessionPageOf(rows, "ghost")).toBeUndefined();
  });
});

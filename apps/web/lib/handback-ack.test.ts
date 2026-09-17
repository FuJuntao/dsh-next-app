/**
 * Unit tests for the dismissal-ack store (story #146 AC 6, task #147
 * commit 4). The store is the load-bearing half of "deleting is dismissal,"
 * so it is pinned against an in-memory storage double: what persists is item
 * ids and only ids - never the returned text.
 */
import { describe, expect, it } from "vitest";
import { ackKey, addDismissed, readDismissed, type AckStorage } from "./handback-ack";

/** A minimal Storage double; records writes and can simulate a throwing one. */
function fakeStore(
  initial: Record<string, string> = {},
  throwOnWrite = false,
): AckStorage & {
  data: Record<string, string>;
} {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      if (throwOnWrite) throw new Error("quota");
      data[key] = value;
    },
  };
}

describe("handback dismissal ack (AC 6)", () => {
  it("starts empty: no store, no key, or unreadable JSON all read as nothing", () => {
    expect(readDismissed(undefined, "s1")).toEqual(new Set());
    expect(readDismissed(fakeStore(), "s1")).toEqual(new Set());
    expect(readDismissed(fakeStore({ [ackKey("s1")]: "not json" }), "s1")).toEqual(new Set());
    expect(readDismissed(fakeStore({ [ackKey("s1")]: '{"a":1}' }), "s1")).toEqual(new Set());
  });

  it("keeps only the strings it finds in the array (a hand-edited store is sanitized)", () => {
    const store = fakeStore({ [ackKey("s1")]: JSON.stringify(["a", 1, null, "b"]) });
    expect([...readDismissed(store, "s1")]).toEqual(["a", "b"]);
  });

  it("records dismissed ids per session and reads them back", () => {
    const store = fakeStore();
    addDismissed(store, "s1", ["a", "b"]);
    expect([...readDismissed(store, "s1")]).toEqual(["a", "b"]);
    // s2 has its own scope: a pending-message id means nothing across sessions.
    expect(readDismissed(store, "s2")).toEqual(new Set());
  });

  it("is idempotent and additive across calls", () => {
    const store = fakeStore();
    addDismissed(store, "s1", ["a", "b"]);
    addDismissed(store, "s1", ["b", "c"]);
    expect([...readDismissed(store, "s1")]).toEqual(["a", "b", "c"]);
  });

  it("never stores content - only the ids passed in", () => {
    const store = fakeStore();
    addDismissed(store, "s1", ["id-1"]);
    const raw = store.data[ackKey("s1")] as string;
    expect(raw).not.toMatch(/do the thing|draft|message/i);
    expect(JSON.parse(raw)).toEqual(["id-1"]);
  });

  it("degrades to a no-op when storage is missing or writes throw", () => {
    expect(() => addDismissed(undefined, "s1", ["a"])).not.toThrow();
    const throwing = fakeStore({}, true);
    expect(() => addDismissed(throwing, "s1", ["a"])).not.toThrow();
    expect(readDismissed(throwing, "s1")).toEqual(new Set());
  });

  it("an empty id list does not touch the store", () => {
    const store = fakeStore();
    addDismissed(store, "s1", []);
    expect(store.data[ackKey("s1")]).toBeUndefined();
  });
});

/**
 * The listing ceiling's own tests (review spec finding #4).
 *
 * AC 22 says the walk is bounded, and the finding was that the bound only
 * existed on the readdir fallback - the PRIMARY (git) leg accumulated a whole
 * repo's `ls-files` output into one string, paid for it, and only then
 * truncated the response to 50. So what is pinned here is the shape of the
 * fix: the counter runs AS THE STREAM ARRIVES, across chunk boundaries, and
 * stops taking records at the ceiling rather than after it.
 */
import { describe, expect, it } from "vitest";
import { LIST_MAX_ENTRIES, NulRecordReader } from "./file-listing";

const join0 = (paths: string[]): string => paths.join("\0") + "\0";

describe("NulRecordReader", () => {
  it("reads whole records out of one feed", () => {
    const reader = new NulRecordReader();
    reader.feed(join0(["README.md", "src/index.ts"]));
    reader.finish();
    expect(reader.records).toEqual(["README.md", "src/index.ts"]);
    expect(reader.budgetHit).toBe(false);
  });

  it("reassembles a path split across chunks, including one cut at the separator", () => {
    const reader = new NulRecordReader();
    const stream = join0(["docs/adr/0011-file-discovery-next-side.md", "pnpm-lock.yaml"]);
    // Feed it one character at a time: the worst case for a naive split.
    for (const ch of stream) reader.feed(ch);
    reader.finish();
    expect(reader.records).toEqual(["docs/adr/0011-file-discovery-next-side.md", "pnpm-lock.yaml"]);
  });

  it("keeps the final record, which arrives with no trailing separator", () => {
    const reader = new NulRecordReader();
    reader.feed("first\0second\0last");
    reader.finish();
    expect(reader.records).toEqual(["first", "second", "last"]);
  });

  it("drops empty records (a NUL-run in the stream is not a path)", () => {
    const reader = new NulRecordReader();
    reader.feed("a\0\0b\0");
    reader.finish();
    expect(reader.records).toEqual(["a", "b"]);
  });

  it("stops AT the ceiling, never after it, and says so", () => {
    const reader = new NulRecordReader();
    // One feed past the cap: the count must not overshoot, and the caller
    // must see the signal to kill the child.
    reader.feed(join0(Array.from({ length: LIST_MAX_ENTRIES + 500 }, (_, i) => `f${String(i)}`)));
    expect(reader.records).toHaveLength(LIST_MAX_ENTRIES);
    expect(reader.budgetHit).toBe(true);
  });

  it("ignores everything after the ceiling is hit", () => {
    const reader = new NulRecordReader();
    reader.feed(join0(Array.from({ length: LIST_MAX_ENTRIES }, (_, i) => `f${String(i)}`)));
    expect(reader.budgetHit).toBe(true);
    reader.feed(join0(["too", "late"]));
    reader.finish();
    expect(reader.records).toHaveLength(LIST_MAX_ENTRIES);
    expect(reader.records[LIST_MAX_ENTRIES - 1]).toBe(`f${String(LIST_MAX_ENTRIES - 1)}`);
  });

  it("accumulates the ceiling across many small feeds, not per feed", () => {
    const reader = new NulRecordReader();
    const half = Math.floor(LIST_MAX_ENTRIES / 2);
    const batch = (offset: number): string =>
      join0(Array.from({ length: half }, (_, i) => `p${String(offset + i)}`));
    for (let n = 0; n < 3; n++) reader.feed(batch(n * half));
    reader.finish();
    // Two halves fit exactly; the third batch is refused at the door.
    expect(reader.records).toHaveLength(LIST_MAX_ENTRIES);
    expect(reader.budgetHit).toBe(true);
  });
});

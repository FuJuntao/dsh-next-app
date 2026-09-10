/**
 * The listing ceiling's own tests (review spec findings #4 and #1).
 *
 * AC 22 says the walk is bounded, and the finding was that the bound only
 * existed on the readdir fallback - the PRIMARY (git) leg accumulated a whole
 * repo's `ls-files` output into one string, paid for it, and only then
 * truncated the response to 50. So what is pinned here is the shape of the
 * fix: the counter runs AS THE STREAM ARRIVES, across chunk boundaries, and
 * stops taking records at the ceiling rather than after it.
 *
 * The second block is the follow-up finding: a multi-byte path split at the
 * final chunk boundary used to lose its tail, because the caller decoded with
 * `stream: true` and never flushed. The reader owns the decoder now, so the
 * only way to prove that is to feed real bytes with a real split.
 */
import { describe, expect, it } from "vitest";
import { LIST_MAX_ENTRIES, NulRecordReader } from "./file-listing";

const enc = new TextEncoder();
const bytes = (text: string): Uint8Array => enc.encode(text);
const join0 = (paths: string[]): Uint8Array => bytes(paths.join("\0") + "\0");

/** Split a byte stream into chunks of n, to force boundary behaviour. */
function* slice(buf: Uint8Array, n: number): Generator<Uint8Array> {
  for (let i = 0; i < buf.byteLength; i += n) yield buf.slice(i, i + n);
}

describe("NulRecordReader", () => {
  it("reads whole records out of one feed", () => {
    const reader = new NulRecordReader();
    reader.feed(join0(["README.md", "src/index.ts"]));
    reader.close();
    expect(reader.records).toEqual(["README.md", "src/index.ts"]);
    expect(reader.budgetHit).toBe(false);
  });

  it("reassembles a path split across chunks, one byte at a time", () => {
    const reader = new NulRecordReader();
    const stream = join0(["docs/adr/0011-file-discovery-next-side.md", "pnpm-lock.yaml"]);
    for (const chunk of slice(stream, 1)) reader.feed(chunk);
    reader.close();
    expect(reader.records).toEqual(["docs/adr/0011-file-discovery-next-side.md", "pnpm-lock.yaml"]);
  });

  it("keeps the final record, which arrives with no trailing separator", () => {
    const reader = new NulRecordReader();
    reader.feed(bytes("first\0second\0last"));
    reader.close();
    expect(reader.records).toEqual(["first", "second", "last"]);
  });

  it("drops empty records (a NUL-run in the stream is not a path)", () => {
    const reader = new NulRecordReader();
    reader.feed(bytes("a\0\0b\0"));
    reader.close();
    expect(reader.records).toEqual(["a", "b"]);
  });

  it("stops AT the ceiling, never after it, and says so", () => {
    const reader = new NulRecordReader();
    reader.feed(join0(Array.from({ length: LIST_MAX_ENTRIES + 500 }, (_, i) => `f${String(i)}`)));
    reader.close();
    expect(reader.records).toHaveLength(LIST_MAX_ENTRIES);
    expect(reader.budgetHit).toBe(true);
  });

  it("ignores everything after the ceiling is hit", () => {
    const reader = new NulRecordReader();
    reader.feed(join0(Array.from({ length: LIST_MAX_ENTRIES }, (_, i) => `f${String(i)}`)));
    expect(reader.budgetHit).toBe(true);
    reader.feed(join0(["too", "late"]));
    reader.close();
    expect(reader.records).toHaveLength(LIST_MAX_ENTRIES);
    expect(reader.records[LIST_MAX_ENTRIES - 1]).toBe(`f${String(LIST_MAX_ENTRIES - 1)}`);
  });

  it("accumulates the ceiling across many small feeds, not per feed", () => {
    const reader = new NulRecordReader();
    const half = Math.floor(LIST_MAX_ENTRIES / 2);
    const batch = (offset: number): Uint8Array =>
      join0(Array.from({ length: half }, (_, i) => `p${String(offset + i)}`));
    for (let n = 0; n < 3; n++) reader.feed(batch(n * half));
    reader.close();
    expect(reader.records).toHaveLength(LIST_MAX_ENTRIES);
    expect(reader.budgetHit).toBe(true);
  });
});

describe("a multi-byte path split at a chunk boundary (finding #1)", () => {
  // CJK codepoints are 3 bytes each, so a 4-byte chunk boundary cuts a
  // character in half - and the LAST record is the interesting case, because
  // that is where an unflushed decoder drops the tail.
  const paths = ["README.md", "src/文档.md", "docs/日本語/plan-Ω.md"];

  it("keeps every path whole when chunks cut characters mid-stream", () => {
    const reader = new NulRecordReader();
    for (const chunk of slice(join0(paths), 4)) reader.feed(chunk);
    reader.close();
    expect(reader.records).toEqual(paths);
  });

  it("keeps the FINAL path whole when the split lands on its last byte", () => {
    const stream = join0(paths);
    const at = stream.byteLength - 2; // inside the final codepoint of the last record
    const reader = new NulRecordReader();
    reader.feed(stream.slice(0, at));
    reader.feed(stream.slice(at));
    reader.close();
    expect(reader.records).toEqual(paths);
    expect(reader.records[2]).toBe("docs/日本語/plan-Ω.md");
  });

  it("does not lose the last record when it has no trailing separator", () => {
    const stream = bytes("a\0b\0c-é");
    const reader = new NulRecordReader();
    for (const chunk of slice(stream, 3)) reader.feed(chunk);
    reader.close();
    expect(reader.records).toEqual(["a", "b", "c-é"]);
  });
});

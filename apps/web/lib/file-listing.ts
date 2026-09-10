/**
 * The bounded listing legs behind `@`-reference discovery (ADR-0011, AC 22).
 *
 * Split from `file-discovery.ts` because that module is a server action (its
 * exports must all be async, so nothing pure can be exported from it for a
 * unit test) and these are the two rules AC 22 actually turns on: a hard
 * ceiling on how much a listing may cost, and a result that says so when it
 * hit one. No node imports here - the reader is fed the bytes a child process
 * produces, exactly as they arrive.
 */

/** Paths one listing may carry before it stops and calls itself partial. */
export const LIST_MAX_ENTRIES = 20_000;
/** Bytes one listing may read before it stops and calls itself partial. */
export const LIST_MAX_BYTES = 32 * 1024 * 1024;

/**
 * An incremental reader for NUL-delimited output (`git ls-files -z`).
 *
 * It owns the UTF-8 decoder on purpose. Both hazards here come from streaming
 * rather than accumulating, and both are the reader's to make impossible:
 *
 *   - a path straddling two chunks, including a multi-byte character split
 *     down the middle. Decoding is the reader's job, so a caller cannot forget
 *     that `stream: true` parks a partial codepoint inside the decoder and
 *     that a closing `decode()` is required before the last record is read -
 *     which is exactly the bug this shape removes (PR #137 review finding #1);
 *   - a listing that never ends. The entry ceiling is checked as records
 *     complete, so the cost of a huge repo is paid up to the ceiling and no
 *     further; `budgetHit` tells the caller to kill the child and stop feeding.
 */
export class NulRecordReader {
  private readonly decoder = new TextDecoder("utf8");
  private tail = "";
  private _budgetHit = false;
  readonly records: string[] = [];

  /** True once the entry ceiling is reached; further feeding is ignored. */
  get budgetHit(): boolean {
    return this._budgetHit;
  }

  /** One chunk of child-process output, undecoded. */
  feed(chunk: Uint8Array): void {
    if (this._budgetHit) return;
    this.consume(this.decoder.decode(chunk, { stream: true }));
  }

  /**
   * End of stream: flush the decoder - a codepoint split at the LAST boundary
   * is still inside it - then take the final record, which arrives without a
   * trailing separator.
   */
  close(): void {
    if (this._budgetHit) return;
    this.consume(this.decoder.decode());
    const rest = this.tail;
    this.tail = "";
    if (rest === "") return;
    if (this.records.length >= LIST_MAX_ENTRIES) {
      this._budgetHit = true;
      return;
    }
    this.records.push(rest);
  }

  private consume(text: string): void {
    const parts = (this.tail + text).split("\0");
    // The last piece is a path still in flight: keep it for the next chunk.
    this.tail = parts.pop() ?? "";
    for (const part of parts) {
      if (part === "") continue;
      if (this.records.length >= LIST_MAX_ENTRIES) {
        this._budgetHit = true;
        this.tail = "";
        return;
      }
      this.records.push(part);
    }
    // Trip at the ceiling, not one record past it: the caller kills its child
    // on this signal, and a listing that has to overflow before it notices
    // has already paid for the overflow.
    if (this.records.length >= LIST_MAX_ENTRIES) {
      this._budgetHit = true;
      this.tail = "";
    }
  }
}

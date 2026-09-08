/**
 * The bounded listing legs behind `@`-reference discovery (ADR-0011, AC 22).
 *
 * Split from `file-discovery.ts` because that module is a server action (its
 * exports must all be async, so nothing pure can be exported from it for a
 * unit test) and these are the two rules AC 22 actually turns on: a hard
 * ceiling on how much a listing may cost, and a result that says so when it
 * hit one. No node imports here - the parser is fed buffers, exactly as the
 * child process feeds them.
 */

/** Paths one listing may carry before it stops and calls itself partial. */
export const LIST_MAX_ENTRIES = 20_000;
/** Bytes one listing may read before it stops and calls itself partial. */
export const LIST_MAX_BYTES = 32 * 1024 * 1024;

/**
 * An incremental splitter for NUL-delimited output (`git ls-files -z` and
 * anything else that lists one path per record).
 *
 * Two hazards this exists to make impossible, both from streaming rather than
 * accumulating: a path straddling two chunks (including a multi-byte
 * character split down the middle - the caller decodes with `stream: true`
 * and hands us text that is already whole), and a listing that never ends.
 * The budget is therefore checked as records complete, so the cost of a huge
 * repo is paid up to the ceiling and no further; `budgetHit` tells the caller
 * to kill the child and stop feeding.
 */
export class NulRecordReader {
  private tail = "";
  private _budgetHit = false;
  readonly records: string[] = [];

  /** True once the entry ceiling is reached; further feeds are ignored. */
  get budgetHit(): boolean {
    return this._budgetHit;
  }

  feed(text: string): void {
    if (this._budgetHit) return;
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

  /** The final record, which arrives without a trailing separator. */
  finish(): void {
    const rest = this.tail;
    this.tail = "";
    if (this._budgetHit || rest === "") return;
    if (this.records.length >= LIST_MAX_ENTRIES) {
      this._budgetHit = true;
      return;
    }
    this.records.push(rest);
  }
}

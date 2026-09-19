/**
 * The per-browser dismissal ack (story #146 AC 6, task #147 commit 4).
 *
 * When the handback puts released queue work into the composer and the
 * operator then DELETES that draft, the return is dismissed: a later reload
 * must not offer those items again. AC 6 fixes the shape of the memory -
 * per-browser, keyed by item id, and explicitly "no content store" - so this
 * holds only the ids the operator dismissed, never the text. Text is the
 * composer's and the host's, never this store's.
 *
 * Scope and expiry follow task #147's settled reading: keyed per session (a
 * pending-message id is only meaningful within its own session's inbox),
 * never expired. #146's own Open Question flags an old never-resurfacing
 * return as a silent loss too, but suppressing a duplicate handback is the
 * stated job and permanence is the simplest way to hold it; widening the
 * store or expiring entries is a later, evidence-led change, not this door.
 *
 * localStorage is best-effort: a missing/unavailable store (SSR, private
 * mode throwing) degrades to "no acks," which only means a handback could be
 * offered again - never that work is dropped. Reads are defensive because
 * the stored value is untrusted (hand-edited, stale, a future writer).
 */

/** One browser storage surface; `Storage` structurally satisfies it. */
export interface AckStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const PREFIX = "dsh-next-app.handback-dismissed:";

/** The store key for one session's dismissal set. */
export function ackKey(sessionId: string): string {
  return PREFIX + sessionId;
}

/** The ids dismissed for a session; an unreadable or malformed store is empty. */
export function readDismissed(storage: AckStorage | undefined, sessionId: string): Set<string> {
  if (storage === undefined) return new Set();
  let raw: string | null;
  try {
    raw = storage.getItem(ackKey(sessionId));
  } catch {
    return new Set();
  }
  if (raw === null) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

/**
 * Record that the operator dismissed these returned items for this session.
 * Idempotent and order-stable (a re-dismiss of the same ids does not grow the
 * set); a throwing/unavailable store is swallowed - the ack is a nicety, not
 * a correctness gate (the host release already happened at handback time).
 */
export function addDismissed(
  storage: AckStorage | undefined,
  sessionId: string,
  ids: readonly string[],
): void {
  if (storage === undefined || ids.length === 0) return;
  const next = readDismissed(storage, sessionId);
  let grew = false;
  for (const id of ids) {
    if (!next.has(id)) {
      next.add(id);
      grew = true;
    }
  }
  if (!grew) return; // unchanged: don't rewrite (and don't churn a throwing store)
  try {
    storage.setItem(ackKey(sessionId), JSON.stringify([...next]));
  } catch {
    // best-effort only
  }
}

/**
 * The nav's live title overrides (story #134 task #135 commit 6, AC 11).
 *
 * The side nav keeps its request-time data (the downlink is page-scoped -
 * an app-wide subscription is the follow-up's shape), but a title
 * projection arriving on the OPEN chat page's downlink must still settle
 * the nav row without a reload. One module-level store is the seam: the
 * transcript island publishes `title` cells here, sessions-nav reads them
 * through useSyncExternalStore over its request-time rows. Values live in
 * browser memory only - a refresh re-baselines from session.list, which
 * the projection cache already keeps current.
 */
const overrides = new Map<string, string>();
const listeners = new Set<() => void>();
/** Change counter - the useSyncExternalStore snapshot (the Map identity
 * must stay cached, so the version is what a subscription flips). */
let version = 0;

function notify(): void {
  version += 1;
  // Direct Set iteration: an unsubscribe during the loop is honored (the
  // row leaving the nav must not receive its own exit notice) and an
  // subscribe is not visited - both correct here.
  for (const listener of listeners) listener();
}

/** Publish a session's live title (a non-string or empty value is ignored). */
export function setNavTitle(sessionId: string, title: unknown): void {
  if (typeof title !== "string" || title === "") return;
  if (overrides.get(sessionId) === title) return;
  overrides.set(sessionId, title);
  notify();
}

/** The latest live title for a session, or undefined (use the row's own). */
export function navTitleOf(sessionId: string): string | undefined {
  return overrides.get(sessionId);
}

/** Subscribe to any override change (returns the unsubscribe). */
export function subscribeNavLive(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The snapshot for useSyncExternalStore (stable between publishes). */
export function navSnapshot(): number {
  return version;
}

/**
 * Pure session-view model shared by the server and the client bundle
 * (story #107 task #109).
 *
 * The root layout runs {@link arrangeSessions} over the bridge rows so the
 * first paint already carries the stored grouping/sorting (no flash), and
 * the interactive sidebar re-runs the same functions on every control
 * change - identical inputs, identical output, no duplicated logic. This
 * module therefore stays free of server-only imports; its only coupling is
 * the Session row type, imported as a type.
 *
 * Nesting: subagent sessions render beneath their parent. A row counts as
 * a nested child only when its parent-id chain reaches a real root -
 * orphaned parents (id not in the list) and cyclic chains fall back to
 * top-level rows instead of vanishing or looping (AC 2).
 *
 * Ordering decisions, recorded here as the contract (revised scope:
 * grouping is the one user choice - rows always order by last activity):
 *   - rows order by recency, newest first - the session.list wire order -
 *     both across top-level siblings and inside every subtree;
 *   - workspace groups order by their newest member's activity, Ungrouped
 *     last;
 *   - exact updatedAt ties break by id, so server and client render the
 *     same sequence deterministically (a differing order would reintroduce
 *     the flash AC 5 forbids).
 */
import type { Session } from "./sessions";

/** How the nav groups sessions (AC 3). */
export type SessionGroupMode = "workspace" | "none";

/**
 * The persisted half of the view state (the prefs cookie's flat
 * sessionGroup key). Recency needs no stored choice - it is the only order.
 */
export interface SessionViewPreferences {
  /** Grouping mode; absent = flat ("none"). */
  group?: SessionGroupMode;
}

/** The default behind an absent pref (flat). */
export const DEFAULT_GROUP: SessionGroupMode = "none";

/** One rendered row: a parent session plus its nested children. */
export interface SessionRow {
  session: Session;
  children: Session[];
}

/** One rendered group; an undefined label marks the flat (no-grouping) view. */
export interface SessionGroup {
  /** Group identity: the cwd string, "" for the Ungrouped bucket / flat view. */
  key: string;
  /** Header text; undefined renders no header (flat view). */
  label: string | undefined;
  /** Full path behind the label, when the label truncates it (workspace groups). */
  detail?: string;
  rows: SessionRow[];
}

/**
 * Whether id's parent chain terminates at a real root session: true for
 * roots, false for orphaned parents and cycles - those render top-level.
 */
function resolvesToRoot(
  id: string,
  byId: Map<string, Session>,
  resolved: Map<string, boolean>,
): boolean {
  const memo = resolved.get(id);
  if (memo !== undefined) return memo;
  const seen = new Set<string>([id]);
  let current = id;
  for (;;) {
    const parent = byId.get(current)?.parentSessionId;
    // No recorded parent: a root chain.
    if (parent === undefined) return true;
    // Parent not in this listing, or the chain revisits a node (cycle):
    // the chain never terminates at a root.
    if (!byId.has(parent) || seen.has(parent)) return false;
    const memoParent = resolved.get(parent);
    if (memoParent !== undefined) return memoParent;
    seen.add(parent);
    current = parent;
  }
}

/** Recency comparator: newest first, id breaks exact ties deterministically. */
function byRecency(a: Session, b: Session): number {
  return b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Build the nested forest: valid chains nest, broken ones stay top-level. */
function buildForest(sessions: Session[]): {
  topLevel: Session[];
  childrenOf: Map<string, Session[]>;
} {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const resolved = new Map<string, boolean>();
  const topLevel: Session[] = [];
  const childrenOf = new Map<string, Session[]>();
  for (const session of sessions) {
    const parentId = session.parentSessionId;
    const nests =
      parentId !== undefined &&
      parentId !== session.id &&
      byId.has(parentId) &&
      resolvesToRoot(session.id, byId, resolved);
    if (nests && parentId !== undefined) {
      const siblings = childrenOf.get(parentId);
      if (siblings !== undefined) siblings.push(session);
      else childrenOf.set(parentId, [session]);
    } else {
      topLevel.push(session);
    }
  }
  // Children always sort by recency within their subtree (module comment).
  for (const siblings of childrenOf.values()) siblings.sort(byRecency);
  return { topLevel, childrenOf };
}

/** Wrap top-level rows into render rows with their nested children. */
function toRows(topLevel: Session[], childrenOf: Map<string, Session[]>): SessionRow[] {
  return topLevel.map((session) => ({
    session,
    children: childrenOf.get(session.id) ?? [],
  }));
}

/**
 * Arrange raw session rows into the render model for one grouping mode.
 * The same call runs on the server (initial paint) and in the client shell
 * (interactive changes); see the module comment for the ordering contract.
 */
export function arrangeSessions(sessions: Session[], group: SessionGroupMode): SessionGroup[] {
  const { topLevel, childrenOf } = buildForest(sessions);
  topLevel.sort(byRecency);
  if (group === "none") {
    // Flat view: one implicit group without a header - subagent nesting
    // still applies inside it.
    return [{ key: "", label: undefined, rows: toRows(topLevel, childrenOf) }];
  }
  // Workspace grouping: bucket by exact cwd, Ungrouped ("") pinned last,
  // groups ordered by their newest member's activity.
  const workspaces = new Map<string, Session[]>();
  for (const session of topLevel) {
    const key = session.cwd ?? "";
    const bucket = workspaces.get(key);
    if (bucket !== undefined) bucket.push(session);
    else workspaces.set(key, [session]);
  }
  const keys = [...workspaces.keys()].sort((a, b) => {
    if (a === "") return 1;
    if (b === "") return -1;
    const fa = Math.max(...workspaces.get(a)!.map((s) => s.updatedAt));
    const fb = Math.max(...workspaces.get(b)!.map((s) => s.updatedAt));
    return fb - fa;
  });
  return keys.map((key) => {
    if (key === "")
      return { key, label: "Ungrouped", rows: toRows(workspaces.get(key)!, childrenOf) };
    return {
      key,
      label: key.split("/").filter(Boolean).at(-1) ?? key,
      detail: key,
      rows: toRows(workspaces.get(key)!, childrenOf),
    };
  });
}

/**
 * Relative last-activity time (AC 2), built-in-app style buckets:
 * "just now" below a minute, then Xm / Xh / Xd up to 30 days, then the
 * calendar date (YYYY-MM-DD). Future stamps clamp to "just now".
 */
export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
  const seconds = Math.floor((now - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + "m";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + "h";
  const days = Math.floor(hours / 24);
  if (days < 30) return days + "d";
  const date = new Date(timestamp);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
}

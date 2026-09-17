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
 * Nesting: subagent sessions render beneath their parent at full depth
 * (a subagent of a subagent nests two levels down - fork/spawn lineage is
 * a chain, and every chain member renders). A row counts as a nested child
 * only when its parent-id chain reaches a real root - orphaned parents
 * (id not in the list) and cyclic chains fall back to top-level rows
 * instead of vanishing or looping (AC 2).
 *
 * Ordering decisions, recorded here as the contract (revised scope:
 * grouping is the one user choice - rows always order by last activity):
 *   - rows order by recency, newest first - the session.list wire order -
 *     across top-level siblings and within every sibling set at any depth;
 *   - workspace groups order by their newest member's activity, Ungrouped
 *     last;
 *   - exact updatedAt ties break by id, so server and client render the
 *     same sequence deterministically (a differing order would reintroduce
 *     the flash AC 5 forbids).
 *
 * Paging (story #148 task #149): a paged group window shows at most
 * SESSION_PAGE_SIZE *top-level* rows - nested children ride inside their
 * parent's row, so a cut never splits a lineage. The window is cut here,
 * not in the client component, so the server's first paint and hydration
 * compute the same page (AC 6).
 */
import type { Session } from "./sessions";

/**
 * How the nav groups sessions (AC 3); also the whole persisted view state
 * under the cookie's flat sessionGroup key - recency needs no stored
 * choice, it is the only order.
 */
export type SessionGroupMode = "workspace" | "none";

/** The default behind an absent pref (flat). */
export const DEFAULT_GROUP: SessionGroupMode = "none";

/** One rendered row: a session plus its full-depth nested lineage. */
export interface SessionRow {
  session: Session;
  children: SessionRow[];
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
  let result = true;
  for (;;) {
    const parent = byId.get(current)?.parentSessionId;
    // No recorded parent: a root chain.
    if (parent === undefined) {
      result = true;
      break;
    }
    // Parent not in this listing, or the chain revisits a node (cycle):
    // the chain never terminates at a root.
    if (!byId.has(parent) || seen.has(parent)) {
      result = false;
      break;
    }
    const memoParent = resolved.get(parent);
    if (memoParent !== undefined) {
      result = memoParent;
      break;
    }
    seen.add(parent);
    current = parent;
  }
  // Every node on the walked chain shares the outcome: memoize them all so
  // each id's chain is computed at most once.
  for (const node of seen) resolved.set(node, result);
  return result;
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

/**
 * Wrap top-level rows into render rows carrying their full lineage:
 * immediate children recursively nest their own children, so chains deeper
 * than one level still render instead of silently dropping rows.
 */
function toRows(topLevel: Session[], childrenOf: Map<string, Session[]>): SessionRow[] {
  const rowFor = (session: Session): SessionRow => ({
    session,
    children: (childrenOf.get(session.id) ?? []).map(rowFor),
  });
  return topLevel.map(rowFor);
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
 * Top-level rows rendered per paged group before the pager offers more
 * (story #148 AC 1); the built-in nav's COLLAPSED_SESSION_LIMIT value.
 */
export const SESSION_PAGE_SIZE = 5;

/** One group's visible window: everything the fold/pager render needs. */
export interface SessionPage {
  /** The window's rows; nested children ride inside their parent's row. */
  rows: SessionRow[];
  /** The 1-based page actually shown (the requested one clamped). */
  page: number;
  /** At least 1 - an empty group is still page 1 of nothing. */
  pageCount: number;
  /** `Show {n} more` budget: min(SESSION_PAGE_SIZE, rows hidden past the window); 0 hides the button. */
  moreCount: number;
}

/**
 * Window a group's TOP-LEVEL rows to a 1-based page (AC 1-2). Children are
 * not cut: they render inside their parent's row, so a page boundary never
 * orphans a lineage - and the budget only ever counts top-level rows.
 * Out-of-range pages clamp (groups shrink as sessions are removed), keeping
 * server and client renders identical for the same stored page number.
 */
export function sessionPage(rows: SessionRow[], page: number): SessionPage {
  const pageCount = Math.max(1, Math.ceil(rows.length / SESSION_PAGE_SIZE));
  const target = Math.trunc(page);
  const clamped = !Number.isFinite(target) || target < 1 ? 1 : Math.min(target, pageCount);
  const start = (clamped - 1) * SESSION_PAGE_SIZE;
  const visible = rows.slice(start, start + SESSION_PAGE_SIZE);
  return {
    rows: visible,
    page: clamped,
    pageCount,
    moreCount: Math.min(SESSION_PAGE_SIZE, rows.length - start - visible.length),
  };
}

/** Whether row's subtree (the session or any nested descendant) is sessionId. */
function subtreeHas(row: SessionRow, sessionId: string): boolean {
  return row.session.id === sessionId || row.children.some((child) => subtreeHas(child, sessionId));
}

/**
 * The 1-based page whose window contains sessionId - as a top-level row or
 * anywhere inside a nested subtree (the page holding it holds its whole
 * lineage, AC 4's jump target); undefined when the group holds no such row.
 */
export function sessionPageOf(rows: SessionRow[], sessionId: string): number | undefined {
  const index = rows.findIndex((row) => subtreeHas(row, sessionId));
  return index < 0 ? undefined : Math.floor(index / SESSION_PAGE_SIZE) + 1;
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

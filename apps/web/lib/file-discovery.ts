"use server";

/**
 * @-reference file discovery (story #134 task #135 commit 10; AC 21/22) -
 * the app's first product-path filesystem walk, ADR-0011.
 *
 * Why the walk is ours to serve: `FileReferenceService.list` is a host
 * Cordis seam registered in no RpcMethodMap row, so the bridge defines no
 * route to it (ADR-0010), and `host.listDirectory` answers child
 * DIRECTORIES only - no file candidates. The decision (ADR-0011) is a
 * Next-side walk with the same containment discipline the browse door and
 * the create fence already enforce, extended to a PER-SESSION root
 * (host-path.fenceUnderRoot).
 *
 * The safety line (AC 22):
 *   - the root is resolved SERVER-side from the session's own list row -
 *     a client never names a root, only a filter query;
 *   - every returned candidate is containment-checked with realpath on
 *     both sides: `..` segments, absolute paths, and symlink escapes are
 *     refused before the candidate list is built;
 *   - the walk is BOUNDED (git-first: `git ls-files --cached --others
 *     --exclude-standard` is ignore-correct and stops at the repo's own
 *     rules; fallback: a depth- and count-capped recursive readdir
 *     skipping `.git`/`node_modules`/`dist`), briefly CACHED per cwd
 *     (CANDIDATE_CACHE_TTL_MS), and CANCELLED on a newer request for the
 *     same session so a fast typist is never overtaken by a slow scan
 *     (the client's latest-wins guard is the second half of that promise).
 *
 * What crosses back is PATHS ONLY (never contents), each with the
 * insertion mention formatted by the host's own grammar
 * (`formatFileMention`) so the composer's `@` token stays the host's
 * vocabulary end to end.
 */
import { spawn } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { formatFileMention } from "@deepseek-ai/dsh-file-reference/grammar";
import { canonicalRoot, fenceUnderRoot } from "./host-path";
import { getActionBridgeClient } from "./bridge";

/** How many candidates one search may return (the menu's own window). */
const CANDIDATE_CAP = 50;
/** Fallback-walk bounds: depth and entries examined before bailing. */
const WALK_MAX_DEPTH = 10;
const WALK_MAX_ENTRIES = 20_000;
/** Per-cwd candidate-list cache lifetime - discovery is a UX affordance. */
const CANDIDATE_CACHE_TTL_MS = 5_000;
/** Directories the non-git fallback never descends into. */
const SKIP_DIRECTORIES = new Set([".git", "node_modules", "dist"]);

/** One candidate: a session-relative path and its kind. */
interface DiscoveredEntry {
  path: string;
  kind: "file" | "directory";
}

/** Cache record per realpath'd session root. */
interface RootCache {
  at: number;
  entries: DiscoveredEntry[];
  /** True when the git listing was incomplete (huge repo) - score anyway. */
  partial: boolean;
}

const cache = new Map<string, RootCache>();
/** One in-flight scan per session root; a newer request aborts the last. */
const scanning = new Map<string, AbortController>();

export type FileCandidate = {
  /** Session-relative path (the menu's line). */
  path: string;
  kind: "file" | "directory";
  /** The host-grammar mention the composer inserts. */
  mention: string;
};

export type FileSearchResult = { ok: true; items: FileCandidate[] } | { ok: false; error: string };

/** The session's own cwd, resolved server-side; null when it has none. */
async function sessionRoot(sessionId: string): Promise<string | null> {
  const response = await getActionBridgeClient().sessions.list({});
  if (!response.result.ok) return null;
  const row = response.result.value.items.find((item) => item.sessionId === sessionId);
  const cwd = row?.cwd;
  if (typeof cwd !== "string" || cwd === "") return null;
  return canonicalRoot(cwd);
}

/** git at the root? Its tracked+untracked listing is the ignore-aware walk. */
function gitList(root: string, signal: AbortSignal): Promise<DiscoveredEntry[] | null> {
  return new Promise((resolve) => {
    let out = "";
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
        cwd: root,
        signal,
      });
    } catch {
      resolve(null);
      return;
    }
    child.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
    });
    child.on("error", () => resolve(null)); // no git, or not a repo
    child.on("close", (code) => {
      if (code !== 0 || out === "") {
        resolve(null);
        return;
      }
      const files = out
        .split("\0")
        .filter((line) => line !== "")
        .map((path) => ({ path, kind: "file" as const }));
      resolve(withDirectoryAncestors(files));
    });
  });
}

/** Derive the directory set implied by file paths (git lists files only). */
function withDirectoryAncestors(files: DiscoveredEntry[]): DiscoveredEntry[] {
  const entries = [...files];
  const dirs = new Set<string>();
  for (const file of files) {
    let parent = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "";
    while (parent !== "") {
      if (!dirs.has(parent)) {
        dirs.add(parent);
        entries.push({ path: parent, kind: "directory" });
      }
      parent = parent.includes("/") ? parent.slice(0, parent.lastIndexOf("/")) : "";
    }
  }
  return entries;
}

/** The bounded, ignore-blind fallback walk when git cannot answer. */
function walk(root: string, signal: AbortSignal): { entries: DiscoveredEntry[]; partial: boolean } {
  const entries: DiscoveredEntry[] = [];
  let examined = 0;
  let partial = false;
  const step = (dir: string, depth: number): void => {
    if (signal.aborted || depth > WALK_MAX_DEPTH) return;
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return; // unreadable corner: skip it, keep the scan alive
    }
    for (const name of names) {
      if (signal.aborted) return;
      if (examined++ > WALK_MAX_ENTRIES) {
        partial = true;
        return;
      }
      if (name.startsWith(".") || SKIP_DIRECTORIES.has(name)) continue;
      const abs = join(dir, name);
      let isDir = false;
      try {
        isDir = statSync(abs).isDirectory();
      } catch {
        continue;
      }
      const rel = abs
        .slice(root.length + 1)
        .split(sep)
        .join("/");
      // AC 22: a symlinked directory escaping the root never enters the
      // list - realpath containment gates every candidate as it is found.
      if (fenceUnderRoot(root, rel).ok === false) continue;
      entries.push({ path: rel, kind: isDir ? "directory" : "file" });
      if (isDir) step(abs, depth + 1);
    }
  };
  step(root, 1);
  return { entries, partial };
}

/** Newest-request-wins: abort any older scan for the same root. */
async function entriesFor(root: string): Promise<DiscoveredEntry[]> {
  const hit = cache.get(root);
  if (hit !== undefined && Date.now() - hit.at < CANDIDATE_CACHE_TTL_MS) return hit.entries;
  scanning.get(root)?.abort();
  const controller = new AbortController();
  scanning.set(root, controller);
  try {
    let entries = await gitList(root, controller.signal);
    let partial = false;
    if (entries === null) {
      const walked = walk(root, controller.signal);
      entries = walked.entries;
      partial = walked.partial;
    }
    // Containment applies to git output too: core.quotepath oddities and
    // submodule edges are refused rather than trusted.
    const safe = entries.filter((entry) => fenceUnderRoot(root, entry.path).ok);
    cache.set(root, { at: Date.now(), entries: safe, partial });
    return safe;
  } finally {
    if (scanning.get(root) === controller) scanning.delete(root);
  }
}

/** Deterministic subsequence-leaning score: basename hits beat path hits. */
function score(entry: DiscoveredEntry, needle: string): [number, number, string] {
  const base = entry.path.slice(entry.path.lastIndexOf("/") + 1).toLowerCase();
  const path = entry.path.toLowerCase();
  if (base.startsWith(needle)) return [0, entry.path.length, entry.path];
  if (base.includes(needle)) return [1, entry.path.length, entry.path];
  if (path.includes(needle)) return [2, entry.path.length, entry.path];
  // subsequence fallback (matches the host's fuzz feel; deterministic).
  let i = 0;
  for (const ch of path) {
    if (ch === needle[i]) i += 1;
    if (i === needle.length) return [3, entry.path.length, entry.path];
  }
  return [9, entry.path.length, entry.path];
}

/**
 * Search the session's cwd for `@`-reference candidates. `query` is a
 * FILTER only - it never names a path to open; the session's own cwd
 * (resolved from session.list server-side) is the only root ever walked.
 */
export async function searchFileReferences(
  sessionId: string,
  query: string,
): Promise<FileSearchResult> {
  if (typeof sessionId !== "string" || sessionId === "")
    return { ok: false, error: "sessionId required" };
  let root: string | null;
  try {
    root = await sessionRoot(sessionId);
  } catch (error) {
    console.error("[file-discovery] session root lookup failed:", error);
    return { ok: false, error: "the bridge is unavailable" };
  }
  if (root === null) return { ok: true, items: [] }; // no recorded cwd: no file references
  const needle = query.trim().toLowerCase();
  let entries: DiscoveredEntry[];
  try {
    entries = await entriesFor(root);
  } catch (error) {
    console.error("[file-discovery] scan failed:", error);
    return { ok: false, error: "the file listing failed" };
  }
  const filtered = (needle === "" ? entries.filter((e) => !e.path.includes("/")) : entries)
    .map((entry) => ({ entry, rank: score(entry, needle) }))
    .filter(
      ({ entry, rank }) =>
        needle === "" || rank[0] < 9 || entry.path.toLowerCase().includes(needle),
    )
    .sort(
      (a, b) =>
        a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] || a.rank[2].localeCompare(b.rank[2]),
    )
    .slice(0, CANDIDATE_CAP);
  const items: FileCandidate[] = [];
  for (const { entry } of filtered) {
    const mention = formatFileMention(
      { path: entry.path.replace(/\/$/u, ""), kind: entry.kind },
      query.trim().startsWith('"'),
    );
    if (mention === undefined) continue; // unrepresentable path: drop, never guess
    items.push({ path: entry.path, kind: entry.kind, mention });
  }
  return { ok: true, items };
}

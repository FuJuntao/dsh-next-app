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
 *   - the walk is BOUNDED on BOTH legs, not just the fallback: the git leg
 *     reads `git ls-files --cached --others --exclude-standard -z` (ignore-
 *     correct) through a streaming record counter that kills the child at
 *     `LIST_MAX_ENTRIES` / `LIST_MAX_BYTES`, and the fallback is a depth- and
 *     count-capped async recursive readdir skipping
 *     `.git`/`node_modules`/`dist`; either may report `partial`, briefly
 *     CACHED per cwd (CANDIDATE_CACHE_TTL_MS, at most CACHE_MAX_ROOTS live),
 *     and CANCELLED on a newer request for the same session - async fs on
 *     purpose, so the cancel lands mid-scan rather than after it - so a fast
 *     typist is never overtaken by a slow scan (the client's latest-wins
 *     guard is the second half of that promise).
 *
 * What crosses back is PATHS ONLY (never contents), each with the
 * insertion mention formatted by the host's own grammar
 * (`formatFileMention`) so the composer's `@` token stays the host's
 * vocabulary end to end.
 */
import { spawn } from "node:child_process";
import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, sep } from "node:path";
import { formatFileMention } from "@deepseek-ai/dsh-file-reference/grammar";
import { canonicalRoot, fenceUnderRoot } from "./host-path";
import { getActionBridgeClient } from "./bridge";
import { LIST_MAX_BYTES, LIST_MAX_ENTRIES, NulRecordReader } from "./file-listing";

/** How many candidates one search may return (the menu's own window). */
const CANDIDATE_CAP = 50;
/** Fallback-walk bounds: depth and entries examined before bailing. */
const WALK_MAX_DEPTH = 10;
const WALK_MAX_ENTRIES = 20_000;
/** Per-cwd candidate-list cache lifetime - discovery is a UX affordance. */
const CANDIDATE_CACHE_TTL_MS = 5_000;
/** Directories the non-git fallback never descends into. */
const SKIP_DIRECTORIES = new Set([".git", "node_modules", "dist"]);
/**
 * How many session roots' listings one process may hold at once. The TTL
 * bounds how STALE a listing may be; this bounds how MANY exist - without
 * it, a long-lived server accumulates a full-tree listing for every cwd
 * ever queried, which is the memory AC 22 promises is capped.
 */
const CACHE_MAX_ROOTS = 16;

/** One candidate: a session-relative path and its kind. */
interface DiscoveredEntry {
  path: string;
  kind: "file" | "directory";
}

/** What either leg produced, and whether a ceiling cut it short. */
interface Listing {
  entries: DiscoveredEntry[];
  partial: boolean;
}

/** Cache record per realpath'd session root. */
interface RootCache {
  at: number;
  entries: DiscoveredEntry[];
  /** True when a ceiling cut the listing short (huge repo) - score anyway. */
  partial: boolean;
}

const cache = new Map<string, RootCache>();
/** One in-flight scan per session root; a newer request aborts the last. */
const scanning = new Map<string, AbortController>();

/**
 * Write through the cache, dropping what expired and what will not fit.
 * Insertion order stands in for recency: a fresh read never rewrites a
 * record, so the oldest entry is always the first key.
 */
function cachePut(root: string, listing: Listing): void {
  const now = Date.now();
  for (const [key, record] of cache) {
    if (now - record.at >= CANDIDATE_CACHE_TTL_MS) cache.delete(key);
  }
  cache.set(root, { at: now, entries: listing.entries, partial: listing.partial });
  while (cache.size > CACHE_MAX_ROOTS) {
    const oldest = cache.keys().next();
    if (oldest.done === true) break;
    cache.delete(oldest.value);
  }
}

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

/**
 * The git leg's three outcomes, named. "unavailable" (no git binary, not a
 * repo, empty listing) hands off to the fallback walk; "aborted" hands
 * nothing to anyone; only "listing" is a result. Collapsing abort into
 * "unavailable" - which is what this did before - made a superseded scan
 * look like a repo git could not answer for, and started a full-tree readdir
 * behind the reader's back.
 */
type GitOutcome =
  | { status: "listing"; entries: DiscoveredEntry[]; partial: boolean }
  | { status: "unavailable" }
  | { status: "aborted" };

/**
 * git at the root? Its tracked+untracked listing is the ignore-aware walk -
 * and the PRIMARY leg, so it carries AC 22's bound rather than inheriting
 * one from the repo: the NUL stream is counted as it arrives and the child
 * is killed at the entry or byte ceiling, exactly like the fallback's caps.
 * A whole-repo string never exists, and neither does its memory.
 */
async function gitList(root: string, signal: AbortSignal): Promise<GitOutcome> {
  return await new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
        cwd: root,
        signal,
      });
    } catch {
      resolve({ status: "unavailable" });
      return;
    }
    const reader = new NulRecordReader();
    const decoder = new TextDecoder("utf8");
    let bytes = 0;
    let ceiling = false;
    let failed = false;

    /** The budget IS the bound: stop paying for a listing that already is. */
    const stopAtCeiling = (): void => {
      ceiling = true;
      child.kill("SIGKILL");
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      if (ceiling || reader.budgetHit) return;
      bytes += chunk.byteLength;
      if (bytes > LIST_MAX_BYTES) {
        stopAtCeiling();
        return;
      }
      // stream: true - a chunk may cut a multi-byte path in half.
      reader.feed(decoder.decode(chunk, { stream: true }));
      if (reader.budgetHit) stopAtCeiling();
    });
    child.on("error", () => {
      // No git binary, or not a repo. An aborted spawn reports here too, so
      // the abort is what gets checked first.
      failed = true;
    });
    child.on("close", (code) => {
      if (signal.aborted) {
        resolve({ status: "aborted" });
        return;
      }
      if (failed || (!ceiling && code !== 0)) {
        resolve({ status: "unavailable" });
        return;
      }
      reader.finish();
      if (!ceiling && reader.records.length === 0) {
        resolve({ status: "unavailable" }); // an empty repo is not evidence
        return;
      }
      const files: DiscoveredEntry[] = reader.records.map((path) => ({
        path,
        kind: "file" as const,
      }));
      const derived = withDirectoryAncestors(files, ceiling);
      resolve({ status: "listing", entries: derived.entries, partial: derived.partial });
    });
  });
}

/**
 * Derive the directory set implied by file paths (git lists files only).
 * Ancestors count toward the ceiling too - they are the other ~2x a
 * deep listing costs - so the result is capped even when the stream was not.
 */
function withDirectoryAncestors(files: DiscoveredEntry[], partialIn: boolean): Listing {
  const entries = [...files];
  const dirs = new Set<string>();
  let partial = partialIn;
  outer: for (const file of files) {
    let parent = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "";
    while (parent !== "") {
      if (!dirs.has(parent)) {
        if (entries.length >= LIST_MAX_ENTRIES) {
          partial = true;
          break outer;
        }
        dirs.add(parent);
        entries.push({ path: parent, kind: "directory" });
      }
      parent = parent.includes("/") ? parent.slice(0, parent.lastIndexOf("/")) : "";
    }
  }
  return { entries, partial };
}

/**
 * The bounded, ignore-blind fallback walk when git cannot answer.
 *
 * ASYNC on purpose (finding #9): the sync version could poll `signal.aborted`
 * a thousand times and never observe one, because nothing else runs inside a
 * single Node turn - the newer request that aborted it was queued behind the
 * whole scan. Every `await` here is a yield where that abort actually lands,
 * so "hard cancel" means what ADR-0011 says it means.
 */
async function walk(root: string, signal: AbortSignal): Promise<Listing> {
  const entries: DiscoveredEntry[] = [];
  let examined = 0;
  let partial = false;
  const step = async (dir: string, depth: number): Promise<void> => {
    if (signal.aborted) return;
    if (depth > WALK_MAX_DEPTH) {
      partial = true;
      return;
    }
    let names: Dirent[];
    try {
      names = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // unreadable corner: skip it, keep the scan alive
    }
    for (const entry of names) {
      if (signal.aborted) return;
      if (examined++ > WALK_MAX_ENTRIES || entries.length >= LIST_MAX_ENTRIES) {
        partial = true;
        return;
      }
      const name = entry.name;
      if (name.startsWith(".") || SKIP_DIRECTORIES.has(name)) continue;
      const abs = join(dir, name);
      let isDir = entry.isDirectory();
      if (entry.isSymbolicLink()) {
        try {
          // A symlink is only worth its stat when it may still be contained.
          isDir = (await stat(abs)).isDirectory();
        } catch {
          continue;
        }
      }
      const rel = abs
        .slice(root.length + 1)
        .split(sep)
        .join("/");
      // AC 22: a symlinked directory escaping the root never enters the
      // list - realpath containment gates every candidate as it is found.
      if (fenceUnderRoot(root, rel).ok === false) continue;
      entries.push({ path: rel, kind: isDir ? "directory" : "file" });
      if (isDir) await step(abs, depth + 1);
    }
  };
  await step(root, 1);
  return { entries, partial };
}

/**
 * Newest-request-wins: abort any older scan for the same root, and read the
 * 5-second cache when it is still fresh. `hit.entries` are handed back when
 * this scan is superseded mid-flight - a stale list beats an empty one.
 */
async function entriesFor(root: string): Promise<Listing> {
  const hit = cache.get(root);
  if (hit !== undefined && Date.now() - hit.at < CANDIDATE_CACHE_TTL_MS)
    return { entries: hit.entries, partial: hit.partial };
  scanning.get(root)?.abort();
  const controller = new AbortController();
  scanning.set(root, controller);
  const stale = (): Listing => ({
    entries: hit?.entries ?? [],
    partial: hit?.partial ?? false,
  });
  try {
    const git = await gitList(root, controller.signal);
    if (git.status === "aborted") return stale();
    const listing: Listing =
      git.status === "listing"
        ? { entries: git.entries, partial: git.partial }
        : await walk(root, controller.signal);
    if (controller.signal.aborted) return stale();
    // Containment applies to git output too: core.quotepath oddities and
    // submodule edges are refused rather than trusted.
    const safe: Listing = {
      entries: listing.entries.filter((entry) => fenceUnderRoot(root, entry.path).ok),
      partial: listing.partial,
    };
    cachePut(root, safe);
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
  let found: Listing;
  try {
    found = await entriesFor(root);
  } catch (error) {
    console.error("[file-discovery] scan failed:", error);
    return { ok: false, error: "the file listing failed" };
  }
  const entries = found.entries;
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

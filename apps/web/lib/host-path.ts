/**
 * The one containment fence for every path a browser may name (review on
 * story #117: the fence was written twice and had already drifted). The
 * rule, stated once: a client-supplied absolute path is canonicalized and
 * must land inside the host's default working folder subtree - or be the
 * folder itself. It gates the browse door (host-browse), the skills read
 * (host-skills), and the session's `cwd` on the way INTO session.create
 * (start-session), so the reads and the mutation enforce the same line.
 *
 * Canonicalization climbs to the nearest EXISTING ancestor when
 * realpathSync throws (a missing file under a symlinked directory would
 * otherwise slip the fence on its unresolved string), and the prefix test
 * tolerates the fence root being `/` itself, where `root + sep` could
 * never match. The host default folder (host.describe.cwd) is realpath-
 * stable and cached per server process; a bridge that cannot answer it
 * fails the fence closed.
 */
import { realpathSync } from "node:fs";
import { basename, dirname, resolve, sep } from "node:path";
import { getActionBridgeClient } from "./bridge";

/** The host's default working folder (realpath-stable), cached per process. */
let hostCwd: string | undefined;

export async function getHostRoot(): Promise<string | null> {
  if (hostCwd !== undefined) return hostCwd;
  try {
    const response = await getActionBridgeClient().host.describe({});
    if (!response.result.ok) {
      console.error(
        `[host-path] host.describe failed: ${response.result.error.code} ${response.result.error.message}`,
      );
      return null;
    }
    hostCwd = realpathSync(response.result.value.cwd);
    return hostCwd;
  } catch (error) {
    console.error("[host-path] host.describe failed:", error);
    return null;
  }
}

/** The fence's verdict: the canonical path, or the reason it is refused. */
export type FencedPath = { ok: true; path: string } | { ok: false; reason: string };

/**
 * realpath that climbs to the nearest existing ancestor for a missing
 * tail, so a symlinked parent cannot smuggle a nonexistent path through
 * the unresolved string.
 */
function canonicalize(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    const parent = dirname(path);
    if (parent === path) return path; // filesystem root: nothing to climb
    return resolve(canonicalize(parent), basename(path));
  }
}

/**
 * Canonicalize `path` and fence it to the host default folder's subtree.
 * Relative paths are refused outright (the `..` they hide is resolved
 * against an unknown base); every failure names itself for the caller's
 * error surface.
 */
export async function fenceInsideHostRoot(path: string): Promise<FencedPath> {
  if (!path.startsWith("/") && !/^[A-Za-z]:[\\/]/u.test(path)) {
    return { ok: false, reason: `relative paths are not accepted: ${path}` };
  }
  const root = await getHostRoot();
  if (root === null) {
    return { ok: false, reason: "cannot read the host default folder (bridge unavailable)" };
  }
  const real = canonicalize(resolve(path));
  const inside = real === root || real.startsWith(root === sep ? sep : root + sep);
  if (!inside) {
    return { ok: false, reason: `folder is outside the default working folder: ${path}` };
  }
  return { ok: true, path: real };
}

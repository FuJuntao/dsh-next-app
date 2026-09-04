"use server";

/**
 * The cwd picker's browse action (story #117 task #122, restricted per
 * review): one directory level of `host.listDirectory` per call, fenced
 * to the host's default working folder's subtree by the shared fence in
 * host-path.ts - the same line the skills read and the session's `cwd`
 * on the way into session.create enforce. The default folder itself IS a
 * selectable choice (the tree's root row, marked "(default)"; the
 * `atRoot` flag stays informational); the crumb chain is trimmed to the
 * subtree so the UI has no escape hatch to render. Hidden entries (host
 * flags them by platform convention; the client owns the display choice)
 * stay out of the listing.
 *
 * The raw bridge remains the gateway's own surface; this is the app's
 * browse entry, scoped by product rule to the deployment's workspace
 * root. The app-side canonicalization assumes the supported topology
 * where dsh spawns this process as its child (shared filesystem); a
 * split-host preview must keep the bridge's cwd under a mount both
 * containers see.
 */
import { sep } from "node:path";
import type { DirectoryListing } from "@deepseek-ai/dsh-host-apiproxy/api";
import { getActionBridgeClient } from "./bridge";
import { fenceInsideHostRoot, getHostRoot } from "./host-path";

/** One browse step: a listing plus the root marker, or a folded failure. */
export type BrowseResult =
  | { ok: true; listing: DirectoryListing; atRoot: boolean }
  | { ok: false; error: string };

/**
 * List one directory level within the host default folder's subtree. An
 * absent path lists the default folder itself (the tree's root); anything
 * outside the subtree is refused by the shared fence before any bridge
 * call.
 */
export async function browseDirectory(path?: string): Promise<BrowseResult> {
  const root = await getHostRoot();
  if (root === null) {
    return { ok: false, error: "cannot read the host default folder (bridge unavailable)" };
  }
  let requested: string;
  if (path === undefined) {
    requested = root;
  } else {
    const fenced = await fenceInsideHostRoot(path);
    if (!fenced.ok) return { ok: false, error: fenced.reason };
    requested = fenced.path;
  }
  try {
    const response = await getActionBridgeClient().host.listDirectory({ path: requested });
    if (!response.result.ok) {
      return {
        ok: false,
        error: `host.listDirectory failed: ${response.result.error.code}: ${response.result.error.message}`,
      };
    }
    const listing = response.result.value;
    return {
      ok: true,
      atRoot: listing.path === root,
      listing: {
        ...listing,
        crumbs: listing.crumbs.filter(
          (crumb) => crumb.path === root || crumb.path.startsWith(root === sep ? sep : root + sep),
        ),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `the dsh bridge call failed: ${message}` };
  }
}

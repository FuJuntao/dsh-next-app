"use server";

/**
 * The cwd picker's browse action (story #117 task #122, restricted per
 * review): one directory level of `host.listDirectory` per call, confined
 * to the host's default working folder - only its subfolders may be
 * browsed or chosen. The browser may pass any path string, so the
 * containment is enforced here on the server, not just in the dialog UI:
 * the requested path is realpath-resolved (which collapses `..` and
 * resolves symlinks against the same filesystem the host serves) and must
 * be strictly below the default folder. The default folder itself is a
 * valid BROWSE root but not a selectable choice - naming no folder already
 * means it (see `atRoot`, which the dialog uses to hide Choose).
 *
 * The raw bridge remains the gateway's own surface; this is the app's
 * browse entry, scoped by product rule to the deployment's workspace
 * root. The default folder (host.describe.cwd) is cached per server
 * process; a bridge that cannot answer it fails the fold, not the fence.
 * The app-side realpath assumes the supported topology where dsh spawns
 * this process as its child (shared filesystem); a split-host preview
 * must keep the bridge's cwd under a mount both containers see.
 */
import { realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import type { DirectoryListing } from "@deepseek-ai/dsh-host-apiproxy/api";
import { getActionBridgeClient } from "./bridge";

/** One browse step: a listing plus the root marker, or a folded failure. */
export type BrowseResult =
  | { ok: true; listing: DirectoryListing; atRoot: boolean }
  | { ok: false; error: string };

/** The host's default working folder (realpath-stable), cached per process. */
let hostCwd: string | undefined;

async function getHostCwd(): Promise<string | null> {
  if (hostCwd !== undefined) return hostCwd;
  try {
    const response = await getActionBridgeClient().host.describe({});
    if (!response.result.ok) {
      console.error(
        `[host-browse] host.describe failed: ${response.result.error.code} ${response.result.error.message}`,
      );
      return null;
    }
    hostCwd = realpathSync(response.result.value.cwd);
    return hostCwd;
  } catch (error) {
    console.error("[host-browse] host.describe failed:", error);
    return null;
  }
}

/**
 * List one directory level within the host default folder's subtree. An
 * absent path lists the default folder itself (the dialog's root view,
 * where no choice is offered); anything outside the subtree is refused
 * before any bridge call, and the crumb chain is trimmed to the subtree
 * so the UI has no escape hatch to render.
 */
export async function browseDirectory(path?: string): Promise<BrowseResult> {
  const root = await getHostCwd();
  if (root === null) {
    return { ok: false, error: "cannot read the host default folder (bridge unavailable)" };
  }
  if (path !== undefined && !path.startsWith("/") && !/^[A-Za-z]:[\\/]/u.test(path)) {
    return { ok: false, error: `relative paths are not accepted: ${path}` };
  }
  const requested = path === undefined ? root : resolve(path);
  let real: string;
  try {
    // Missing targets keep the host's own diagnostic (directory-unreadable
    // from listDirectory); a symlink that points out of the subtree is
    // caught here, where the resolved target is testable.
    real = realpathSync(requested);
  } catch {
    real = requested;
  }
  if (real !== root && !real.startsWith(root + sep)) {
    return { ok: false, error: `folder is outside the default working folder: ${path ?? ""}` };
  }
  try {
    const response = await getActionBridgeClient().host.listDirectory({ path: real });
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
          (crumb) => crumb.path === root || crumb.path.startsWith(root + sep),
        ),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `the dsh bridge call failed: ${message}` };
  }
}

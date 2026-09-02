"use server";

/**
 * The cwd picker's browse action (story #117 task #122): one directory
 * level of `host.listDirectory` per call, served to the composer's folder
 * dialog. The bridge client is server-only (it imports node:http), so the
 * browsing must ride a server action; the native `host.pickDirectory`
 * dialog is out of scope for a remote browser, which is why the story
 * chose in-app browsing. The user-paced 30s client is the right budget
 * here (a directory scan of the host filesystem), and the carrier's
 * request signal follows the caller server-side regardless.
 */
import type { DirectoryListing } from "@deepseek-ai/dsh-host-apiproxy/api";
import { getActionBridgeClient } from "./bridge";

/** One browse step: a listing, or the failure the dialog shows inline. */
export type BrowseResult = { ok: true; listing: DirectoryListing } | { ok: false; error: string };

/**
 * List one host directory level. An absent path lists the host account's
 * home (the contract's own default); unreadable or missing targets arrive
 * as `directory-unreadable` and fold into the error branch like every
 * other RPC failure.
 */
export async function browseDirectory(path?: string): Promise<BrowseResult> {
  try {
    const response = await getActionBridgeClient().host.listDirectory(
      path === undefined ? {} : { path },
    );
    if (!response.result.ok) {
      return {
        ok: false,
        error: `host.listDirectory failed: ${response.result.error.code}: ${response.result.error.message}`,
      };
    }
    return { ok: true, listing: response.result.value };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `the dsh bridge call failed: ${message}` };
  }
}

"use server";

/**
 * The home composer's `@` source (story #117 task #124): session references
 * over `session.search`. The bridge client is server-only, so the search
 * rides a server action; each hit comes back with the display label (the
 * title projection, resolved through the same nav roster the sidebar uses)
 * and the mention token the composer inserts - formatted exactly the way
 * the host's `dsh-session-reference` package formats it (see
 * apps/web/lib/session-reference.ts, drift-guarded by its unit tests).
 *
 * File/directory references are intentionally absent: home has no session
 * cwd context (story non-goal). A failed search folds into `ok: false` and
 * the composer simply offers no options - the draft and the send path are
 * never held hostage by the reference source.
 */
import { getActionBridgeClient } from "./bridge";
import { formatSessionReferenceMention } from "./session-reference";
import { fetchSessions } from "./sessions";

/** One pickable session reference. */
export type SessionReferenceHit = {
  sessionId: string;
  /** Display label: the session's title, or the id when untitled. */
  label: string;
  /** The search snippet - the menu's second line. */
  snippet: string;
  /** The mention token a selection inserts. */
  mention: string;
};

/** Search outcome: hits (possibly none), or the folded failure. */
export type ReferenceSearchResult =
  | { ok: true; items: SessionReferenceHit[] }
  | { ok: false; error: string };

export async function searchSessionReferences(query: string): Promise<ReferenceSearchResult> {
  const trimmed = query.trim();
  if (trimmed === "") {
    return { ok: true, items: [] };
  }
  try {
    const searchPromise = getActionBridgeClient().sessions.search({ query: trimmed });
    // Labels ride the nav roster (its title projection is already the fold
    // the sidebar shows); its fetch folds bridge-down itself, so a listing
    // failure only costs labels, never search results.
    const [response, nav] = await Promise.all([searchPromise, fetchSessions()]);
    if (!response.result.ok) {
      return {
        ok: false,
        error: `session.search failed: ${response.result.error.code}: ${response.result.error.message}`,
      };
    }
    const titles = new Map(
      nav.status === "ok" ? nav.sessions.map((s) => [s.id, s.title] as const) : [],
    );
    const items = response.result.value.items.map((hit) => {
      // The nav's blank fallback "New Session" is not a title worth a
      // mention label - the id reads better there.
      const titled = titles.get(hit.sessionId);
      const label = titled === undefined || titled === "New Session" ? hit.sessionId : titled;
      return {
        sessionId: hit.sessionId,
        label,
        snippet: hit.snippet,
        mention: formatSessionReferenceMention({ sessionId: hit.sessionId, label }),
      };
    });
    return { ok: true, items };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `the dsh bridge call failed: ${message}` };
  }
}

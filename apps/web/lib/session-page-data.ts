/**
 * Server-side session-page data (story #134 task #135 commit 4) - the
 * read path behind /sessions/<id>.
 *
 * First paint is RSC over the bridge (AC 1): the newest tail window of
 * `session.history` (AC 8's ~30 messages) plus the one row of
 * `session.list` carrying the header meta - awaited server-side so the
 * browser never fetches before content is visible. The result is the same
 * deliberate discriminated union as the nav's fetch: `ok`, `not-found`
 * (an unknown or unreadable id, AC 23), and `unavailable` (bridge down,
 * AC 23) - the page renders a distinct surface for each and the shell
 * keeps working.
 *
 * What crosses to the client is the RAW page (entries, hasMore, the
 * projections block) rather than pre-rendered items: the transcript island
 * folds it with the pure model (lib/transcript.ts) - server and client run
 * the identical fold, the session-view pattern - and keeps one
 * incrementally-updated state for live appends and paging after hydration.
 */
import type {
  HistoryEntry,

  SessionProjectionsBlock,
  SessionSummary,
} from "@deepseek-ai/dsh-host-apiproxy/api";
import { SessionId } from "@deepseek-ai/dsh-session/types";
import { BridgeUnavailableError, getBridgeClient } from "./bridge";

/** The initial tail window: the newest ~30 messages (AC 8). */
export const TAIL_WINDOW_MESSAGES = 30;

/** The one history page the first paint shows. */
export interface HistoryWindow {
  entries: HistoryEntry[];
  hasMore: boolean;
  /** The tail page's projection baseline (title seeds the header, AC 11). */
  projections?: SessionProjectionsBlock;
}

/** The header meta (title comes from the projections cell, not here). */
export interface SessionMeta {
  cwd?: string;
  /** Later of creation and the last human prompt (epoch ms). */
  updatedAt: number;
  running: boolean;
}


/** Everything the page needs, or why it cannot show it. */
export type SessionPageData =
  | {
      status: "ok";
      window: HistoryWindow;
      meta: SessionMeta | null;
      blank: boolean;
    }
  | { status: "not-found" }
  | { status: "unavailable" };

/**
 * Fetch the session's first-paint window. `session.history` is the door
 * that knows the id: `session-not-found` (or a bridge error naming the
 * id) folds to `not-found`; any transport failure folds to `unavailable`.
 * The header meta rides `session.list` best-effort - its failure leaves
 * the transcript intact (meta null renders a quieter header).
 */
export async function fetchSessionPage(sessionId: string): Promise<SessionPageData> {
  const client = getBridgeClient();
  try {
    // The route's string id enters the wire vocabulary through the host's
    // own brand factory (the carrier validates non-emptiness).
    const id = SessionId(sessionId);
    const [history, listing] = await Promise.all([
      client.sessions.history({ sessionId: id, maxMessages: TAIL_WINDOW_MESSAGES }),
      client.sessions.list({}).catch((error: unknown) => {
        console.error("[session-page] session.list for meta failed:", error);
        return null;
      }),
    ]);
    if (!history.result.ok) {
      const code = history.result.error.code;
      if (code === "session-not-found") return { status: "not-found" };
      console.error(
        `[session-page] session.history failed: ${code} ${history.result.error.message}`,
      );
      return { status: "unavailable" };
    }
    const value = history.result.value;
    let meta: SessionMeta | null = null;
    let blank = false;
    if (listing !== undefined && listing !== null && listing.result.ok) {
      const row: SessionSummary | undefined = listing.result.value.items.find(
        (item) => item.sessionId === sessionId,
      );
      if (row !== undefined) {
        meta = {
          updatedAt: row.updatedAt,
          running: row.running,
          ...(row.cwd !== undefined ? { cwd: row.cwd } : {}),
        };
        blank = row.blank;
      }
    }
    return {
      status: "ok",
      window: {
        entries: [...value.events],
        hasMore: value.hasMore,
        ...(value.projections !== undefined ? { projections: value.projections } : {}),
      },
      blank,
      meta,
    };
  } catch (error) {
    if (error instanceof BridgeUnavailableError) return { status: "unavailable" };
    console.error("[session-page] session.history failed:", error);
    return { status: "unavailable" };
  }
}

/** The Load older answer: the previous page, or a folded failure. */
export type OlderPageResult =
  | { ok: true; entries: HistoryEntry[]; hasMore: boolean }
  | { ok: false; reason: "not-found" | "transport" };

/**
 * Fetch the page strictly older than `beforeSeq` (AC 8) - the server
 * action the transcript island calls. Same folding as the first paint:
 * never partial rows, and the client keeps the draft/scroll state because
 * the action returns plain data instead of throwing.
 */
export async function fetchOlderPage(
  sessionId: string,
  beforeSeq: number,
): Promise<OlderPageResult> {
  try {
    const response = await getBridgeClient().sessions.history({
      sessionId: SessionId(sessionId),
      beforeSeq,
      maxMessages: TAIL_WINDOW_MESSAGES,
    });
    if (!response.result.ok) {
      return {
        ok: false,
        reason: response.result.error.code === "session-not-found" ? "not-found" : "transport",
      };
    }
    return {
      ok: true,
      entries: [...response.result.value.events],
      hasMore: response.result.value.hasMore,
    };
  } catch (error) {
    console.error("[session-page] load-older failed:", error);
    return { ok: false, reason: "transport" };
  }
}

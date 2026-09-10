"use server";

/**
 * The Load older door (story #134 task #135 commit 4; the channel split:
 * small JSON writes ride server actions): the transcript island asks for
 * the page below `beforeSeq` and receives plain data to fold - failures
 * come back folded too (never a thrown action the client must catch).
 * The bridge call itself lives in session-page-data.ts.
 */
import {
  fetchOlderPage,
  fetchSessionPage,
  type HistoryWindow,
  type OlderPageResult,
} from "./session-page-data";

export async function loadOlderHistory(
  sessionId: string,
  beforeSeq: number,
): Promise<OlderPageResult> {
  return fetchOlderPage(sessionId, beforeSeq);
}

/** The re-sync answer: a fresh tail page, or why there is none. */
export type TailResult =
  | { ok: true; window: HistoryWindow }
  | { ok: false; reason: "not-found" | "transport" };

/**
 * Re-fetch the newest window (ADR-0003's recovery: reconnect = resubscribe
 * + refetch the tail). The island calls it when `session/subscribed
 * .lastSeq` sits below the rendered tail - the gap the stream missed.
 */
export async function refreshSessionTail(sessionId: string): Promise<TailResult> {
  const data = await fetchSessionPage(sessionId);
  if (data.status === "ok") {
    return { ok: true, window: data.window };
  }
  return { ok: false, reason: data.status === "not-found" ? "not-found" : "transport" };
}

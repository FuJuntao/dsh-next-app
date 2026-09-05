"use server";

/**
 * The Load older door (story #134 task #135 commit 4; the channel split:
 * small JSON writes ride server actions): the transcript island asks for
 * the page below `beforeSeq` and receives plain data to fold - failures
 * come back folded too (never a thrown action the client must catch).
 * The bridge call itself lives in session-page-data.ts.
 */
import { fetchOlderPage, type OlderPageResult } from "./session-page-data";

export async function loadOlderHistory(
  sessionId: string,
  beforeSeq: number,
): Promise<OlderPageResult> {
  return fetchOlderPage(sessionId, beforeSeq);
}

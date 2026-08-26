/**
 * Session data for the side nav, fetched live from the running dsh profile.
 *
 * The data channel is the unary envelope bridge (ADR-0003, ADR-0010): the
 * runtime row serves the shipped fetch handler over a unix socket, and this
 * module's {@link fetchSessions} calls `session.list` through the shipped
 * apiproxy client (apps/web/lib/bridge.ts) at request time - the static
 * sample list is gone. The result is deliberately a discriminated union: a
 * transport or protocol failure reports `unavailable` (the shell renders
 * its distinct bridge-down state) instead of throwing into the layout, so
 * the rest of the page always renders - and there is no fallback data to
 * show stale placeholder rows.
 */
import type { SessionSummary } from "@deepseek-ai/dsh-host-apiproxy/api";
import { getBridgeClient } from "./bridge";
import { mockSessionsResult } from "./sessions.mock";

/** One session row in the side nav (the story's session shape). */
export interface Session {
  /** The session id; also the /sessions/[id] route segment. */
  id: string;
  /** The title projection value; blank sessions show "New Session". */
  title: string;
  /** Later of creation and the latest human-authored prompt (epoch ms). */
  updatedAt: number;
  /** Whether the attached agent is running. */
  running: boolean;
  /** Session working directory; absent when unrecorded. */
  cwd?: string;
  /** Fork/spawn lineage; absent for root sessions. */
  parentSessionId?: string;
}

/** The fetch outcome: live sessions, or a distinct bridge-down state. */
export type SessionsResult = { status: "ok"; sessions: Session[] } | { status: "unavailable" };

/**
 * Project one wire summary onto the nav row: the title projection
 * (`projections.values["title"]`, the "title" unit dsh-session-title
 * registers; null or absent means no title yet) falls back to "New
 * Session" exactly like the built-in app's list.
 */
function toSession(summary: SessionSummary): Session {
  // The wire schema types values as a record of unknown (the projection map
  // is merged at runtime by whatever units the host mounts), so the title
  // slot is read structurally.
  const values = summary.projections?.values as Record<string, unknown> | undefined;
  const titleValue = values?.["title"];
  return {
    id: summary.sessionId,
    title: typeof titleValue === "string" && titleValue !== "" ? titleValue : "New Session",
    updatedAt: summary.updatedAt,
    running: summary.running,
    ...(summary.cwd !== undefined && { cwd: summary.cwd }),
    ...(summary.parentSessionId !== undefined && { parentSessionId: summary.parentSessionId }),
  };
}

/**
 * Fetch the live sessions at request time (server components only - the
 * bridge client imports node:http).
 *
 * The shipped client already validates the response envelope and the
 * session.list value against the pinned schemas, so the value here is the
 * typed contract (session.list's items), not a widened wire shape.
 *
 * @returns the sessions, or `unavailable` when the bridge cannot be
 * reached (env absent, connect failure, timeout, or an invalid frame).
 * Business errors surface the same way: the list cannot render.
 */
export async function fetchSessions(): Promise<SessionsResult> {
  // Dev-only mock seam (visual testing): returns the controlled list or
  // the bridge-down state before any bridge call; the env is never set in
  // production, so the real path below is the only one that runs there.
  const mock = mockSessionsResult();
  if (mock !== undefined) return mock;
  try {
    const response = await getBridgeClient().sessions.list({});
    if (!response.result.ok) {
      console.error(
        `[sessions] session.list failed: ${response.result.error.code} ${response.result.error.message}`,
      );
      return { status: "unavailable" };
    }
    return { status: "ok", sessions: response.result.value.items.map(toSession) };
  } catch (error) {
    console.error("[sessions] session.list failed:", error);
    return { status: "unavailable" };
  }
}

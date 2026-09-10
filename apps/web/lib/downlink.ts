/**
 * The browser-facing downlink protocol (story #134 chat island, task #135
 * commit 1) - pure and client-safe, shared by the re-emit route (server side)
 * and the live island (client side).
 *
 * ADR-0001 stands: the browser never sees the envelope. The mux stream the
 * bridge carries is a sequence of ServerRequest envelopes whose payload is a
 * domain `MuxFrame`; this module is the ONE place that crosses the boundary -
 * it drops the envelope wrapper, keeps the frame's own discriminated-union
 * `type` as the browser vocabulary, and lifts an answerable frame's `rpcId`
 * into an opaque `answerToken` the browser echoes back through the respond
 * relay. Nothing here mints an id (ADR-0003/ADR-0010: the client echoes the
 * frame's rpcId, it never creates one), and nothing here imports node - the
 * live island bundles it straight into the client.
 *
 * The `frame` field is the domain `MuxFrame` verbatim: the fold
 * (lib/transcript.ts, commit 3) reads it exactly as the server-side first
 * paint does, so a live append and a history page share one model. The
 * `answerToken` is separate from the frame on purpose - it is transport
 * correlation, not part of the durable event.
 */
import type { MuxFrame } from "@deepseek-ai/dsh-host-apiproxy/api";

/**
 * One browser-facing downlink event: the mux frame plus, for the two
 * answerable frames (`approval/requested`, `question/requested`), the opaque
 * token that settles it through the respond relay. Pure pushes carry no
 * token - their envelope rpcId only identified that one delivery.
 */
export interface DownlinkEvent {
  frame: MuxFrame;
  /** Opaque correlation token; present exactly on answerable frames. */
  answerToken?: string;
}

/** Whether a mux frame expects a client answer (strict dichotomy, per the carrier). */
function isAnswerable(frame: MuxFrame): boolean {
  return frame.type === "approval/requested" || frame.type === "question/requested";
}

/**
 * Cross one envelope-wrapped mux frame to the browser shape. The caller has
 * already parsed the frame (the shipped client validates it against the
 * pinned schema before it yields here); this function only reshapes.
 *
 * @param rpcId - the ServerRequest's rpcId (the correlation token source).
 * @param frame - the domain payload.
 * @returns the browser event; `answerToken` set only for answerable frames.
 */
export function toDownlinkEvent(rpcId: string, frame: MuxFrame): DownlinkEvent {
  return isAnswerable(frame) ? { frame, answerToken: rpcId } : { frame };
}

/**
 * Whether a mux frame belongs to `sessionId`, for the per-tab downlink's
 * server-side filter. Frames that carry no session (the stream-level error)
 * pass through so every tab sees a bridge fault; session-scoped frames are
 * kept only for the tab's own session.
 */
export function frameBelongsToSession(frame: MuxFrame, sessionId: string): boolean {
  return !("sessionId" in frame) || frame.sessionId === sessionId;
}

/** Serialize one browser event to an SSE `data:` record (JSON, single line). */
export function encodeSse(event: DownlinkEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** An SSE comment line - the heartbeat payload; browsers ignore comment records. */
export function encodeHeartbeat(): string {
  return ": ping\n\n";
}

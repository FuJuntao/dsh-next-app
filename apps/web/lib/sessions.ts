/**
 * Static session list for the side nav (story #104).
 *
 * Placeholder content: this app has no data channel to dsh yet - the
 * envelope-protocol bridge (ADR-0003) is a later story. This module is the
 * single swap point: when the bridge lands, replace the constant below with
 * a fetch against the bridge client and keep the shape (id + title) - the
 * side nav and the /sessions/[id] routes both speak it.
 */
export interface Session {
  /** The session id; also the /sessions/[id] route segment. */
  id: string;
  /** The session title shown in the side nav. */
  title: string;
}

/** Sample sessions until the bridge provides real data. */
export const SESSIONS: Session[] = [
  { id: "1", title: "Session 1" },
  { id: "2", title: "Session 2" },
  { id: "3", title: "Session 3" },
];

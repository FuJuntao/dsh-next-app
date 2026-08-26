/**
 * Dev-only mock sessions for visual testing (env-gated; never active
 * without the operator's explicit opt-in).
 *
 * The runtime row forwards DSH_NEXT_APP_MOCK_SESSIONS to the child when
 * the profile is launched with it (the host scrubs DSH_* names from
 * implicit inheritance, so it never reaches the app otherwise):
 *   - "sample": fetchSessions returns a controlled list - varied titles,
 *     running flags, cwds, one subagent row - so the nav can be exercised
 *     without depending on a real profile's data.
 *   - "down": fetchSessions reports the bridge-down state, so the error
 *     row and its Retry action can be tested visually.
 * Any other value (or absence) leaves the real bridge path untouched: the
 * mock is never a fallback, and the e2e suite runs with it off.
 */
import type { Session, SessionsResult } from "./sessions";

/** The mock switch env; "sample" and "down" are the only meaningful values. */
const MOCK_SESSIONS_ENV = "DSH_NEXT_APP_MOCK_SESSIONS";

const HOUR = 3_600_000;
const now = Date.now();

/** The controlled list, varied enough to exercise every row state the nav renders. */
const SAMPLE_SESSIONS: Session[] = [
  {
    id: "mock-impl-bridge",
    title: "Implement the unary envelope bridge",
    updatedAt: now - 2 * HOUR,
    running: true,
    cwd: "/home/fujuntao/dsh-next-app",
  },
  {
    id: "mock-review-pr",
    title: "Review PR 114",
    updatedAt: now - 5 * HOUR,
    running: false,
    cwd: "/home/fujuntao/dsh-next-app",
  },
  { id: "mock-blank", title: "New Session", updatedAt: now - 26 * HOUR, running: false },
  {
    id: "mock-long-title",
    title: "A session whose title is deliberately very long to exercise truncation in the side nav",
    updatedAt: now - 49 * HOUR,
    running: true,
    cwd: "/home/fujuntao/homecenter",
  },
  {
    id: "mock-subagent",
    title: "Subagent: verify the e2e suite",
    updatedAt: now - 3 * HOUR,
    running: false,
    cwd: "/home/fujuntao/homecenter",
    parentSessionId: "mock-impl-bridge",
  },
  {
    id: "mock-tidy-catalog",
    title: "Tidy the workspace catalog",
    updatedAt: now - 7 * 24 * HOUR,
    running: false,
    cwd: "/home/fujuntao",
  },
];

/**
 * The mock result when the mock env is set; undefined leaves the real
 * bridge path untouched.
 */
export function mockSessionsResult(): SessionsResult | undefined {
  switch (process.env[MOCK_SESSIONS_ENV]) {
    case "sample":
      return { status: "ok", sessions: SAMPLE_SESSIONS };
    case "down":
      return { status: "unavailable" };
    default:
      return undefined;
  }
}

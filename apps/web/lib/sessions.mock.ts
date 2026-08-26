/**
 * Dev-only mock sessions for visual testing - switched by a file in the
 * profile's run directory, so the mode changes without restarting the
 * service: write "sample" or "down" to <runDir>/mock-sessions (the run
 * dir is where the bridge socket lives) and refresh the page.
 *
 *   - "sample": fetchSessions returns a controlled list - varied titles,
 *     running flags, cwds, one subagent row - so the nav can be exercised
 *     without depending on a real profile's data.
 *   - "down": fetchSessions reports the bridge-down state, so the error
 *     row and its Retry action can be tested visually.
 *
 * An absent, empty, or unrecognized value leaves the real bridge path
 * untouched: the mock is never a fallback, and the e2e suite runs with
 * the file absent (the scratch profile never writes it). One tiny file
 * read per fetch keeps the switch live at request time; page loads are
 * rare events, so the cost is noise.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Session, SessionsResult } from "./sessions";

/** The switch file sits beside the bridge socket, under the profile run dir. */
const MOCK_SESSIONS_FILENAME = "mock-sessions";

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

/** Read the switch file; absent/unreadable/unrecognized means the real path. */
function readMockMode(): string | undefined {
  const socketPath = process.env["DSH_NEXT_APP_BRIDGE_SOCKET"];
  if (socketPath === undefined) return undefined;
  try {
    const mode = readFileSync(join(dirname(socketPath), MOCK_SESSIONS_FILENAME), "utf8")
      .trim()
      .toLowerCase();
    return mode === "sample" || mode === "down" ? mode : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The mock result when the switch file names a mode; undefined leaves the
 * real bridge path untouched.
 */
export function mockSessionsResult(): SessionsResult | undefined {
  switch (readMockMode()) {
    case "sample":
      return { status: "ok", sessions: SAMPLE_SESSIONS };
    case "down":
      return { status: "unavailable" };
    default:
      return undefined;
  }
}

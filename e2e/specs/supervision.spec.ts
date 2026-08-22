import { readFileSync } from "node:fs";
import net from "node:net";
import { test, expect } from "../support/fixtures";
import { readState } from "../support/state";
import {
  pidAlive,
  processGroupId,
  processGroupMembers,
  uniqueChildOf,
} from "../support/process-tree";

const state = readState();

// The supervision instance serves behind the basic-auth fence too: the
// browser answers the 401 challenge with the suite's test credential pair
// (ADR-0001).
test.use({ httpCredentials: { username: state.auth.user, password: state.auth.password } });

/**
 * Supervision regression (parent issue #76 AC 3): the row restarts a crashed
 * Next child with backoff, and stopping the profile terminates the child's
 * process tree - the port is released with no orphan processes. The
 * supervisionProfile fixture boots this suite's own profile instance and
 * tears it down (per-suite isolation): the stop test ends only that
 * instance, so no other spec file is affected regardless of run order.
 * Within this file, the crash test must run before the stop test, so the
 * tests are declared in execution order under serial mode.
 */
test.describe.configure({ mode: "serial" });

/** Whether a loopback port accepts connections (true) or refuses them (false). */
function portAcceptsConnections(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.setTimeout(3_000, () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

test("a crashed Next child is restarted with backoff and the page is served again", async ({
  page,
  supervisionProfile,
}) => {
  const stderrPath = supervisionProfile.stderrPath;
  if (stderrPath === undefined) {
    throw new Error("the supervision profile must tee its stderr log");
  }
  const childPid = uniqueChildOf(supervisionProfile.dshPid);
  if (childPid === undefined) {
    throw new Error("the row's Next child must be running before the crash");
  }

  // Simulate a crash: SIGKILL leaves no cleanup, so only the row's restart
  // logic (runtime.ts) can bring the child back.
  process.kill(childPid, "SIGKILL");

  // The row records the unexpected exit and its backoff delay on stderr:
  // "next-app-runtime: Next child exited unexpectedly (exitCode null, signal
  // SIGKILL); restarting in 1000ms" (runtime.ts backoff constants).
  await expect
    .poll(() => readFileSync(stderrPath, "utf8"), {
      message: "the row must log the unexpected exit and the restart delay on stderr (runtime.ts)",
      timeout: 30_000,
    })
    .toMatch(/next-app-runtime: Next child exited unexpectedly .*restarting in \d+ms/);

  // The restarted child serves the page again (first backoff delay is 1s,
  // then Next boots).
  await expect(async () => {
    await page.goto(supervisionProfile.baseURL, { timeout: 5_000 });
  }).toPass({ timeout: 90_000 });
  await expect(page).toHaveTitle("dsh-next-app");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("dsh-next-app");
});

test("stopping the profile terminates the child's process tree and releases the port", async ({
  supervisionProfile,
}) => {
  const childPid = uniqueChildOf(supervisionProfile.dshPid);
  if (childPid === undefined) {
    throw new Error("the restarted Next child must be running before the stop");
  }
  const childPgid = processGroupId(childPid);
  if (childPgid <= 0) {
    throw new Error("the Next child must lead its own process group");
  }

  // Stop this suite's own profile the way a user stops a foreground one:
  // SIGTERM to the dsh boot process only. dsh runs its shutdown path (fiber
  // dispose), the row aborts the child and terminates its tree (runtime.ts),
  // then dsh exits. The child leads its own process group, so the signal
  // does not reach it directly - only the row's teardown can terminate the
  // tree.
  process.kill(supervisionProfile.dshPid, "SIGTERM");

  // The row's tree-scoped terminate (SIGTERM, grace, SIGKILL) runs before
  // dsh exits; the whole group must drain.
  await expect
    .poll(() => pidAlive(supervisionProfile.dshPid), {
      message: "dsh must exit when the profile is stopped",
      timeout: 30_000,
    })
    .toBe(false);
  await expect
    .poll(() => processGroupMembers(childPgid).length, {
      message:
        "stopping the profile must terminate the child's process tree - no orphan processes may remain",
      timeout: 30_000,
    })
    .toBe(0);

  // The port is released: the listener is gone, so connections are refused.
  expect(await portAcceptsConnections(supervisionProfile.port)).toBe(false);
});

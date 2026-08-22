import { readFileSync } from "node:fs";
import net from "node:net";
import { test, expect } from "@playwright/test";
import {
  pidAlive,
  processGroupId,
  processGroupMembers,
  uniqueChildOf,
} from "../support/process-tree";
import { readState } from "../support/state";

/**
 * Supervision regression (parent issue #76 AC 3): the row restarts a crashed
 * Next child with backoff, and stopping the profile terminates the child's
 * process tree - the port is released with no orphan processes. The stop
 * test ends the shared scratch profile, so this file must run last:
 * Playwright runs spec files in sorted order with workers: 1 (boot.spec.ts,
 * ready-marker.spec.ts, then this), and the tests below are declared in
 * execution order.
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
}) => {
  const state = readState();
  const childPid = uniqueChildOf(state.dshPid);
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
    .poll(() => readFileSync(state.dshStderrPath, "utf8"), {
      message: "the row must log the unexpected exit and the restart delay on stderr (runtime.ts)",
      timeout: 30_000,
    })
    .toMatch(/next-app-runtime: Next child exited unexpectedly .*restarting in \d+ms/);

  // The restarted child serves the page again (first backoff delay is 1s,
  // then Next boots).
  await expect(async () => {
    await page.goto(state.baseURL, { timeout: 5_000 });
  }).toPass({ timeout: 90_000 });
  await expect(page).toHaveTitle("dsh-next-app");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("dsh-next-app");
});

test("stopping the profile terminates the child's process tree and releases the port", async () => {
  const state = readState();
  const childPid = uniqueChildOf(state.dshPid);
  if (childPid === undefined) {
    throw new Error("the restarted Next child must be running before the stop");
  }
  const childPgid = processGroupId(childPid);
  if (childPgid <= 0) {
    throw new Error("the Next child must lead its own process group");
  }

  // Stop the profile the way a user stops a foreground one: SIGTERM to the
  // dsh boot process only. dsh runs its shutdown path (fiber dispose), the
  // row aborts the child and terminates its tree (runtime.ts), then dsh
  // exits. The child leads its own process group, so the signal does not
  // reach it directly - only the row's teardown can terminate the tree.
  process.kill(state.dshPid, "SIGTERM");

  // The row's tree-scoped terminate (SIGTERM, grace, SIGKILL) runs before
  // dsh exits; the whole group must drain.
  await expect
    .poll(() => pidAlive(state.dshPid), {
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
  expect(await portAcceptsConnections(state.port)).toBe(false);
});

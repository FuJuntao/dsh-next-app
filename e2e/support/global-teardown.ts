import { existsSync, readFileSync, rmSync } from "node:fs";
import { sleep } from "./process";
import { STATE_PATH, type E2EState } from "./state";

/** Stop the profile (SIGTERM then SIGKILL its process group) and remove the scratch dir. */
export default async function globalTeardown(): Promise<void> {
  let state: E2EState | undefined;
  try {
    if (existsSync(STATE_PATH)) {
      state = JSON.parse(readFileSync(STATE_PATH, "utf8")) as E2EState;
    }
  } catch {
    state = undefined;
  }

  if (state !== undefined) {
    // Bounded wait: on systems whose init does not reap orphans the exited
    // dsh lingers as a zombie and kill(pid, 0) keeps succeeding, so poll with
    // a hard deadline instead of waiting for the pid to disappear.
    try {
      process.kill(-state.dshPid, "SIGTERM");
    } catch {
      // process group already gone
    }
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      try {
        process.kill(state.dshPid, 0);
      } catch {
        break;
      }
      await sleep(200);
    }
    try {
      process.kill(-state.dshPid, "SIGKILL");
    } catch {
      // process group already gone
    }
    rmSync(state.scratchDir, { recursive: true, force: true });
  }
  rmSync(STATE_PATH, { force: true });
}

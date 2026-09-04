import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { stopProfile } from "./profile";
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

    // The dedicated-instance specs register their boots: supervision writes
    // one fixed registry (no install involved), and every installed scratch
    // instance lands in the instances/ directory. Sweep them all for the
    // case where the spec process died before its fixture teardown.
    const registryPaths = [join(state.scratchDir, "supervision-profile.json")];
    const instancesDir = join(state.scratchDir, "instances");
    if (existsSync(instancesDir)) {
      for (const name of readdirSync(instancesDir)) {
        registryPaths.push(join(instancesDir, name));
      }
    }
    for (const registryPath of registryPaths) {
      try {
        if (existsSync(registryPath)) {
          const registered = JSON.parse(readFileSync(registryPath, "utf8")) as { dshPid?: number };
          if (typeof registered.dshPid === "number" && registered.dshPid !== state.dshPid) {
            await stopProfile(registered.dshPid);
          }
        }
      } catch {
        // unreadable registry: nothing to sweep
      }
    }

    rmSync(state.scratchDir, { recursive: true, force: true });
  }
  rmSync(STATE_PATH, { force: true });
}

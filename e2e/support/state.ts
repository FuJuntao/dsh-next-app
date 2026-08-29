import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Runtime state shared between the global setup/teardown and the specs. */
export interface E2EState {
  /** Scratch directory under the OS temp dir, removed on teardown. */
  scratchDir: string;
  /** The scratch DSH_HOME the profile was booted under. */
  dshHome: string;
  /** The initialized profile directory (dshHome/profiles/next-app). */
  profileDir: string;
  /** The free port the profile was booted on. */
  port: number;
  /** The URL the browser asserts against. */
  baseURL: string;
  /** The exact announce line the dsh process printed on stdout. */
  announceLine: string;
  /** The dsh process id; its process group is the teardown target. */
  dshPid: number;
  /** The packed tarball the profile was installed from; dedicated boots reinstall it. */
  tarballPath: string;
  /** Basic-auth test credentials configured on the shared boot (ADR-0008). */
  auth: {
    /** The username the fence allows. */
    user: string;
    /** The plaintext password; the browser answers the 401 challenge with it. */
    password: string;
  };
}

/** State file location - fixed so specs and teardown find it without cross-process plumbing. */
export const STATE_PATH = join(__dirname, "../.e2e-state.json");

export function readState(): E2EState {
  if (!existsSync(STATE_PATH)) {
    throw new Error(`no e2e state at ${STATE_PATH} - the global setup must run before the specs`);
  }
  return JSON.parse(readFileSync(STATE_PATH, "utf8")) as E2EState;
}

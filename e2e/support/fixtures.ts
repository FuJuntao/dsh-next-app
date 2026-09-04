import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { test as base, expect } from "@playwright/test";
import { bootProfile, scryptValue, writeRuntimePatch, type BootedProfile } from "./profile";
import { run } from "./process";
import { readState } from "./state";

const state = readState();

/** The repo root, as the global setup anchors its invocations. */
const REPO_ROOT = resolve(__dirname, "../..");
/** The profile name every dedicated boot installs (the shared setup's profile). */
const PROFILE = "next-app";
/** Budget for one dedicated profile install (mirrors the global setup's). */
const INSTALL_TIMEOUT_MS = 300_000;

/**
 * Install the packed tarball into its own DSH_HOME and boot a dedicated
 * instance named for the suite that owns it. Each suite gets a distinct
 * `instanceName`, so its sessions (created by seeding, or by the UI under
 * test) exist only for that instance and can never skew another suite's
 * listing counts - even when the serial run reuses one worker. The caller
 * stops the instance; the registration file lets the global teardown sweep
 * it if the worker dies first.
 */
async function installScratchInstance(instanceName: string): Promise<BootedProfile> {
  // Unique per installation attempt: a worker restarted mid-suite after a
  // hard failure must not collide with the crashed attempt's directories
  // (same scratch dir for the whole run). The registration rides the
  // instances/ directory the global teardown sweeps exhaustively.
  const instance = instanceName + "-" + randomUUID().slice(0, 8);
  const home = join(state.scratchDir, instance + "-dsh-home");
  mkdirSync(home, { recursive: true });
  mkdirSync(join(state.scratchDir, "instances"), { recursive: true });
  await run(["dsh", "plugin", "--profile", PROFILE, "add", state.tarballPath], {
    cwd: REPO_ROOT,
    env: { DSH_HOME: home },
    timeoutMs: INSTALL_TIMEOUT_MS,
  });
  // The same fence as the shared boot (ADR-0008): the browser answers
  // the 401 challenge with the suite's credential pair.
  writeRuntimePatch(join(home, "profiles", PROFILE), {
    user: state.auth.user,
    passwordHash: scryptValue(state.auth.password),
  });
  const profile = await bootProfile(home, join(state.scratchDir, instance));
  writeFileSync(
    join(state.scratchDir, "instances", instance + ".json"),
    JSON.stringify({ dshPid: profile.dshPid }),
  );
  return profile;
}

/**
 * The supervision suite's own profile instance: booted once per worker
 * (per-suite isolation) on the installed scratch profile, stopped by the
 * fixture teardown. The stop test ends this instance, so no other spec file
 * is affected regardless of run order. Registered with the global teardown
 * so a hard-killed worker cannot leave the instance behind.
 */
export const test = base.extend<
  {},
  {
    supervisionProfile: BootedProfile;
    sessionsProfile: BootedProfile;
    homeProfile: BootedProfile;
  }
>({
  supervisionProfile: [
    // eslint-disable-next-line no-empty-pattern -- the fixture needs no other worker fixtures; Playwright requires the destructuring form.
    async ({}, use) => {
      // The supervision instance serves behind the same fence as the shared
      // one: it boots the same configured profile (ADR-0008), whose patch
      // carries the credential pair.
      const profile = await bootProfile(state.dshHome, join(state.scratchDir, "supervision"));
      writeFileSync(
        join(state.scratchDir, "supervision-profile.json"),
        JSON.stringify({ dshPid: profile.dshPid }),
      );
      try {
        await use(profile);
      } finally {
        await profile.stop();
      }
    },
    { scope: "worker" },
  ],
  sessionsProfile: [
    // eslint-disable-next-line no-empty-pattern -- the fixture needs no other worker fixtures; Playwright requires the destructuring form.
    async ({}, use) => {
      // The sessions specs boot their own instance from their own DSH_HOME -
      // a fresh install of the packed tarball, not a copy or the shared
      // profile - so the sessions seeded there exist only for this instance
      // and can never leak into the shared instance's session.list. Nothing
      // depends on spec file order.
      const profile = await installScratchInstance("sessions");
      try {
        await use(profile);
      } finally {
        await profile.stop();
      }
    },
    { scope: "worker" },
  ],
  homeProfile: [
    // eslint-disable-next-line no-empty-pattern -- the fixture needs no other worker fixtures; Playwright requires the destructuring form.
    async ({}, use) => {
      // The home composer specs own this instance: the home send creates a
      // real session through the UI, and that row must not skew the
      // sessions suite's seeded-listing counts (or vice versa).
      const profile = await installScratchInstance("home");
      try {
        await use(profile);
      } finally {
        await profile.stop();
      }
    },
    { scope: "worker" },
  ],
});

export { expect };

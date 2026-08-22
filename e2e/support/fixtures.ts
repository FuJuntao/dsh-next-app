import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test as base, expect } from "@playwright/test";
import { bootProfile, type BootedProfile } from "./profile";
import { readState } from "./state";

const state = readState();

/**
 * The supervision suite's own profile instance: booted once per worker
 * (per-suite isolation) on the installed scratch profile, stopped by the
 * fixture teardown. The stop test ends this instance, so no other spec file
 * is affected regardless of run order. Registered with the global teardown
 * so a hard-killed worker cannot leave the instance behind.
 */
export const test = base.extend<{}, { supervisionProfile: BootedProfile }>({
  supervisionProfile: [
    // eslint-disable-next-line no-empty-pattern -- the fixture needs no other worker fixtures; Playwright requires the destructuring form.
    async ({}, use) => {
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
});

export { expect };
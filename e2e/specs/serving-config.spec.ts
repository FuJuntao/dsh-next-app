import { test, expect } from "@playwright/test";
import { freePort } from "../support/port";
import { bootProfile, scryptValue, writeRuntimePatch } from "../support/profile";
import { readState } from "../support/state";

const state = readState();

/** The Authorization header value for one credential pair (RFC 7617). */
function basicHeader(user: string, password: string): string {
  return "Basic " + Buffer.from(user + ":" + password).toString("base64");
}

/** Restore the profile's patch to the full test credential pair (ADR-0008). */
function restoreAuthPatch(): void {
  writeRuntimePatch(state.profileDir, {
    user: state.auth.user,
    passwordHash: scryptValue(state.auth.password),
  });
}

/**
 * The runtime row's serving config (ADR-0009): host/port arrive as cordis
 * row config exactly like auth, and the --host/--port flags override them
 * (flag > config > default). The patch swaps hot-reload the shared
 * instance, so the patch is restored before this suite finishes - later
 * suites boot their own instances from the restored profile.
 */
test.describe("the serving config", () => {
  test("a config-specified host and port serve without --host/--port flags", async () => {
    const configPort = await freePort();
    writeRuntimePatch(state.profileDir, {
      user: state.auth.user,
      passwordHash: scryptValue(state.auth.password),
      host: "127.0.0.1",
      port: configPort,
    });
    try {
      const profile = await bootProfile(state.dshHome, undefined, {
        port: configPort,
        passPortFlag: false,
      });
      try {
        // The fence is active on the config-served instance.
        const unauthenticated = await fetch(profile.baseURL);
        expect(unauthenticated.status).toBe(401);
        const ok = await fetch(profile.baseURL, {
          headers: { authorization: basicHeader(state.auth.user, state.auth.password) },
        });
        expect(ok.status).toBe(200);
      } finally {
        await profile.stop();
      }
    } finally {
      restoreAuthPatch();
    }
  });

  test("--port overrides the config port", async () => {
    const configPort = await freePort();
    const flagPort = await freePort();
    writeRuntimePatch(state.profileDir, {
      user: state.auth.user,
      passwordHash: scryptValue(state.auth.password),
      port: configPort,
    });
    try {
      const profile = await bootProfile(state.dshHome, undefined, { port: flagPort });
      try {
        expect(profile.baseURL).toBe("http://127.0.0.1:" + flagPort);
        const ok = await fetch(profile.baseURL, {
          headers: { authorization: basicHeader(state.auth.user, state.auth.password) },
        });
        expect(ok.status).toBe(200);
      } finally {
        await profile.stop();
      }
    } finally {
      restoreAuthPatch();
    }
  });
});

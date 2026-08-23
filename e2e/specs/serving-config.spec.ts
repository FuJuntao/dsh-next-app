import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { test, expect } from "@playwright/test";
import { freePort } from "../support/port";
import { bootProfile, scryptValue, writeRuntimePatch } from "../support/profile";
import { readState } from "../support/state";

const state = readState();
const REPO_ROOT = resolve(__dirname, "../..");
const PROFILE = "next-app";

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

  test("an invalid config port refuses to start with a loud error", async () => {
    // ADR-0009: a non-positive-integer config port is a misconfiguration
    // like an incomplete auth pair - the Config schema rejects it at load,
    // so dsh exits non-zero with the schema error on stderr (review
    // finding: the suite previously pinned only the auth-pair refusal).
    writeRuntimePatch(state.profileDir, {
      user: state.auth.user,
      passwordHash: scryptValue(state.auth.password),
      port: 0,
    });
    try {
      const port = await freePort();
      const outcome = await new Promise<{ code: number | null; stderr: string }>((settle) => {
        const child = spawn("dsh", ["--profile", PROFILE, "--port", String(port)], {
          cwd: REPO_ROOT,
          env: { ...process.env, DSH_HOME: state.dshHome },
          stdio: ["ignore", "ignore", "pipe"],
        });
        let stderr = "";
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk: string) => {
          stderr += chunk;
        });
        child.on("exit", (code) => settle({ code, stderr }));
        child.on("error", (error) => settle({ code: -1, stderr: String(error) }));
        // Safety net: the profile should fail on its own.
        setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            // already gone
          }
        }, 60_000).unref();
      });
      expect(outcome.code).not.toBe(0);
      expect(outcome.stderr).toMatch(/invalid config/);
      expect(outcome.stderr).toMatch(/port/);
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

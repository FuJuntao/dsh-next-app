import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { test, expect } from "@playwright/test";
import { freePort } from "../support/port";
import { bootProfile, scryptValue, writeRuntimePatch } from "../support/profile";
import { readState } from "../support/state";

const state = readState();
const REPO_ROOT = resolve(__dirname, "../..");
const PROFILE = "next-app";

/** The fail-closed instance's custom realm: proves the config realm travels too. */
const FAIL_CLOSED_REALM = "e2e-realm";

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
 * The basic-auth fence (ADR-0001, ADR-0008): one fence over the whole
 * surface - the page, /api, and static assets - before any route handler
 * runs. The shared instance serves behind the fence with the credential
 * pair configured in the profile's patch; the fail-closed spec swaps the
 * patch for a realm-only config and boots its own instance, and the
 * incomplete-pair spec proves the profile refuses to boot half-gated.
 */
test.describe("the basic-auth fence", () => {
  test("unauthenticated requests get 401 with the realm header on every path", async () => {
    const root = await fetch(state.baseURL);
    expect(root.status).toBe(401);
    expect(root.headers.get("www-authenticate")).toBe('Basic realm="dsh-next-app"');

    const api = await fetch(state.baseURL + "/api/sessions");
    expect(api.status).toBe(401);

    // The matcher covers static assets too (the default matcher skips
    // _next/static): the fence answers before the file server does.
    const asset = await fetch(state.baseURL + "/_next/static/fence-spec-asset.js");
    expect(asset.status).toBe(401);
  });

  test("valid credentials pass the fence; wrong password and unknown user get 401", async () => {
    const ok = await fetch(state.baseURL, {
      headers: { authorization: basicHeader(state.auth.user, state.auth.password) },
    });
    expect(ok.status).toBe(200);
    // The authenticated root follows the redirect to /sessions; assert a
    // stable page marker rather than chrome text that later stories may move.
    expect(await ok.text()).toContain("<title>Sessions</title>");

    const wrongPassword = await fetch(state.baseURL, {
      headers: { authorization: basicHeader(state.auth.user, "wrong-password") },
    });
    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.headers.get("www-authenticate")).toBe('Basic realm="dsh-next-app"');

    const unknownUser = await fetch(state.baseURL, {
      headers: { authorization: basicHeader("nobody", state.auth.password) },
    });
    expect(unknownUser.status).toBe(401);
  });

  test("without the credential pair the surface fails closed and logs a loud error", async () => {
    // Swap the patch for a realm-only config (ADR-0008): the runtime row
    // forwards the realm, the fence gets no credentials and must fail
    // closed. A running instance hot-reloads its config, so the shared
    // instance's child restarts with this config too - it is restored
    // before this spec finishes.
    writeRuntimePatch(state.profileDir, { realm: FAIL_CLOSED_REALM });
    try {
      const logsDir = join(state.scratchDir, "fail-closed");
      const profile = await bootProfile(state.dshHome, logsDir);
      if (profile.stderrPath === undefined) {
        throw new Error("the fail-closed profile must tee its stderr log");
      }
      try {
        const root = await fetch(profile.baseURL);
        expect(root.status).toBe(401);
        expect(root.headers.get("www-authenticate")).toBe(
          'Basic realm="' + FAIL_CLOSED_REALM + '"',
        );

        const api = await fetch(profile.baseURL + "/api/sessions");
        expect(api.status).toBe(401);

        const asset = await fetch(profile.baseURL + "/_next/static/fence-spec-asset.js");
        expect(asset.status).toBe(401);

        // The row inherits the child's stderr, teed into the log dir: the
        // loud fail-closed message must be there (ADR-0001).
        await expect
          .poll(() => readFileSync(profile.stderrPath as string, "utf8"), {
            message:
              "the fence must log a loud configuration error when the credential pair is unset",
            timeout: 30_000,
          })
          .toMatch(/DSH_NEXT_APP_USER and DSH_NEXT_APP_PASSWORD_HASH must both be set/);
      } finally {
        await profile.stop();
      }
    } finally {
      restoreAuthPatch();
    }
  });

  test("a malformed passwordHash value never verifies, even with the right password", async () => {
    // Review finding (security): a truncated key decodes to an empty buffer
    // and scryptSync(keylen 0) + timingSafeEqual(empty, empty) would verify
    // ANY password. The parser pins salt/key lengths and N (ADR-0007), so
    // this value must fail closed - 401 with the right credentials and the
    // loud malformed-value log.
    const logsDir = join(state.scratchDir, "malformed-hash");
    writeRuntimePatch(state.profileDir, {
      user: state.auth.user,
      passwordHash: "scrypt$16384,8,1$c2FsdA==$",
    });
    try {
      const profile = await bootProfile(state.dshHome, logsDir);
      if (profile.stderrPath === undefined) {
        throw new Error("the malformed-hash profile must tee its stderr log");
      }
      try {
        const ok = await fetch(profile.baseURL, {
          headers: { authorization: basicHeader(state.auth.user, state.auth.password) },
        });
        expect(ok.status).toBe(401);
        const other = await fetch(profile.baseURL, {
          headers: { authorization: basicHeader(state.auth.user, "anything-else") },
        });
        expect(other.status).toBe(401);
        await expect
          .poll(() => readFileSync(profile.stderrPath as string, "utf8"), {
            message: "the fence must log a loud error when the configured value is malformed",
            timeout: 30_000,
          })
          .toMatch(/DSH_NEXT_APP_PASSWORD_HASH is malformed or out of format/);
      } finally {
        await profile.stop();
      }
    } finally {
      restoreAuthPatch();
    }
  });

  test("an incomplete credential pair refuses to start with a loud error", async () => {
    // Exactly one side configured: the runtime row must refuse the
    // half-gated surface at mount (ADR-0008) - dsh exits non-zero with the
    // message on stderr.
    writeRuntimePatch(state.profileDir, { user: "e2e" });
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
      expect(outcome.stderr).toMatch(/auth\.user and auth\.passwordHash must be set together/);
    } finally {
      restoreAuthPatch();
    }
  });
});

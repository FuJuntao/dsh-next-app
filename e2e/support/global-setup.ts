import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { run } from "./process";
import { bootProfile, scryptValue, writeAuthPatch, type BootedProfile } from "./profile";
import { STATE_PATH, type E2EState } from "./state";

const REPO_ROOT = resolve(__dirname, "../..");
const PROFILE = "next-app";
const PACK_TIMEOUT_MS = 600_000;
const INSTALL_TIMEOUT_MS = 300_000;

/** The suite's test-only basic-auth credential pair (ADR-0001, ADR-0007). */
const AUTH_USER = "e2e";
const AUTH_PASSWORD = "dsh-next-app-e2e-password";

/** The workspace pnpm (CI/pnpm-on-PATH) or the pinned manager via corepack. */
function pnpmArgs(args: string[]): string[] {
  return hasOnPath("pnpm") ? ["pnpm", ...args] : ["corepack", "pnpm", ...args];
}

function hasOnPath(command: string): boolean {
  for (const dir of (process.env["PATH"] ?? "").split(":")) {
    if (dir !== "" && existsSync(join(dir, command))) return true;
  }
  return false;
}

async function phase<T>(label: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw new Error(`e2e global setup failed at: ${label} (${(error as Error).message})`);
  }
}

/**
 * Pack the bundle, install it into a scratch profile, and boot one shared
 * instance for the boot/ready-marker specs (ADR-0006). The supervision specs
 * boot their own dedicated instance on top of the same installed profile, so
 * their stop test cannot affect any other spec file regardless of run order.
 */
export default async function globalSetup(): Promise<void> {
  const scratchDir = mkdtempSync(join(tmpdir(), "dsh-next-app-e2e-"));
  let booted: BootedProfile | undefined;
  try {
    // 1. Pack the bundle (prepack = fresh, dependency-first build).
    const packDir = join(scratchDir, "pack");
    mkdirSync(packDir);
    await phase("packing the bundle", () =>
      run(pnpmArgs(["--filter", "@scope/dsh-next-app", "pack", "--pack-destination", packDir]), {
        cwd: REPO_ROOT,
        timeoutMs: PACK_TIMEOUT_MS,
      }),
    );
    const tarballs = readdirSync(packDir).filter((name) => name.endsWith(".tgz"));
    if (tarballs.length !== 1) {
      throw new Error(`expected exactly one packed tarball, found: ${tarballs.join(", ")}`);
    }
    const tarballName = tarballs[0];
    if (tarballName === undefined) {
      throw new Error("the packed tarball is missing");
    }
    const tarball = join(packDir, tarballName);

    // 2. Scratch DSH_HOME and the documented profile install.
    const dshHome = join(scratchDir, "dsh-home");
    mkdirSync(dshHome);
    await phase("installing the bundle into the scratch profile", () =>
      run(["dsh", "plugin", "--profile", PROFILE, "add", tarball], {
        cwd: REPO_ROOT,
        env: { DSH_HOME: dshHome },
        timeoutMs: INSTALL_TIMEOUT_MS,
      }),
    );
    const profileDir = join(dshHome, "profiles", PROFILE);

    // 3. Configure the auth credential pair in the profile's patch layer
    // (ADR-0008): the runtime row reads it and forwards it to the Next child.
    writeAuthPatch(profileDir, {
      user: AUTH_USER,
      passwordHash: scryptValue(AUTH_PASSWORD),
    });

    // 4. Boot the shared instance on a free port until the URL is announced.
    booted = await phase("booting the scratch profile", () => bootProfile(dshHome));

    // 5. Persist state for the specs and teardown.
    const state: E2EState = {
      scratchDir,
      dshHome,
      profileDir,
      port: booted.port,
      baseURL: booted.baseURL,
      announceLine: booted.announceLine,
      dshPid: booted.dshPid,
      auth: { user: AUTH_USER, password: AUTH_PASSWORD },
    };
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch (error) {
    await booted?.stop();
    rmSync(scratchDir, { recursive: true, force: true });
    throw error;
  }
}

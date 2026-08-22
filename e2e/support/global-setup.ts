import {
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { freePort } from "./port";
import { run } from "./process";
import { STATE_PATH, type E2EState } from "./state";

const REPO_ROOT = resolve(__dirname, "../..");
const PROFILE = "next-app";
const ANNOUNCE_RE = /dsh next-app: (http:\/\/\S+)/;
const ANNOUNCE_TIMEOUT_MS = 120_000;
const PACK_TIMEOUT_MS = 600_000;
const INSTALL_TIMEOUT_MS = 300_000;

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

interface Booted {
  announceLine: string;
  dshPid: number;
  stdoutPath: string;
  stderrPath: string;
  kill: () => void;
}

/** Boot the profile and resolve once the serving URL is announced on stdout. */
function bootProfile(
  dshHome: string,
  port: number,
  baseURL: string,
  logsDir: string,
): Promise<Booted> {
  return new Promise((resolve, reject) => {
    const child = spawn("dsh", ["--profile", PROFILE, "--port", String(port)], {
      cwd: REPO_ROOT,
      env: { ...process.env, DSH_HOME: dshHome },
      stdio: ["ignore", "pipe", "pipe"],
      // Own process group: teardown kills dsh and the Next child together.
      detached: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    // Tee the dsh process's streams into the scratch dir: the supervision
    // specs assert the row's stderr log (the restart line) against these
    // files, and the announce parse below keeps its own in-memory capture.
    const stdoutPath = join(logsDir, "dsh.stdout.log");
    const stderrPath = join(logsDir, "dsh.stderr.log");
    child.stdout.pipe(createWriteStream(stdoutPath));
    child.stderr.pipe(createWriteStream(stderrPath));

    const kill = (): void => {
      try {
        process.kill(-(child.pid ?? 0), "SIGTERM");
      } catch {
        // already gone
      }
    };

    const timer = setTimeout(() => {
      kill();
      reject(
        new Error(
          `dsh did not announce the serving URL within ${ANNOUNCE_TIMEOUT_MS}ms\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        ),
      );
    }, ANNOUNCE_TIMEOUT_MS);
    const poll = setInterval(() => {
      const match = ANNOUNCE_RE.exec(stdout);
      if (match === null) return;
      clearInterval(poll);
      clearTimeout(timer);
      const announcedURL = match[1];
      const announceLine = match[0];
      if (announcedURL === undefined || announceLine === undefined) {
        kill();
        reject(new Error("the announce regex matched without groups"));
        return;
      }
      if (announcedURL !== baseURL) {
        kill();
        reject(new Error(`dsh announced ${announcedURL} but the suite expects ${baseURL}`));
        return;
      }
      resolve({ announceLine, dshPid: child.pid ?? -1, stdoutPath, stderrPath, kill });
    }, 200);
    child.on("error", (error) => {
      clearInterval(poll);
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      if (code !== null) {
        clearInterval(poll);
        clearTimeout(timer);
        reject(
          new Error(
            `dsh exited (code ${code}) before announcing\nstdout:\n${stdout}\nstderr:\n${stderr}`,
          ),
        );
      }
    });
    child.on("close", () => clearInterval(poll));
  });
}

/**
 * Pack the bundle, install it into a scratch profile, boot it, and persist the
 * runtime state for the specs. The suite tests the packed tarball - the
 * artifact users install - never the repo tree (ADR-0006).
 */
export default async function globalSetup(): Promise<void> {
  const scratchDir = mkdtempSync(join(tmpdir(), "dsh-next-app-e2e-"));
  let booted: Booted | undefined;
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

    // 3. Boot on a free port until the URL is announced.
    const port = await freePort();
    const baseURL = `http://127.0.0.1:${port}`;
    booted = await phase("booting the scratch profile", () =>
      bootProfile(dshHome, port, baseURL, scratchDir),
    );

    // 4. Persist state for the specs and teardown.
    const state: E2EState = {
      scratchDir,
      dshHome,
      profileDir,
      port,
      baseURL,
      announceLine: booted.announceLine,
      dshPid: booted.dshPid,
      dshStdoutPath: booted.stdoutPath,
      dshStderrPath: booted.stderrPath,
    };
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch (error) {
    booted?.kill();
    rmSync(scratchDir, { recursive: true, force: true });
    throw error;
  }
}

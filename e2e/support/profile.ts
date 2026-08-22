import { createWriteStream, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { freePort } from "./port";
import { sleep } from "./process";
import { pidAlive } from "./process-tree";

const REPO_ROOT = resolve(__dirname, "../..");
const PROFILE = "next-app";
const ANNOUNCE_RE = /dsh next-app: (http:\/\/\S+)/;
const ANNOUNCE_TIMEOUT_MS = 120_000;
const STOP_WAIT_MS = 15_000;

/** A booted dsh profile instance the suite can assert against and stop. */
export interface BootedProfile {
  /** The dsh process id; it leads its own process group. */
  dshPid: number;
  /** The free port the instance was booted on. */
  port: number;
  /** The URL the instance serves. */
  baseURL: string;
  /** The exact announce line the instance printed on stdout. */
  announceLine: string;
  /** Teed dsh stdout file; present only when the boot was given a logsDir. */
  stdoutPath?: string;
  /** Teed dsh stderr file; present only when the boot was given a logsDir. */
  stderrPath?: string;
  /** Stop the instance: SIGTERM, wait for exit, SIGKILL. Idempotent. */
  stop(): Promise<void>;
}

/**
 * SIGTERM a dsh process (its own group), wait for it to exit, then SIGKILL
 * the group. The row terminates the Next child's tree during dsh's graceful
 * shutdown, so the whole instance goes down with the signal. Idempotent.
 */
export async function stopProfile(dshPid: number): Promise<void> {
  try {
    process.kill(-dshPid, "SIGTERM");
  } catch {
    return; // the instance is already gone
  }
  const deadline = Date.now() + STOP_WAIT_MS;
  while (Date.now() < deadline && pidAlive(dshPid)) {
    await sleep(200);
  }
  try {
    process.kill(-dshPid, "SIGKILL");
  } catch {
    // already gone
  }
}

/**
 * Boot one profile instance on a free port and resolve once the serving URL
 * is announced on stdout. With a logsDir the instance's stdout/stderr are
 * teed into it for the specs to assert (the supervision specs use the stderr
 * log). Kills the instance on any boot failure.
 */
export async function bootProfile(dshHome: string, logsDir?: string): Promise<BootedProfile> {
  const port = await freePort();
  return new Promise((resolve, reject) => {
    const child = spawn("dsh", ["--profile", PROFILE, "--port", String(port)], {
      cwd: REPO_ROOT,
      env: { ...process.env, DSH_HOME: dshHome },
      stdio: ["ignore", "pipe", "pipe"],
      // Own process group: stopping the instance kills dsh and its children.
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

    const stdoutPath = logsDir === undefined ? undefined : join(logsDir, "dsh.stdout.log");
    const stderrPath = logsDir === undefined ? undefined : join(logsDir, "dsh.stderr.log");
    if (stdoutPath !== undefined && stderrPath !== undefined) {
      mkdirSync(logsDir as string, { recursive: true });
      child.stdout.pipe(createWriteStream(stdoutPath));
      child.stderr.pipe(createWriteStream(stderrPath));
    }

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
          `dsh did not announce the serving URL within ${ANNOUNCE_TIMEOUT_MS}ms
stdout:
${stdout}
stderr:
${stderr}`,
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
      const baseURL = `http://127.0.0.1:${port}`;
      if (announcedURL !== baseURL) {
        kill();
        reject(new Error(`dsh announced ${announcedURL} but the suite expects ${baseURL}`));
        return;
      }
      const dshPid = child.pid ?? -1;
      resolve({
        dshPid,
        port,
        baseURL,
        announceLine,
        ...(stdoutPath !== undefined && { stdoutPath }),
        ...(stderrPath !== undefined && { stderrPath }),
        stop: () => stopProfile(dshPid),
      });
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
            `dsh exited (code ${code}) before announcing
stdout:
${stdout}
stderr:
${stderr}`,
          ),
        );
      }
    });
    child.on("close", () => clearInterval(poll));
  });
}

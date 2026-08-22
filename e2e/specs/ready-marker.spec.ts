import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { test, expect } from "@playwright/test";
import { freePort } from "../support/port";
import { sleep } from "../support/process";
import { readState } from "../support/state";

const REPO_ROOT = resolve(__dirname, "../..");
const RUNTIME_SRC = join(REPO_ROOT, "packages/dsh-next-app/src/runtime.ts");
const READY_MARKER_RE = /const READY_MARKER = "([^"]+)"/;
const READY_LINE_TIMEOUT_MS = 60_000;

/**
 * Pins the row's ready marker (runtime.ts REGRESSION NOTE): the Next child's
 * stdout must contain the exact marker the row waits for, so a Next catalog
 * bump that changes the output fails loudly instead of silently never
 * announcing the URL.
 */
test("the Next child's ready line matches the row's READY_MARKER", async () => {
  const state = readState();
  const source = readFileSync(RUNTIME_SRC, "utf8");
  const match = READY_MARKER_RE.exec(source);
  const marker = match?.[1];
  if (marker === undefined) {
    throw new Error("READY_MARKER constant not found in packages/dsh-next-app/src/runtime.ts");
  }

  // Mirror the row's spawn (runtime.ts): next start from the packed web/ dir.
  const profileNodeModules = join(state.profileDir, "node_modules");
  const webDir = join(profileNodeModules, "@scope/dsh-next-app/web");
  const nextBin = join(profileNodeModules, "next/dist/bin/next");
  const port = await freePort();

  const child = spawn(
    process.execPath,
    [nextBin, "start", "--hostname", "127.0.0.1", "--port", String(port)],
    { cwd: webDir, stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.resume();

  try {
    const deadline = Date.now() + READY_LINE_TIMEOUT_MS;
    while (Date.now() < deadline && child.exitCode === null && !stdout.includes(marker)) {
      await sleep(200);
    }
    expect(child.exitCode, "next start exited before the ready line").toBeNull();
    expect(
      stdout,
      "the Next child's ready line must contain the row's READY_MARKER (runtime.ts) so a catalog bump that changes the output fails loudly",
    ).toContain(marker);
  } finally {
    child.kill("SIGTERM");
    await new Promise((settle) => {
      child.once("exit", settle);
      setTimeout(settle, 5_000);
    });
  }
});

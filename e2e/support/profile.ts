import { randomBytes, scryptSync } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { basename, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { freePort } from "./port";
import { sleep } from "./process";
import { pidAlive } from "./process-tree";

const REPO_ROOT = resolve(__dirname, "../..");
const PROFILE = "next-app";

/** Default scrypt cost parameters; the fence reads them from the value itself (ADR-0007). */
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

/** Build one self-describing scrypt value (`scrypt$N,r,p$salt$key`, ADR-0007). */
export function scryptValue(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 32, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return (
    "scrypt$" +
    SCRYPT_N +
    "," +
    SCRYPT_R +
    "," +
    SCRYPT_P +
    "$" +
    salt.toString("base64") +
    "$" +
    key.toString("base64")
  );
}
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
  /** The instance's profile directory (dshHome/profiles/next-app). */
  profileDir: string;
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

/** The runtime-row config shape the suite writes into the profile's patch (ADR-0008, ADR-0009). */
export interface ProfileRuntimeConfig {
  user?: string;
  passwordHash?: string;
  realm?: string;
  host?: string;
  port?: number;
}

/**
 * Write the profile's user patch layer: an id-targeted config override for
 * the next-app-runtime row (serving host/port per ADR-0009, auth per
 * ADR-0008). Boot the profile after writing; a running instance hot-reloads
 * its config, so specs that swap the patch restore it before they finish.
 */
export function writeRuntimePatch(profileDir: string, config?: ProfileRuntimeConfig): void {
  const lines: string[] = [
    "# The e2e suite's config for the next-app-runtime row (ADR-0008, ADR-0009).",
    "# Rewritten per spec; boot the profile after writing for changes to apply.",
    "- id: next-app-runtime",
    "  config:",
  ];
  if (config === undefined) {
    lines.push("    {}");
  } else {
    if (config.host !== undefined) lines.push("    host: " + config.host);
    if (config.port !== undefined) lines.push("    port: " + config.port);
    if (
      config.user !== undefined ||
      config.passwordHash !== undefined ||
      config.realm !== undefined
    ) {
      lines.push("    auth:");
      if (config.user !== undefined) lines.push("      user: " + config.user);
      if (config.passwordHash !== undefined) {
        lines.push("      passwordHash: " + config.passwordHash);
      }
      if (config.realm !== undefined) lines.push("      realm: " + config.realm);
    }
  }
  lines.push("");
  writeFileSync(join(profileDir, "cordis.patch.yml"), lines.join("\n"));
}

/**
 * One entry per crossing the boot must hold on a single module instance: the
 * package that owns an identity-bearing key, and the row package that meets it
 * there. `TOOL_RUNTIME_SCHEDULER` is a `Symbol()` - not `Symbol.for` - so the
 * copy that writes the slot and the copy that reads it must be one copy; held
 * apart, the read is `undefined` and every tool call dies with "Cannot read
 * properties of undefined (reading 'prepare')" (#138).
 *
 * The criterion is a key's **registration**, not the presence of a symbol: a
 * module-scoped `Symbol()` forks into one key per copy, while `Symbol.for()`
 * resolves through the global registry and stays one key however many copies
 * exist. ADR-0012 carries the audit of which host packages fork; this list is
 * where a newly discovered crossing gets recorded, with both of its halves.
 */
const IDENTITY_BEARING_CROSSINGS = [
  { key: "@deepseek-ai/dsh-tools", reader: "@deepseek-ai/dsh-agent-loop" },
] as const;

/**
 * Packages allowed to appear more than once, because their cross-package keys
 * are registered symbols (`Symbol.for`) and their state handoffs go through
 * `globalThis` - two copies still agree on every key, so a duplicate costs
 * bytes, not behaviour. This is the second case of the criterion above, and
 * schemastery is its worked example.
 *
 * Counts and versions are deliberately not repeated here: the census below
 * recomputes them at run time, `pnpm-lock.yaml` shows which versions resolved,
 * and ADR-0012 records the measurement behind the allowance.
 *
 * A package joins this list on evidence that its keys are registered - never
 * because a duplicate is merely inconvenient. If one starts keying a
 * cross-package slot with a module-scoped `Symbol()`, it moves to
 * IDENTITY_BEARING_CROSSINGS with the package it crosses to (ADR-0012).
 */
const KNOWN_INERT_DUPLICATES = ["@deepseek-ai/schemastery"] as const;

/**
 * Assert that an installed profile composes the host graph the way tool
 * execution needs it (ADR-0012), at the boundary that rule actually has.
 *
 * Two checks, because the failure and the fear are different:
 *
 * 1. **Every identity-bearing crossing resolves to one instance.** Both halves
 *    of each entry have to be *in* the profile - a half that resolves from the
 *    dsh installation is a second instance even when the profile holds one,
 *    which is how #138 happened - and the owning package must resolve to the
 *    same realpath from the profile root and from inside its counterpart.
 *    Node's module cache keys on realpath and a `Symbol()`'s identity follows
 *    the instance, so this states the invariant rather than a proxy for it.
 * 2. **No unexpected duplicates, inside the host scope.** The walk
 *    (`hostPackageCopies`) fails on any multi-copy package outside the
 *    measured-inert set, and it records only names under an `@deepseek-ai`
 *    directory - deliberately, since that is the scope where the boot-healed
 *    fallback tier can substitute the installation's copy for the profile's, and
 *    the realpath comparison in check 1 is what asks a resolver's question.
 *    Duplicates elsewhere are per-package vendoring, a dependency compiled into
 *    another package's own build, where no specifier can resolve the two halves
 *    of a crossing apart: the wider {@link profileGraphCensus} counts far more
 *    names outside this scope than inside it, and ADR-0012 carries the figures.
 *    Failing on those would train readers to skim this guard, and skimming is how
 *    the next hoist drift gets found the way #138 was: as a broken tool call
 *    three layers away.
 *
 * Deliberately NOT asserted: one copy of every row package. The shipped graph
 * does not hold that, does not need to, and ADR-0012 records why.
 *
 * @param profileDir The installed profile directory (holds `node_modules`).
 */
export function assertSharedToolRuntimeGraph(profileDir: string): void {
  const modules = join(profileDir, "node_modules");
  for (const { key, reader } of IDENTITY_BEARING_CROSSINGS) {
    for (const pkg of [key, reader] as const) {
      if (!existsSync(join(modules, pkg))) {
        throw new Error(
          `${pkg} is missing from the installed profile (${modules}). A row package the profile ` +
            `does not carry still resolves - dsh heals the installation's graph into ` +
            "`$DSH_HOME/profiles/node_modules` at boot - so this half would silently load a " +
            `*second* copy of ${key} and fork the crossing (#138). The bundle must depend on ` +
            "it, not merely peer it.",
        );
      }
    }
    const forOwner = resolveFrom(profileDir, key);
    const forReader = resolveFrom(join(modules, reader), key);
    if (forOwner !== forReader) {
      throw new Error(
        `the boot holds two ${key} instances: the profile's rows resolve it to ${forOwner} ` +
          `while ${reader} resolves it to ${forReader}. ${key} keys a slot that ${reader} ` +
          `reads back through a module-scoped Symbol, so the write and the read never meet ` +
          `and every tool call fails (#138)`,
      );
    }
  }
  const inert = KNOWN_INERT_DUPLICATES as readonly string[];
  const unexpected = [...hostPackageCopies(profileDir).entries()]
    .filter(([name, copies]) => copies.size > 1 && !inert.includes(name))
    .map(
      ([name, copies]) => `${name} in ${copies.size} copies:\n    ${[...copies].join("\n    ")}`,
    );
  if (unexpected.length > 0) {
    throw new Error(
      `the profile holds multiple instances of ${unexpected.length} @deepseek-ai package(s) ` +
        `outside the measured-inert set:\n  ${unexpected.join("\n  ")}\n` +
        `Classify each one by its keys, not by convenience: registered (` +
        `Symbol.for) or nothing crossing the package boundary at all - then add it to ` +
        `KNOWN_INERT_DUPLICATES; a module-scoped ` +
        `Symbol() that another package reads back - then add both halves to ` +
        `IDENTITY_BEARING_CROSSINGS and make the bundle carry them (ADR-0012).`,
    );
  }
}

/** One package name that resolves to more than one physical copy. */
export interface ProfileGraphDuplicate {
  name: string;
  copies: number;
  /** Some copy sits in another package's build output (a vendored bundle). */
  vendored: boolean;
  /** Every copy sits in a build output: vendor against vendor. */
  vendorOnly: boolean;
}

/** What {@link profileGraphCensus} counted over an installed profile tree. */
export interface ProfileGraphCensus {
  /** Distinct package names found anywhere in the tree. */
  names: number;
  /** Names resolving to more than one physical copy, with their classification. */
  duplicates: ProfileGraphDuplicate[];
  /** Distinct package names inside the host scope. */
  hostNames: number;
}

/** Whether a package copy sits inside another package's compiled build output. */
function isVendoredCopy(dir: string): boolean {
  return dir.includes("/dist/compiled/");
}

/**
 * The census behind ADR-0012's scope argument: every package root in the
 * installed profile tree, whatever scope it belongs to.
 *
 * It differs from {@link hostPackageCopies} in what each one **records**, not in
 * how far it travels - both walk the whole tree. This one takes the `name` from
 * every `package.json` it reaches, because the record reasons about the installed
 * graph as a whole, and much of that graph's duplication lives in dependencies
 * compiled into another package's build output (`next/dist/compiled/zod`), where
 * no bare specifier can land. The assertion's walk notes only packages under an
 * `@deepseek-ai` directory, because the fallback tier substitutes the
 * installation's copy only for names in that scope, so anything else it recorded
 * would be noise. Counts for both are printed by {@link
 * describeProfileGraphCensus} - via the paired
 * {@link assertAndReportHostGraph} - at each of the suite's installs - and
 * carried as dated evidence in ADR-0012; this file states the criterion, never
 * the numbers.
 */
export function profileGraphCensus(profileDir: string): ProfileGraphCensus {
  const byName = new Map<string, Set<string>>();
  const queue = [join(profileDir, "node_modules")];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const dir = queue.shift() as string;
    let real: string;
    try {
      real = realpathSync(dir);
    } catch {
      continue;
    }
    if (visited.has(real)) continue;
    visited.add(real);
    const manifest = join(dir, "package.json");
    if (existsSync(manifest)) {
      try {
        const name = (JSON.parse(readFileSync(manifest, "utf8")) as { name?: string }).name;
        if (name !== undefined) {
          const at = byName.get(name);
          if (at === undefined) byName.set(name, new Set([real]));
          else at.add(real);
        }
      } catch {
        // a malformed manifest is not a package root; keep walking
      }
    }
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory() || entry.isSymbolicLink()) queue.push(join(dir, entry.name));
    }
  }
  const duplicates: ProfileGraphCensus["duplicates"] = [];
  let hostNames = 0;
  for (const [name, dirs] of byName) {
    if (name.startsWith("@deepseek-ai/")) hostNames += 1;
    if (dirs.size < 2) continue;
    const copies = [...dirs];
    duplicates.push({
      name,
      copies: dirs.size,
      vendored: copies.some(isVendoredCopy),
      vendorOnly: copies.every(isVendoredCopy),
    });
  }
  duplicates.sort((a, b) => b.copies - a.copies || a.name.localeCompare(b.name));
  return { names: byName.size, duplicates, hostNames };
}

/** One line describing the census, for the install phase log. */
export function describeProfileGraphCensus(profileDir: string): string {
  // The cost prints with the figures it belongs to: ADR-0012 quotes a duration,
  // and a duration the line does not report is a number with no producer - which
  // is how its "about 0.1 s" went stale the moment this line gained a second
  // walk. `hostPackageCopies` is timed separately because the guard runs it
  // again moments later; the record's claim covers the line, not the suite.
  const start = process.hrtime.bigint();
  const census = profileGraphCensus(profileDir);
  const mid = process.hrtime.bigint();
  const asserted = hostPackageCopies(profileDir).size;
  const end = process.hrtime.bigint();
  const outside = census.duplicates.filter((d) => !d.name.startsWith("@deepseek-ai/"));
  const vendored = outside.filter((d) => d.vendored);
  const vendorOnly = outside.filter((d) => d.vendorOnly);
  const elapsed = (from: bigint, to: bigint): string => `${Math.round(Number(to - from) / 1e6)}ms`;
  return (
    `profile graph: ${census.names} names whole-tree, ${census.hostNames} in @deepseek-ai ` +
    `(${asserted} from the assertion's host-scoped walk), ${outside.length} duplicated outside ` +
    `that scope, ${vendored.length} of those vendored (next/dist/compiled), ` +
    `${vendorOnly.length} vendor-against-vendor, census ${elapsed(start, mid)} ` +
    `+ host walk ${elapsed(mid, end)}`
  );
}

/**
 * Guard an installed profile's host graph and report it, as one step.
 *
 * The pairing is the point: ADR-0012 says these figures are counted at each of
 * the suite's installs, and the only way that stays true is if the assertion and
 * the report cannot be called apart. They had already drifted - the guard ran at
 * all four installs, the report at one - which is finding #13.
 *
 * @param label Prefix identifying which install this is, for the run log.
 * @param profileDir The installed profile directory (holds `node_modules`).
 */
export function assertAndReportHostGraph(label: string, profileDir: string): void {
  assertSharedToolRuntimeGraph(profileDir);
  console.log(`${label}: ${describeProfileGraphCensus(profileDir)}`);
}

/**
 * Every realpath-distinct copy of each `@deepseek-ai/*` package inside a
 * profile, as the assertion sees it.
 *
 * Exported so the record's host-scope figure has a producer: it can only ever
 * name packages under an `@deepseek-ai` directory, which is exactly the fact an
 * earlier draft of ADR-0012 lost track of and invented "218" for.
 */
export function hostPackageCopies(profileDir: string): Map<string, Set<string>> {
  const copies = new Map<string, Set<string>>();
  const add = (packageName: string, dir: string): void => {
    let real: string;
    try {
      real = realpathSync(dir);
    } catch {
      return; // a broken link holds no instance
    }
    const at = copies.get(packageName);
    if (at === undefined) copies.set(packageName, new Set([real]));
    else at.add(real);
  };
  const isScope = (dir: string): boolean => basename(dir) === "@deepseek-ai";
  const queue = [join(profileDir, "node_modules")];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const modules = queue.shift() as string;
    let real: string;
    try {
      real = realpathSync(modules);
    } catch {
      continue; // no node_modules here
    }
    if (visited.has(real)) continue;
    visited.add(real);
    let entries;
    try {
      entries = readdirSync(modules, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(modules, entry.name);
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      if (isScope(full)) {
        // Scoped: each child is a package, and each package nests its own
        // conflicts - the descent below is where duplicates actually hide.
        for (const pkg of readdirSync(full, { withFileTypes: true })) {
          add(`@deepseek-ai/${pkg.name}`, join(full, pkg.name));
          queue.push(join(full, pkg.name, "node_modules"));
        }
        continue;
      }
      if (entry.name === ".pnpm") {
        // An isolated layout parks each resolved copy here; realpath dedupe
        // collapses the symlinks, so only a genuinely second instance counts.
        for (const storeEntry of readdirSync(full, { withFileTypes: true })) {
          queue.push(join(full, storeEntry.name, "node_modules"));
        }
        continue;
      }
      queue.push(full, join(full, "node_modules"));
    }
  }
  return copies;
}

/** The realpath one directory resolves a package to, without loading it. */
function resolveFrom(fromDir: string, packageName: string): string {
  // Node resolves a bare specifier from the requiring module's own location,
  // so the probe path below only fixes the start of the walk; nothing is
  // executed, which keeps the check free of the package's own imports.
  const probe = join(fromDir, "dsh-graph-probe.cjs");
  try {
    return realpathSync(createRequire(probe).resolve(packageName));
  } catch (error) {
    return `unresolved (${(error as Error).message})`;
  }
}

/**
 * Boot one profile instance on a free port and resolve once the serving URL
 * is announced on stdout. With a logsDir the instance's stdout/stderr are
 * teed into it for the specs to assert (the supervision specs use the stderr
 * log). Kills the instance on any boot failure.
 */
/** Boot options (ADR-0009): the expected port and whether --port is passed. */
export interface BootOptions {
  /** The expected serving port (defaults to a free port). */
  port?: number;
  /** Pass --port <port> on the command line; false lets the row config port serve. */
  passPortFlag?: boolean;
}

export async function bootProfile(
  dshHome: string,
  logsDir?: string,
  options?: BootOptions,
): Promise<BootedProfile> {
  const port = options?.port ?? (await freePort());
  const argv = [
    "--profile",
    PROFILE,
    ...(options?.passPortFlag === false ? [] : ["--port", String(port)]),
  ];
  return new Promise((resolve, reject) => {
    const child = spawn("dsh", argv, {
      cwd: REPO_ROOT,
      // DSH_PERMISSION_MODE is pinned CONFINED on purpose (task #135
      // commit 2): the bundle patch derives the approval policy from it
      // ('never' under danger-full-access), and the launching shell's own
      // mode must not silently disable the suite's approval scenarios.
      // An unset mode defaults the same way; the pin keeps the suite
      // hermetic against a fully-open launcher environment.
      env: { ...process.env, DSH_HOME: dshHome, DSH_PERMISSION_MODE: "workspace-write" },
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
        profileDir: join(dshHome, "profiles", PROFILE),
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

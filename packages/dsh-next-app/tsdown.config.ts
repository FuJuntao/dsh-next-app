/**
 * tsdown config for the dsh-next-app bundle glue (ADR-0002).
 *
 * Bundles the two row entries (cli, runtime) to ESM + d.ts in lib/, and
 * folds the pack-time staging of the app build into the bundler: the
 * stage-web-build plugin copies apps/web's production build (.next
 * without its rebuild cache, package.json, next.config.ts) into web/,
 * the bundle-internal location the runtime row spawns next start from.
 *
 * App dependencies resolve at profile runtime from two places: the deps
 * the bundle itself carries (next, react, react-dom - deduped by the
 * profile install) and the additional app deps staged into web/node_modules
 * by stageAppDependencies (a throwaway prod-only pnpm install of the
 * delta between apps/web and the bundle manifests, copied into web/).
 * apps/web/package.json is the single source of truth for app deps; the
 * bundle manifest only lists what the glue imports (commander, next) plus
 * the shared app runtime (react, react-dom).
 * Dependencies and peerDependencies stay external - the @deepseek-ai
 * host packages resolve from the dsh installation at runtime, never
 * from the bundle.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { defineConfig } from "tsdown";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "../../apps/web");
const webDir = resolve(here, "web");

const run = promisify(execFile);

/** The manifest fields the staging step reads. */
interface PackageManifest {
  dependencies?: Record<string, string>;
  version?: string;
}

/** Read a JSON manifest; undefined when absent or unreadable. */
async function readJson(path: string): Promise<PackageManifest | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as PackageManifest;
  } catch {
    return undefined;
  }
}

/**
 * Stage the app dependencies the bundle does not already carry into
 * web/node_modules: the delta between apps/web and bundle dependencies,
 * installed prod-only (exact versions read from the workspace install)
 * into a throwaway directory whose node_modules is copied into web/.
 * next/react/react-dom live in the bundle itself, so the staged delta is
 * small (radix + its transitive closure) and the tarball stays lean.
 */
async function stageAppDependencies(): Promise<void> {
  const appManifest = await readJson(join(appDir, "package.json"));
  const bundleManifest = await readJson(join(here, "package.json"));
  const appDeps = appManifest?.dependencies ?? {};
  const bundleDeps = bundleManifest?.dependencies ?? {};
  const delta = Object.keys(appDeps).filter((name) => !(name in bundleDeps));
  if (delta.length === 0) return;

  // Direct dependencies are symlinked into apps/web/node_modules by pnpm;
  // read the resolved version from the linked package.
  const versions: Record<string, string> = {};
  for (const name of delta) {
    const resolved = await readJson(join(appDir, "node_modules", name, "package.json"));
    if (resolved?.version === undefined) {
      throw new Error(`stage-app-dependencies: cannot resolve the installed version of ${name}`);
    }
    versions[name] = resolved.version;
  }

  const staging = await mkdtemp(join(tmpdir(), "dsh-next-app-web-deps-"));
  try {
    await writeFile(
      join(staging, "package.json"),
      JSON.stringify({
        name: "dsh-next-app-web-deps",
        private: true,
        version: "0.0.0",
        dependencies: versions,
      }),
    );
    try {
      await run("pnpm", ["install", "--prod", "--ignore-scripts", "--lockfile=false"], {
        cwd: staging,
        maxBuffer: 16 * 1024 * 1024,
      });
    } catch (error) {
      const detail = error as { stdout?: string; stderr?: string };
      throw new Error(
        "stage-app-dependencies: pnpm install failed: " +
          JSON.stringify({
            stdout: detail.stdout,
            stderr: detail.stderr,
            message: String(error),
          }),
      );
    }
    await cp(join(staging, "node_modules"), join(webDir, "node_modules"), {
      recursive: true,
    });
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/** The packed app build: .next + package.json + next.config.ts (no rebuild cache). */
const stageWebBuild = () => ({
  name: "stage-web-build",
  async writeBundle() {
    const nextDir = join(appDir, ".next");
    if (!existsSync(join(nextDir, "BUILD_ID"))) {
      throw new Error(
        `stage-web-build: no production build at ${nextDir} - run "pnpm --filter web run build" first`,
      );
    }
    await rm(webDir, { recursive: true, force: true });
    await cp(nextDir, join(webDir, ".next"), {
      recursive: true,
      filter: (src) => !src.includes(`${sep}.next${sep}cache`),
    });
    await cp(join(appDir, "package.json"), join(webDir, "package.json"));
    await cp(join(appDir, "next.config.ts"), join(webDir, "next.config.ts"));
    await stageAppDependencies();
  },
});

export default defineConfig({
  entry: ["src/cli.ts", "src/runtime.ts"],
  format: ["esm"],
  outExtensions: () => ({ js: ".js", dts: ".d.ts" }),
  dts: true,
  clean: true,
  outDir: "lib",
  plugins: [stageWebBuild()],
});

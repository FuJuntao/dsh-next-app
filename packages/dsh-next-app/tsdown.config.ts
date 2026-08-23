/**
 * tsdown config for the dsh-next-app bundle glue (ADR-0002).
 *
 * Bundles the two row entries (cli, runtime) to ESM + d.ts in lib/, and
 * folds the pack-time staging of the app build into the bundler: the
 * stage-web-build plugin copies apps/web's production build (.next
 * without its rebuild cache, package.json, next.config.ts) into web/,
 * the bundle-internal location the runtime row spawns next start from.
 * App dependencies resolve at profile runtime from the bundle's own
 * manifest (next, react, react-dom, the radix packages) - the profile
 * install provides them like any npm package, so the tarball carries no
 * node_modules. The build guards this: every apps/web runtime dependency
 * must be mirrored in the bundle manifest, or the pack fails loud.
 * Dependencies and peerDependencies stay external - the @deepseek-ai
 * host packages resolve from the dsh installation at runtime, never
 * from the bundle.
 */
import { existsSync } from "node:fs";
import { cp, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "tsdown";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "../../apps/web");
const webDir = resolve(here, "web");

/** The manifest fields the mirror guard reads. */
interface PackageManifest {
  dependencies?: Record<string, string>;
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
 * Guard the app-runtime-dependency mirror: the staged app resolves its
 * runtime deps from the bundle's manifest at profile runtime, so every
 * apps/web runtime dependency must be declared there too - otherwise the
 * app builds and serves in dev but breaks in the packed artifact.
 */
async function assertAppDepsMirrored(): Promise<void> {
  const appManifest = await readJson(join(appDir, "package.json"));
  const bundleManifest = await readJson(join(here, "package.json"));
  const appDeps = appManifest?.dependencies ?? {};
  const bundleDeps = bundleManifest?.dependencies ?? {};
  const missing = Object.keys(appDeps).filter((name) => !(name in bundleDeps));
  if (missing.length > 0) {
    throw new Error(
      "stage-web-build: apps/web runtime dependencies missing from the bundle manifest: " +
        missing.join(", ") +
        " - mirror them in packages/dsh-next-app/package.json dependencies so the packed app resolves them at profile runtime",
    );
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
    await assertAppDepsMirrored();
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

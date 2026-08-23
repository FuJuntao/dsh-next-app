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
 * node_modules.
 * Dependencies and peerDependencies stay external - the @deepseek-ai
 * host packages resolve from the dsh installation at runtime, never
 * from the bundle.
 */
import { existsSync } from "node:fs";
import { cp, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "tsdown";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "../../apps/web");
const webDir = resolve(here, "web");

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

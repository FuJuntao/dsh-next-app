import { defineConfig } from "@playwright/test";

/**
 * The e2e regression suite (ADR-0006). The global setup packs the bundle,
 * installs it into a scratch profile, and boots one shared instance for the
 * boot/ready-marker specs; the supervision specs boot their own dedicated
 * instance on the same installed profile, so their stop test cannot affect
 * other spec files. The run is serial (workers: 1).
 */
export default defineConfig({
  testDir: "./specs",
  globalSetup: "./support/global-setup",
  globalTeardown: "./support/global-teardown",
  workers: 1,
  fullyParallel: false,
  timeout: 180_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});

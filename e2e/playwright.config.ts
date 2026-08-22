import { defineConfig } from "@playwright/test";

/**
 * The e2e regression suite (ADR-0006). The global setup packs the bundle,
 * installs it into a scratch profile, and boots one shared instance behind
 * the basic-auth fence (ADR-0001) for the boot/ready-marker/auth-fence
 * specs; the supervision specs and the fail-closed spec boot their own
 * dedicated instances on the same installed profile, so their stop test
 * cannot affect other spec files. The run is serial (workers: 1).
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

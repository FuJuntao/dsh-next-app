import { defineConfig } from "@playwright/test";

/**
 * The e2e regression suite (ADR-0006). One scratch profile is booted by the
 * global setup and shared by every spec, so the run is serial (workers: 1).
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

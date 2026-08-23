import { test, expect } from "@playwright/test";
import { readState } from "../support/state";

const state = readState();

// The shared instance serves behind the basic-auth fence (ADR-0001); the
// browser answers the 401 challenge with the suite's credential pair.
test.use({ httpCredentials: { username: state.auth.user, password: state.auth.password } });

// The shell's desktop breakpoint (apps/web/components/shell.css): at and
// above 768px the side nav sits in flow; below it, it becomes an overlay
// drawer (story #97).
const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 375, height: 667 };
const NARROW = { width: 320, height: 568 };

test("no horizontal overflow at 320px", async ({ page }) => {
  await page.setViewportSize(NARROW);
  await page.goto(state.baseURL + "/sessions");
  const sizes = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.client);
});

test("side nav becomes an overlay drawer on mobile", async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await page.goto(state.baseURL + "/sessions");
  const nav = page.getByRole("navigation", { name: "Primary" });
  // The drawer starts closed: the nav is off-screen and the header
  // hamburger is the way in.
  await expect(nav).not.toBeInViewport();
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(nav).toBeInViewport();
  await page.getByRole("button", { name: "Close navigation" }).click();
  await expect(nav).not.toBeInViewport();
});

test("side nav folds and unfolds on desktop", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto(state.baseURL + "/sessions");
  const nav = page.getByRole("navigation", { name: "Primary" });
  // The header hamburger only appears once the nav is folded away.
  await expect(nav).toBeInViewport();
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeHidden();
  await page.getByRole("button", { name: "Close navigation" }).click();
  await expect(nav).not.toBeInViewport();
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(nav).toBeInViewport();
  // The folded state persists across reloads (localStorage).
  await page.getByRole("button", { name: "Close navigation" }).click();
  await page.reload();
  await expect(nav).not.toBeInViewport();
});

test("drag handle resizes the side nav and the width persists", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto(state.baseURL + "/sessions");
  const nav = page.getByRole("navigation", { name: "Primary" });
  const before = (await nav.boundingBox())?.width;
  expect(before).toBeGreaterThan(0);
  const handle = page.getByRole("separator", { name: "Resize sidebar" });
  const box = (await handle.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 100, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  const after = (await nav.boundingBox())?.width;
  expect(after).toBeDefined();
  expect(after!).toBeLessThan(before!);
  // The width persists across reloads (localStorage).
  await page.reload();
  const persisted = (await nav.boundingBox())?.width;
  expect(persisted).toBeCloseTo(after!, 0);
});

test("settings dialog opens from the side nav button and closes on Escape", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto(state.baseURL + "/sessions");
  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("/settings deep-links to the open settings dialog", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto(state.baseURL + "/settings");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Settings");
});

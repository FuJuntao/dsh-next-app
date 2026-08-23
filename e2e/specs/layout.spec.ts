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

test("the server renders the stored shell state, so first load cannot flash", async ({
  request,
}) => {
  // The shell state (width + folded) rides a cookie the browser writes on
  // every change, and the server renders it into the first HTML: a reload
  // paints the stored state directly instead of flashing the defaults.
  const auth =
    "Basic " + Buffer.from(`${state.auth.user}:${state.auth.password}`).toString("base64");
  const res = await request.get(state.baseURL + "/sessions", {
    headers: {
      authorization: auth,
      cookie: "dsh-next-app-shell=200|1",
    },
  });
  expect(res.status()).toBe(200);
  const foldedHtml = await res.text();
  // Folded: the nav is collapsed (width 0) and hidden from the first paint.
  expect(foldedHtml).toContain('data-folded="true"');
  expect(foldedHtml).toContain("--sidebar-w:0px");
  // Unfolded: the stored width renders into the first paint.
  const openRes = await request.get(state.baseURL + "/sessions", {
    headers: {
      authorization: auth,
      cookie: "dsh-next-app-shell=200|0",
    },
  });
  const openHtml = await openRes.text();
  expect(openHtml).not.toContain('data-folded="true"');
  expect(openHtml).toContain("--sidebar-w:200px");
});

test("header sits over the content column, not the side nav", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto(state.baseURL + "/sessions");
  const nav = await page.getByRole("navigation", { name: "Primary" }).boundingBox();
  const banner = await page.getByRole("banner").boundingBox();
  expect(nav).not.toBeNull();
  expect(banner).not.toBeNull();
  // The side nav spans the full height...
  expect(nav!.y).toBe(0);
  expect(nav!.height).toBeGreaterThanOrEqual(800);
  // ...and the header starts at the nav's right edge, not the viewport's left.
  expect(banner!.x).toBeGreaterThanOrEqual(nav!.x + nav!.width - 1);
  expect(banner!.y).toBe(0);
});

test("side nav becomes an overlay drawer on mobile", async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await page.goto(state.baseURL + "/sessions");
  const nav = page.getByRole("navigation", { name: "Primary" });
  // The drawer starts closed: the nav is off-screen and the header
  // hamburger (always visible) is the way in.
  await expect(nav).not.toBeInViewport();
  const toggle = page.getByRole("button", { name: "Toggle navigation" });
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(nav).toBeInViewport();
  // The drawer's own close button (inside the nav) closes it again.
  await page.getByRole("button", { name: "Close navigation" }).click();
  await expect(nav).not.toBeInViewport();
});

test("side nav folds and unfolds on desktop", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto(state.baseURL + "/sessions");
  const nav = page.getByRole("navigation", { name: "Primary" });
  // The header toggle is always visible and folds/unfolds the nav.
  const toggle = page.getByRole("button", { name: "Toggle navigation" });
  await expect(nav).toBeInViewport();
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(nav).not.toBeInViewport();
  await toggle.click();
  await expect(nav).toBeInViewport();
  // The folded state persists across reloads (the shell cookie, server-rendered).
  await toggle.click();
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
  // The width persists across reloads (the shell cookie, server-rendered).
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

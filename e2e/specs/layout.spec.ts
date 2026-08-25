import { test, expect } from "@playwright/test";
import { readState } from "../support/state";

const state = readState();

// The shared instance serves behind the basic-auth fence (ADR-0001); the
// browser answers the 401 challenge with the suite's credential pair.
test.use({ httpCredentials: { username: state.auth.user, password: state.auth.password } });

// The shell's desktop breakpoint (apps/web/hooks/use-mobile.ts): at and
// above 768px the side nav sits in flow; below it, it becomes an overlay
// Sheet drawer (story #97). The sidebar's column track is the gap element
// (data-slot="sidebar-gap") and the nav itself the fixed container
// (data-slot="sidebar-container") of the shadcn Sidebar.
const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 375, height: 667 };
const NARROW = { width: 320, height: 568 };

test("a wide stored sidebar width cannot overflow a narrow viewport", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  // A cookie written on a wide screen (or hand-edited) must not overflow the
  // shell on a smaller viewport: the sidebar width is capped by the CSS
  // min()/max() the layout renders against the constraint variables
  // (center column never below the --sidebar-center-min variable).
  await page.context().addCookies([
    {
      name: "dsh-next-app.prefs",
      value: encodeURIComponent(JSON.stringify({ layout: { width: 2000 } })),
      url: state.baseURL,
    },
  ]);
  await page.goto(state.baseURL + "/");
  const sizes = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.client);
});

test("no horizontal overflow at 320px", async ({ page }) => {
  await page.setViewportSize(NARROW);
  await page.goto(state.baseURL + "/");
  const sizes = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.client);
});

test("the server renders the stored shell state, so first load cannot flash", async ({
  request,
}) => {
  // The fold and the width both ride the preferences cookie
  // (dsh-next-app.prefs, URL-encoded JSON); the server reads them in the
  // layout and renders them into the first HTML, so a reload paints the
  // stored state directly instead of flashing the defaults. The shadcn
  // Sidebar renders its open state (data-state) and the shell renders the
  // width cap (--sidebar-width) from the same cookie.
  const auth =
    "Basic " + Buffer.from(state.auth.user + ":" + state.auth.password).toString("base64");
  const prefsCookie = (prefs: unknown): string =>
    "dsh-next-app.prefs=" + encodeURIComponent(JSON.stringify(prefs));
  // The stored width must be above the shell's minimum (216px) - below
  // it the server clamps to the floor, by design.
  const res = await request.get(state.baseURL + "/", {
    headers: {
      authorization: auth,
      cookie: prefsCookie({ layout: { width: 280, folded: true } }),
    },
  });
  expect(res.status()).toBe(200);
  const foldedHtml = await res.text();
  // Folded: the sidebar renders collapsed (off-screen) from the first paint.
  expect(foldedHtml).toContain('data-state="collapsed"');
  expect(foldedHtml).toContain(
    "--sidebar-width:max(min(280px,calc(100vw - var(--sidebar-center-min))),var(--sidebar-min-width))",
  );
  // Unfolded: the stored width renders into the first paint as well.
  const openRes = await request.get(state.baseURL + "/", {
    headers: {
      authorization: auth,
      cookie: prefsCookie({ layout: { width: 280, folded: false } }),
    },
  });
  const openHtml = await openRes.text();
  expect(openHtml).toContain('data-state="expanded"');
  expect(openHtml).toContain(
    "--sidebar-width:max(min(280px,calc(100vw - var(--sidebar-center-min))),var(--sidebar-min-width))",
  );
});

test("without a width preference the shell falls back to the component's CSS default", async ({
  request,
}) => {
  // No preferences cookie: the layout sets no --sidebar-width at all, so
  // the shadcn Sidebar's own CSS default (16rem) styles the shell and the
  // fold defaults to open - the constraint variables stay untouched.
  const auth =
    "Basic " + Buffer.from(state.auth.user + ":" + state.auth.password).toString("base64");
  const res = await request.get(state.baseURL + "/", {
    headers: { authorization: auth },
  });
  expect(res.status()).toBe(200);
  const html = await res.text();
  expect(html).toContain("--sidebar-width:16rem");
  expect(html).not.toContain("--sidebar-width:max(min(");
});

test("header sits over the content column, not the side nav", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto(state.baseURL + "/");
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
  await page.goto(state.baseURL + "/");
  const nav = page.getByRole("navigation", { name: "Primary" });
  // The drawer starts closed: the nav is not rendered and the header
  // hamburger (always visible) is the way in.
  await expect(nav).not.toBeInViewport();
  const toggle = page.getByRole("button", { name: "Toggle navigation" });
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(nav).toBeInViewport();
  // The drawer's own close button (the app's, in the drawer header)
  // closes it again.
  await page.getByRole("button", { name: "Close navigation" }).click();
  await expect(nav).not.toBeInViewport();
});

test("side nav folds and unfolds on desktop", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto(state.baseURL + "/");
  const nav = page.getByRole("navigation", { name: "Primary" });
  // The header toggle is always visible and folds/unfolds the nav.
  const toggle = page.getByRole("button", { name: "Toggle navigation" });
  await expect(nav).toBeInViewport();
  await expect(toggle).toBeVisible();
  // The toggle is animated: the nav container slides (left) and the shell's
  // column track (the sidebar gap) resizes (width); both carry transitions
  // (disabled while dragging and under prefers-reduced-motion).
  expect(
    await page
      .locator('[data-slot="sidebar-container"]')
      .evaluate((el) => getComputedStyle(el).transitionProperty),
  ).toContain("left");
  expect(
    await page
      .locator('[data-slot="sidebar-gap"]')
      .evaluate((el) => getComputedStyle(el).transitionProperty),
  ).toContain("width");
  await toggle.click();
  await expect(nav).not.toBeInViewport();
  await toggle.click();
  await expect(nav).toBeInViewport();
  // The folded state persists across reloads (the preferences cookie,
  // server-rendered).
  await toggle.click();
  await page.reload();
  await expect(nav).not.toBeInViewport();
});

test("drag handle resizes the side nav and the width persists", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto(state.baseURL + "/");
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
  // The width persists across reloads (the preferences cookie, server-rendered).
  await page.reload();
  const persisted = (await nav.boundingBox())?.width;
  expect(persisted).toBeCloseTo(after!, 0);
});

test("the side nav settings link navigates to the settings page", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto(state.baseURL + "/");
  // Settings is its own route: the labeled footer menu link navigates, and
  // the page replaces the placeholder - no modal floating over anything.
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Settings");
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("/settings renders the settings page, not a modal", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto(state.baseURL + "/settings");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Settings");
  await expect(
    page.getByText("Placeholder: settings content lands with the settings story."),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toBeHidden();
});
test("the side nav brand links to the home page", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto(state.baseURL + "/sessions/1");
  const brand = page.getByRole("link", { name: "DeepSeek Harness" });
  await expect(brand).toBeVisible();
  await brand.click();
  await expect(page).toHaveURL(state.baseURL + "/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Home");
});

test("the side nav lists the sessions and highlights the current one", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto(state.baseURL + "/");
  const nav = page.getByRole("navigation", { name: "Primary" });
  for (const title of ["Session 1", "Session 2", "Session 3"]) {
    await expect(nav.getByRole("link", { name: title })).toBeVisible();
  }
  // No session is selected on the home page...
  await expect(nav.getByRole("link", { name: "Session 1" })).not.toHaveAttribute(
    "data-active",
    /.*/,
  );
  // ...and the current session is highlighted on its detail page.
  await page.goto(state.baseURL + "/sessions/2");
  await expect(nav.getByRole("link", { name: "Session 2" })).toHaveAttribute("data-active", /.*/);
  await expect(nav.getByRole("link", { name: "Session 1" })).not.toHaveAttribute(
    "data-active",
    /.*/,
  );
  // Clicking a row navigates to its detail page.
  await nav.getByRole("link", { name: "Session 3" }).click();
  await expect(page).toHaveURL(/\/sessions\/3$/);
});

test("the mobile drawer shows the brand and the sessions list", async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await page.goto(state.baseURL + "/");
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  const nav = page.getByRole("navigation", { name: "Primary" });
  await expect(nav.getByRole("link", { name: "DeepSeek Harness" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Session 1" })).toBeVisible();
  // Navigating from the drawer closes it.
  await nav.getByRole("link", { name: "Session 1" }).click();
  await expect(page).toHaveURL(/\/sessions\/1$/);
  await expect(nav).not.toBeInViewport();
});

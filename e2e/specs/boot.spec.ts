import { test, expect } from "@playwright/test";
import { readState } from "../support/state";

const state = readState();

// The shared instance serves behind the basic-auth fence: the browser
// answers the 401 challenge with the suite's test credential pair
// (ADR-0001), then the page loads.
test.use({ httpCredentials: { username: state.auth.user, password: state.auth.password } });

test("serves the app shell and placeholder routes in a real browser", async ({ page }) => {
  // The fence specs' patch swaps hot-reload the shared instance's config
  // (ADR-0008), restarting its child with backoff; tolerate a restart window
  // like the supervision crash spec does.
  await expect(async () => {
    // / renders the home page: the shell and the home placeholder (story
    // #104: side nav brand and sessions list - the /sessions route is gone,
    // the list lives in the side nav).
    await page.goto(state.baseURL, { timeout: 5_000 });
    await expect(page).toHaveURL(state.baseURL + "/");
    await expect(page).toHaveTitle("Home");
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Home");
    await expect(page.getByRole("main")).toBeVisible();
  }).toPass({ timeout: 90_000 });
});

test("the dsh process announces the serving URL on stdout", () => {
  expect(state.announceLine).toBe(`dsh next-app: ${state.baseURL}`);
});

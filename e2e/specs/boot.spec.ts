import { test, expect } from "@playwright/test";
import { readState } from "../support/state";

const state = readState();

// The shared instance serves behind the basic-auth fence: the browser
// answers the 401 challenge with the suite's test credential pair
// (ADR-0001), then the page loads.
test.use({ httpCredentials: { username: state.auth.user, password: state.auth.password } });

test("serves the placeholder page at / in a real browser", async ({ page }) => {
  // The fence specs' patch swaps hot-reload the shared instance's config
  // (ADR-0008), restarting its child with backoff; tolerate a restart window
  // like the supervision crash spec does.
  await expect(async () => {
    await page.goto(state.baseURL, { timeout: 5_000 });
    await expect(page).toHaveTitle("dsh-next-app");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("dsh-next-app");
    await expect(page.getByText("Placeholder scaffold page")).toBeVisible();
  }).toPass({ timeout: 90_000 });
});

test("the dsh process announces the serving URL on stdout", () => {
  expect(state.announceLine).toBe(`dsh next-app: ${state.baseURL}`);
});

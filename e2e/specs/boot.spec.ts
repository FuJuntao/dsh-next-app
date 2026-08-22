import { test, expect } from "@playwright/test";
import { readState } from "../support/state";

const state = readState();

test("serves the placeholder page at / in a real browser", async ({ page }) => {
  await page.goto(state.baseURL);
  await expect(page).toHaveTitle("dsh-next-app");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("dsh-next-app");
  await expect(page.getByText("Placeholder scaffold page")).toBeVisible();
});

test("the dsh process announces the serving URL on stdout", () => {
  expect(state.announceLine).toBe(`dsh next-app: ${state.baseURL}`);
});

import { expect, test } from "@playwright/test";
import { readState } from "../support/state";

const state = readState();

// The touch tier (apps/web/app/globals.css, story: phone input density).
// iOS zooms the viewport onto a focused editable whose computed font-size
// is under 16px, so on coarse pointers every editable must compute at the
// 1rem bound; pointer-fine devices keep the designed densities (text-xs
// controls, text-sm composer). These legs pin both sides mechanically so
// the invariant cannot rot by review opinion (ADR-0006's stance for dsh
// compatibility, applied to the tier).
const CREDS = {
  httpCredentials: { username: state.auth.user, password: state.auth.password },
};

// The shared instance's child restarts with backoff when a sibling spec
// (supervision) crashes it; a bare goto can race that window. Retry the
// navigation until the server is back.
async function gotoHome(page: import("@playwright/test").Page) {
  await expect(async () => {
    await page.goto(state.baseURL + "/");
    await expect(page.locator("[contenteditable]").first()).toHaveCount(1);
  }).toPass({ timeout: 15_000 });
}

test.describe("touch tier (coarse pointer)", () => {
  // hasTouch + isMobile make Chromium report matchMedia("(pointer:
  // coarse)") as true, matching the tier's switch. Set directly rather
  // than spreading a device descriptor: defaultBrowserType would force a
  // new worker, which test.use disallows inside a describe group.
  test.use({
    viewport: { width: 412, height: 915 },
    hasTouch: true,
    isMobile: true,
    ...CREDS,
  });

  test("the home composer computes at the 1rem bound in its locked state", async ({ page }) => {
    await gotoHome(page);
    // The locked composer ships contenteditable="false" (it flips on
    // unlock) - the state that hid from the first version of this floor.
    await expect(page.locator("[contenteditable]").first()).toHaveCSS("font-size", "16px");
  });
});

test.describe("desktop density (fine pointer)", () => {
  test.use(CREDS);

  test("the home composer keeps the designed 14px", async ({ page }) => {
    await gotoHome(page);
    await expect(page.locator("[contenteditable]").first()).toHaveCSS("font-size", "14px");
  });
});

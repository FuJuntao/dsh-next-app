import { expect, test } from "../support/fixtures";
import type { BootedProfile } from "../support/profile";
import { readState } from "../support/state";

const state = readState();

test.use({ httpCredentials: { username: state.auth.user, password: state.auth.password } });

// The shell's desktop breakpoint: the side nav sits in flow (story #97).
const DESKTOP = { width: 1280, height: 800 };
test.use({ viewport: DESKTOP });

/**
 * The home composer's real send (story #117 task #120): typing text and
 * pressing send calls the startSession action, which creates a real session
 * over the bridge and prompts it - the browser lands on /sessions/[newId],
 * and the sidebar lists the new row. Asserted against the suite's own
 * dedicated instance (the homeProfile fixture installs the packed tarball
 * into its own DSH_HOME), so the session created here exists only for this
 * instance and cannot skew the shared or sessions instances' counts.
 *
 * Task #126 grows this file into the full home flow (preset, cwd, model,
 * leading-slash commands); this spec pins exactly what #120 delivered.
 */
let profile: BootedProfile;

test.beforeAll(async ({ homeProfile }) => {
  profile = homeProfile;
});

test("a home send starts a real session and lands in it", async ({ page }) => {
  await page.goto(profile.baseURL + "/");
  const composer = page.getByRole("textbox", { name: "Describe what you want to build" });
  // The SSR gate: contenteditable flips true only after hydration.
  await expect(composer).toBeEditable();
  await composer.pressSequentially("home flow send");

  await page.getByRole("button", { name: "Send message" }).click();

  // Story AC 2: navigation to the new session's route.
  await expect(page).toHaveURL(/\/sessions\/[^/]+$/);
  const sessionId = new URL(page.url()).pathname.split("/").pop() as string;

  // Story AC 5: the refresh after navigation re-ran the layout's session
  // fetch, so the sidebar already lists the new session.
  await expect(page.locator('[data-session-id="' + sessionId + '"]')).toBeVisible();
});

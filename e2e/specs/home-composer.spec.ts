import { randomUUID } from "node:crypto";
import { renameSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { httpPost } from "../support/bridge-client";
// The drift guard reads the SAME list the UI ships (story #117 task #126).
import { VENDORED_SLASH_COMMANDS } from "../../apps/web/lib/slash-commands";
import { expect, test } from "../support/fixtures";
import type { BootedProfile } from "../support/profile";
import { sleep } from "../support/process";
import { readState } from "../support/state";

const state = readState();

test.use({ httpCredentials: { username: state.auth.user, password: state.auth.password } });

// The shell's desktop breakpoint: the side nav sits in flow (story #97).
const DESKTOP = { width: 1280, height: 800 };
test.use({ viewport: DESKTOP });

/**
 * The home new-session flow (story #117 task #126), driven through the
 * real UI against the suite's own dedicated instance (the homeProfile
 * fixture installs the packed tarball into its own DSH_HOME) and
 * cross-checked over the bridge socket where the assertion is about what
 * reached the host, not what the DOM shows. Re-flowed against the
 * parent's `## Design` packet: the folder picker is a lazy TREE (tap a
 * row = choose, no path footer), the pickers are dialogs, the send
 * button says "Start session", the / menu opens mid-line and completes
 * the project's skills, and @ offers the recent roster at once.
 *
 * The review rules these specs pin: a send requires a chosen working
 * folder (the composer is locked until one is tapped), and the folder
 * tree offers only the host default folder's SUBTREE - the root row is
 * the default itself (marked "(default)"), and no ancestor of the root
 * appears anywhere (the server-side enforcement behind this is
 * unit-tested in host-browse.test.ts).
 *
 * Presets: this scratch deployment offers no preset roster, so the picker
 * stays hidden (task #121's empty-roster rule); the preset field's reach
 * into session.create is pinned by start-session's unit tests instead.
 */
let profile: BootedProfile;
let socket: string;
/** The instance's host default folder (host.describe.cwd) - tree root. */
let hostRoot: string;

/** One envelope call over the bridge; business errors are a hard failure. */
async function envelopeCall(method: string, payload: unknown): Promise<unknown> {
  const rpcId = "e2e-home-" + randomUUID();
  const res = await httpPost(
    socket,
    "/api/" + method,
    JSON.stringify({ type: "client-request", rpcId, method, payload }),
  );
  const frame = JSON.parse(res.body) as {
    result: { ok: boolean; value?: unknown; error?: { code: string; message?: string } };
  };
  if (res.status !== 200 || !frame.result.ok) {
    throw new Error(
      method +
        " failed: " +
        (frame.result.error?.code ?? "http-" + res.status) +
        " " +
        (frame.result.error?.message ?? ""),
    );
  }
  return frame.result.value;
}

/** One envelope call reported, business errors included. */
async function envelopeOutcome(
  method: string,
  payload: unknown,
): Promise<{ ok: true } | { ok: false; code: string }> {
  const rpcId = "e2e-home-" + randomUUID();
  const res = await httpPost(
    socket,
    "/api/" + method,
    JSON.stringify({ type: "client-request", rpcId, method, payload }),
  );
  const frame = JSON.parse(res.body) as {
    result: { ok: boolean; error?: { code: string } };
  };
  if (res.status === 200 && frame.result.ok) return { ok: true };
  return { ok: false, code: frame.result.error?.code ?? "http-" + res.status };
}

test.beforeAll(async ({ homeProfile }) => {
  profile = homeProfile;
  socket = join(profile.profileDir, "run", "next-app-" + profile.port + ".sock");
  const described = (await envelopeCall("host.describe", {})) as { cwd: string };
  hostRoot = described.cwd;
});

/** The new session's id from the route the composer must have landed on. */
function landedSessionId(page: Page): string {
  return new URL(page.url()).pathname.split("/").pop() as string;
}

/** The composer surface shared by the send specs (home starts LOCKED: no
 * folder chosen, so the editor is non-editable - hydration is proven by
 * the first dialog that opens, not by an editable attribute). */
async function gotoHome(page: Page) {
  await page.goto(profile.baseURL + "/");
  return page.getByRole("textbox", { name: "Describe what you want to build" });
}

/**
 * Open the folder dialog, re-driving the trigger until it answers - the
 * trigger only works once hydrated, and a locked composer routes the
 * editor-area tap to it as well.
 */
async function openFolderDialog(page: Page, via: "chip" | "editor" = "chip") {
  const trigger =
    via === "editor"
      ? page.getByRole("button", { name: "Choose a working folder to start" })
      : page.getByRole("button", { name: "Working folder", exact: true });
  await expect
    .poll(
      async () => {
        await trigger.click();
        return page.getByRole("dialog").isVisible();
      },
      { timeout: 15_000 },
    )
    .toBe(true);
}

/**
 * Choose the "docs" SUBFOLDER in the tree and return its absolute path.
 * Pins the containment UI: the tree's root IS the default folder (marked
 * "(default)" and itself a choice - the old "Choose default" button),
 * and no ancestor of the root is offered anywhere. Tapping a row chooses
 * it and closes the dialog - there is no path footer and no Choose
 * button to click.
 */
async function pickSubfolder(page: Page): Promise<string> {
  await openFolderDialog(page);
  const dialog = page.getByRole("dialog");
  const base = hostRoot.split("/").pop() as string;
  await expect(
    dialog.getByRole("button", { name: base + " (default)", exact: true }),
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: "/", exact: true })).toHaveCount(0);
  const chosen = hostRoot + "/docs";
  await dialog.getByRole("button", { name: "docs", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Working folder", exact: true })).toContainText(
    "docs",
  );
  // Chosen: the home lock lifts - the editor becomes editable (and focused).
  await expect(
    page.getByRole("textbox", { name: "Describe what you want to build" }),
  ).toBeEditable();
  return chosen;
}

test("sending is gated on a chosen folder, then starts a real session", async ({ page }) => {
  const composer = await gotoHome(page);
  // The empty-roster rule (task #121): no presets offered -> no picker.
  await expect(page.getByRole("button", { name: "Agent preset" })).toHaveCount(0);
  // The gate (review): without a chosen folder the input is locked -
  // non-editable, send disabled - and the footer states the remedy
  // rather than the shortcuts of an editor that does not accept typing.
  await expect(composer).toHaveAttribute("contenteditable", "false");
  await expect(page.getByRole("button", { name: "Start session" })).toBeDisabled();
  await expect(page.getByText("Choose a folder to start.")).toBeVisible();
  await openFolderDialog(page, "editor");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Chosen: the lock lifts, the legend appears, typing lands, the send runs.
  await pickSubfolder(page);
  await expect(page.getByText("Enter sends · / commands · @ sessions")).toBeVisible();
  await composer.pressSequentially("home flow send");
  await expect(page.getByRole("button", { name: "Start session" })).toBeEnabled();
  await page.getByRole("button", { name: "Start session" }).click();
  // Story AC 2: navigation to the new session's route.
  await expect(page).toHaveURL(/\/sessions\/[^/]+$/);
  // Story AC 5: the refresh after navigation re-ran the layout's session
  // fetch, so the sidebar already lists the new session.
  await expect(page.locator('[data-session-id="' + landedSessionId(page) + '"]')).toBeVisible();
});

test("a failed send shows the Alert, keeps the draft, and succeeds on retry", async ({ page }) => {
  const composer = await gotoHome(page);
  await pickSubfolder(page);
  await composer.pressSequentially("retry after failure");
  // Sever the bridge (socket moved aside - the sessions suite's trick):
  // the send must fail LOUDLY - Alert, no navigation, draft preserved.
  const moved = socket + ".e2e-moved";
  renameSync(socket, moved);
  try {
    await page.getByRole("button", { name: "Start session" }).click();
    const alert = page.getByTestId("send-error");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("Could not start the session");
    await expect(page).toHaveURL(/\/$/);
    await expect(composer).toContainText("retry after failure");
  } finally {
    renameSync(moved, socket);
  }
  // The retry: same draft, same button - the second send lands.
  await page.getByRole("button", { name: "Start session" }).click();
  await expect(page).toHaveURL(/\/sessions\/[^/]+$/);
  await expect(page.getByTestId("send-error")).toHaveCount(0);
  await expect(page.locator('[data-session-id="' + landedSessionId(page) + '"]')).toBeVisible();
});

test("the chosen subfolder reaches session.create", async ({ page }) => {
  const composer = await gotoHome(page);
  const chosen = await pickSubfolder(page);
  await composer.pressSequentially("cwd picker send");
  await page.getByRole("button", { name: "Start session" }).click();
  await expect(page).toHaveURL(/\/sessions\/[^/]+$/);
  // The chosen cwd is what the host session got (AC 7), read over the wire.
  const listed = (await envelopeCall("session.list", {})) as {
    items: { sessionId: string; cwd?: string }[];
  };
  const row = listed.items.find((item) => item.sessionId === landedSessionId(page));
  expect(row?.cwd).toBe(chosen);
});

test("the folder tree fits a phone viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await gotoHome(page);
  const fits = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    );
  await expect(fits).toPass();
  // Tap the locked editor: the dialog opens at phone width...
  await openFolderDialog(page, "editor");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(fits).toPass();
  // ...and expanding a deep node (long names wrap mid-token, the list
  // scrolls vertically) never widens the page - the old bottom path
  // line, one unbreakable token, is gone by design.
  await dialog.getByRole("button", { name: "Expand apps", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "web", exact: true })).toBeVisible();
  await expect(fits).toPass();
});

test("the model picker selection is applied before the first prompt", async ({ page }) => {
  // Drive the UI from the host's own catalog, not a fixture (AC 10).
  const catalog = (await envelopeCall("llm.models", {})) as {
    groups: {
      id: string;
      name: string;
      models: {
        id: string;
        name: string;
        reasoning?: { efforts: { id: string; name: string }[] };
      }[];
    }[];
  };
  expect(catalog.groups.length, "the e2e deployment must offer a model catalog").toBeGreaterThan(0);
  const group = catalog.groups[0]!;
  const model = group.models[0]!;
  // An effort-bearing model is chosen WITH an explicit non-off effort (the
  // chip path); one without is picked directly. Either way the choice is
  // what the session must end up with.
  const effort = model.reasoning?.efforts?.find((e) => e.id !== "off");
  const composer = await gotoHome(page);
  await pickSubfolder(page);
  await page.getByRole("button", { name: "Model" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Choose a model" })).toBeVisible();
  // The Default section leads, wearing the Recent shape: the resolved
  // target is the row's primary text.
  await expect(dialog.getByText("Default", { exact: true })).toBeVisible();
  // The filter narrows across providers and names; a provider hit keeps
  // its roster, a miss says so plainly.
  const filter = dialog.getByRole("textbox", { name: "Filter models" });
  await filter.fill(model.name);
  await expect(dialog.getByRole("button", { name: model.name, exact: true })).toBeVisible();
  await filter.fill("zzz-no-such-model");
  await expect(dialog.getByText(/No models match/)).toBeVisible();
  await filter.fill("");
  await dialog.getByRole("button", { name: model.name, exact: true }).click();
  if (effort !== undefined) {
    // Effort-bearing models drill: the dialog takes the model's name and
    // offers the efforts as chips ("Default" = the adapter's own pick).
    await expect(dialog.getByRole("heading", { name: model.name })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Default", exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: effort.name, exact: true }).click();
  }
  await expect(page.getByRole("button", { name: "Model" })).toContainText(model.name);
  await composer.pressSequentially("model picker send");
  await page.getByRole("button", { name: "Start session" }).click();
  await expect(page).toHaveURL(/\/sessions\/[^/]+$/);
  // The selection reached the session via selectModel (AC 10), read back
  // over the wire.
  const models = (await envelopeCall("session.models", { sessionId: landedSessionId(page) })) as {
    current: { provider: string; model: string; reasoningEffort?: string };
  };
  expect(models.current.provider).toBe(group.id);
  expect(models.current.model).toBe(model.id);
  if (effort !== undefined) {
    expect(models.current.reasoningEffort).toBe(effort.id);
  }
});

test("the / menu opens mid-line and completes skills and commands", async ({ page }) => {
  const composer = await gotoHome(page);
  await pickSubfolder(page);
  // Mid-line: the trigger arms after any word boundary (packet flow 4).
  await composer.pressSequentially("deploy now /comp");
  await expect(page.getByRole("option", { name: /\/compact/ })).toBeVisible();
  await page.keyboard.press("Escape");
  // Project skills: the chosen folder's .agents/skills roster completes
  // alongside the vendored host commands (the e2e instance's default
  // folder IS this repo checkout, which ships the skill family).
  await composer.pressSequentially(" /design");
  await expect(page.getByRole("option", { name: /\/design/ })).toBeVisible();
});

test("a leading-/ first message executes host-side", async ({ page }) => {
  const composer = await gotoHome(page);
  await pickSubfolder(page);
  await composer.pressSequentially("/goal");
  await page.getByRole("button", { name: "Start session" }).click();
  // The command runs at prompt admission (AC 8): ok lands on the new
  // session; a usage/state failure surfaces on the standard Alert path.
  // Whichever terminal state arrives, the one reply that fails this spec is
  // unknown-command (the vendored name must be host-recognized), and a
  // failure must preserve the draft for retry (AC 4).
  await expect
    .poll(
      async () => {
        if (page.url().includes("/sessions/")) return "navigated";
        const alertText = await page.getByTestId("send-error").textContent();
        return alertText === null ? "pending" : "alert:" + alertText;
      },
      { timeout: 30_000 },
    )
    .toMatch(/navigated|alert:(?!.*unknown-command).*/);
  if (!page.url().includes("/sessions/")) {
    await expect(composer).toContainText("/goal");
  }
});

test("every vendored / command is recognized by the host (drift guard)", async () => {
  const created = (await envelopeCall("session.create", {})) as { sessionId: string };
  for (const command of VENDORED_SLASH_COMMANDS) {
    const result = await envelopeOutcome("session.prompt", {
      sessionId: created.sessionId,
      mode: "queue",
      content: [{ type: "text", text: "/" + command.name }],
    });
    expect(
      result.ok ? "ok" : result.code,
      "the host must recognize /" +
        command.name +
        " (ok, or any error except unknown-command, is recognition)",
    ).not.toBe("unknown-command");
  }
});

test("the @ source offers recent sessions at once and the mention reaches the host", async ({
  page,
}) => {
  // Seed a searchable session: user-message content is what the FTS index
  // covers, and the first search builds it (warming the first-search
  // deferral the bundle patch opts into).
  const seedTitle = "Zephyr Widget Calibration";
  const seeded = (await envelopeCall("session.create", {})) as { sessionId: string };
  await envelopeCall("session.rename", { sessionId: seeded.sessionId, title: seedTitle });
  await envelopeCall("session.prompt", {
    sessionId: seeded.sessionId,
    mode: "queue",
    content: [{ type: "text", text: "recalibrate the zephyr widget sensors" }],
  });
  const composer = await gotoHome(page);
  await pickSubfolder(page);
  // The empty query offers the recent roster at once (packet flow 4):
  // the just-active seeded session is at its head before any query text.
  await composer.pressSequentially("ask about @");
  const option = page.getByRole("option", { name: new RegExp(seedTitle, "i") });
  await expect(option).toBeVisible({ timeout: 20_000 });
  // Typing narrows through session.search; picking replaces the @query
  // with the raw mention token (reference pills are a story non-goal, so
  // the editor shows the exact text the host will parse).
  await composer.pressSequentially("zephyr");
  await expect(option).toBeVisible();
  await option.click();
  await expect(composer).toContainText("@[" + seedTitle + "](dsh-session:");
  await page.getByRole("button", { name: "Start session" }).click();
  await expect(page).toHaveURL(/\/sessions\/[^/]+$/, { timeout: 30_000 });
  // The reference must have reached the host: the new session's log carries
  // either the raw mention or its normalized @label rendering.
  const newId = landedSessionId(page);
  const deadline = Date.now() + 30_000;
  let reached = false;
  while (Date.now() < deadline && !reached) {
    await sleep(500);
    const history = (await envelopeCall("session.history", { sessionId: newId })) as {
      events?: unknown[];
    };
    const wire = JSON.stringify(history.events ?? []);
    reached = wire.includes("dsh-session:") || wire.includes(seedTitle);
  }
  expect(reached, "the first prompt must carry the session reference to the host").toBe(true);
});

import { randomUUID } from "node:crypto";
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
 * The home new-session flow (story #117 task #126, growing from task
 * #120's send spec), driven through the real UI against the suite's own
 * dedicated instance (the homeProfile fixture installs the packed tarball
 * into its own DSH_HOME) and cross-checked over the bridge socket where
 * the assertion is about what reached the host, not what the DOM shows.
 *
 * Presets: this scratch deployment offers no preset roster (no preset
 * roots are configured), so the picker is expected to stay hidden (task
 * #121's empty-roster rule); the preset field's reach into session.create
 * is pinned by start-session's unit tests instead.
 */
let profile: BootedProfile;
let socket: string;

test.beforeAll(async ({ homeProfile }) => {
  profile = homeProfile;
  socket = join(profile.profileDir, "run", "next-app-" + profile.port + ".sock");
});

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

/** The new session's id from the route the composer must have landed on. */
function landedSessionId(page: Page): string {
  return new URL(page.url()).pathname.split("/").pop() as string;
}

/** The composer surface shared by the send specs. */
async function gotoHome(page: Page) {
  await page.goto(profile.baseURL + "/");
  const composer = page.getByRole("textbox", { name: "Describe what you want to build" });
  // The SSR gate: contenteditable flips true only after hydration.
  await expect(composer).toBeEditable();
  return composer;
}

test("a home send starts a real session and lands in it", async ({ page }) => {
  const composer = await gotoHome(page);
  // The empty-roster rule (task #121): this deployment offers no presets,
  // so the picker must not render an empty menu.
  await expect(page.getByRole("button", { name: "Agent preset" })).toHaveCount(0);
  await composer.pressSequentially("home flow send");
  await page.getByRole("button", { name: "Send message" }).click();
  // Story AC 2: navigation to the new session's route.
  await expect(page).toHaveURL(/\/sessions\/[^/]+$/);
  // Story AC 5: the refresh after navigation re-ran the layout's session
  // fetch, so the sidebar already lists the new session.
  await expect(page.locator('[data-session-id="' + landedSessionId(page) + '"]')).toBeVisible();
});

test("the cwd picker browses to a folder and the choice reaches create", async ({ page }) => {
  const composer = await gotoHome(page);
  await page.getByRole("button", { name: "Working folder" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // The browse lands rooted at the host account home (absent path default).
  await expect(dialog.getByRole("button", { name: "Host home" })).toBeVisible();
  // The breadcrumb rail reaches the filesystem root; /tmp lives there.
  await dialog.getByRole("button", { name: "/", exact: true }).click();
  await dialog.getByRole("button", { name: "tmp", exact: true }).click();
  // Sync on the browse completing (the path line shows /tmp) - clicking
  // Choose against a stale listing would pick the previous directory.
  await expect(dialog.getByText("/tmp", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Choose" }).click();
  await expect(page.getByRole("button", { name: "Working folder" })).toContainText("tmp");
  await composer.pressSequentially("cwd picker send");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page).toHaveURL(/\/sessions\/[^/]+$/);
  // The chosen cwd is what the host session got (AC 7), read over the wire.
  const listed = (await envelopeCall("session.list", {})) as {
    items: { sessionId: string; cwd?: string }[];
  };
  const row = listed.items.find((item) => item.sessionId === landedSessionId(page));
  expect(row?.cwd).toBe("/tmp");
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
  // submenu path); one without is picked directly. Either way the choice is
  // what the session must end up with.
  const effort = model.reasoning?.efforts?.find((e) => e.id !== "off");
  const composer = await gotoHome(page);
  await page.getByRole("button", { name: "Model" }).click();
  if (effort === undefined) {
    // The default entry can now carry the same model name (it names the
    // real default), so exclude it by its "Deployment default" marker.
    await page
      .getByRole("menuitemradio", { name: new RegExp("^" + model.name) })
      .filter({ hasNotText: "Deployment default" })
      .first()
      .click();
  } else {
    await page
      .getByRole("menuitem", { name: new RegExp("^" + model.name) })
      .first()
      .click();
    await page
      .getByRole("menuitemradio", { name: new RegExp("^" + effort.name) })
      .first()
      .click();
  }
  await expect(page.getByRole("button", { name: "Model" })).toContainText(model.name);
  await composer.pressSequentially("model picker send");
  await page.getByRole("button", { name: "Send message" }).click();
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

test("a leading-/ first message executes host-side", async ({ page }) => {
  const composer = await gotoHome(page);
  await composer.pressSequentially("/goal");
  await page.getByRole("button", { name: "Send message" }).click();
  // The command runs at prompt admission (AC 8): ok lands on the new
  // session; a usage/state failure surfaces on the standard Alert path.
  // Whichever terminal state arrives, the one reply that fails this spec is
  // unknown-command (the vendored name must be host-recognized), and a
  // failure must preserve the draft for retry (AC 4).
  await expect
    .poll(
      async () => {
        if (page.url().includes("/sessions/")) return "navigated";
        const alertText = await page.getByRole("alert").textContent();
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

test("the @ source offers seeded sessions and the mention reaches the host", async ({ page }) => {
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
  await composer.pressSequentially("ask about @zephyr");
  // The menu offers the seeded session (AC 9); picking it replaces the
  // @query with the raw mention token (reference pills are a story
  // non-goal, so the editor shows the exact text the host will parse).
  const option = page.getByRole("option", { name: new RegExp(seedTitle, "i") });
  await expect(option).toBeVisible({ timeout: 20_000 });
  await option.click();
  await expect(composer).toContainText("@[" + seedTitle + "](dsh-session:");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page).toHaveURL(/\/sessions\/[^/]+$/, { timeout: 30_000 });
  // The reference must have reached the host: the new session's log carries
  // either the raw mention or its normalized rendering.
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

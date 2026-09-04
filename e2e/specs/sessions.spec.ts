import { randomUUID } from "node:crypto";
import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { httpPost } from "../support/bridge-client";
// The extended test carries the sessionsProfile worker fixture.
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
 * The real-data sessions list (story #107 task #110), asserted against a
 * dedicated profile instance: the sessionsProfile fixture installs the
 * packed tarball into its own DSH_HOME and boots it, so the rows seeded
 * here exist only for this instance - nothing leaks into the shared
 * instance's session.list, and no assumption depends on spec file order.
 *
 * Seeding speaks the envelope protocol itself over the bridge socket (the
 * story's no-model constraint): session.create with cwd for two workspaces,
 * session.rename for titles, one never-renamed session (the "New Session"
 * blank), and - for the nested row - session.prompt on the alpha session.
 * A prompt's turn settles whether the deployment answers with a model or
 * fails fast without one (turn/end is appended either way - the durable
 * log is what fork anchors on), and session.fork's child carries
 * parentSessionId, which is the lineage the nav nests.
 */

/** The two workspaces the seed creates (arbitrary, stable, distinct). */
const ALPHA_CWD = "/tmp/dsh-e2e-ws-alpha";
const BETA_CWD = "/tmp/dsh-e2e-ws-beta";
const ALPHA_TITLE = "Alpha workspace session";
const BETA_TITLE = "Beta workspace session";
const CHILD_TITLE = "Alpha forked child";

/** Gap between creates so createdAt (hence recency) orders deterministically. */
const SEED_GAP_MS = 50;
/** Budget for the seed prompt's turn to settle before fork anchors on it. */
const TURN_SETTLE_TIMEOUT_MS = 60_000;

/** The session.list row shape the assertions read (structural; no apiproxy types here). */
interface WireSession {
  sessionId: string;
  updatedAt: number;
  cwd?: string;
  parentSessionId?: string;
  projections?: { values?: Record<string, unknown> };
}

/** The response-frame shape the seeding reads (same contract bridge.spec pins). */
interface EnvelopeFrame {
  type: string;
  rpcId: string;
  result: { ok: true; value: unknown } | { ok: false; error: { code: string; message?: string } };
}

/** The nav's row element id attribute for one session id. */
const rowSelector = (sessionId: string): string => '[data-session-id="' + sessionId + '"]';

/**
 * One envelope call over the bridge socket: the wire contract bridge.spec
 * pins (200, server-response, echoed rpcId) asserted once here so the seed
 * reads as intent; a business error is a hard seed failure.
 */
async function envelopeCall(socket: string, method: string, payload: unknown): Promise<unknown> {
  const rpcId = "e2e-sessions-" + randomUUID();
  const res = await httpPost(
    socket,
    "/api/" + method,
    JSON.stringify({ type: "client-request", rpcId, method, payload }),
  );
  expect(res.status, method + " must ride the bridge as a 200").toBe(200);
  const frame = JSON.parse(res.body) as EnvelopeFrame;
  expect(frame.type).toBe("server-response");
  expect(frame.rpcId).toBe(rpcId);
  if (!frame.result.ok) {
    throw new Error(
      method + " failed: " + frame.result.error.code + " " + (frame.result.error.message ?? ""),
    );
  }
  return frame.result.value;
}

/** Top-level rows of a wire listing: parents absent from the list render top-level too. */
function topLevelOf(items: WireSession[]): WireSession[] {
  const ids = new Set(items.map((item) => item.sessionId));
  return items.filter(
    (item) => item.parentSessionId === undefined || !ids.has(item.parentSessionId),
  );
}

let profile: BootedProfile;
let socket: string;
let wireSessions: WireSession[];
let seeded: { alpha: string; beta: string; blank: string; child: string };

test.beforeAll(async ({ sessionsProfile }) => {
  profile = sessionsProfile;
  // The same run-dir naming bridge.spec pins; a rename fails loudly here too.
  socket = join(profile.profileDir, "run", "next-app-" + profile.port + ".sock");

  // 1. Two workspace sessions with projected titles.
  const alpha = (await envelopeCall(socket, "session.create", { cwd: ALPHA_CWD })) as {
    sessionId: string;
  };
  await envelopeCall(socket, "session.rename", { sessionId: alpha.sessionId, title: ALPHA_TITLE });
  await sleep(SEED_GAP_MS);
  const beta = (await envelopeCall(socket, "session.create", { cwd: BETA_CWD })) as {
    sessionId: string;
  };
  await envelopeCall(socket, "session.rename", { sessionId: beta.sessionId, title: BETA_TITLE });
  await sleep(SEED_GAP_MS);

  // 2. The blank session: never renamed, so no title projection exists and
  //    the nav must show its "New Session" fallback. Its cwd is the host's
  //    (session.create defaults it) - a third workspace bucket.
  const blank = (await envelopeCall(socket, "session.create", {})) as { sessionId: string };
  await sleep(SEED_GAP_MS);

  // 3. The nested row: give alpha a completed turn (no model required -
  //    turn/end lands on the failure path too), then fork it.
  await envelopeCall(socket, "session.prompt", {
    sessionId: alpha.sessionId,
    mode: "queue",
    content: [{ type: "text", text: "seed turn" }],
  });
  const deadline = Date.now() + TURN_SETTLE_TIMEOUT_MS;
  let settled = false;
  while (Date.now() < deadline) {
    await sleep(500);
    const history = (await envelopeCall(socket, "session.history", {
      sessionId: alpha.sessionId,
    })) as { events?: { event?: { type?: string } }[] };
    const types = (history.events ?? []).map((entry) => entry.event?.type);
    if (types.includes("turn/end")) {
      settled = true;
      break;
    }
  }
  expect(settled, "the seed prompt's turn must settle (turn/end) before fork anchors on it").toBe(
    true,
  );
  const forked = (await envelopeCall(socket, "session.fork", {
    sessionId: alpha.sessionId,
  })) as { sessionId: string };
  await envelopeCall(socket, "session.rename", { sessionId: forked.sessionId, title: CHILD_TITLE });

  // 4. The wire snapshot every order assertion reads (session.list is the
  //    recency contract: updatedAt descending).
  const list = (await envelopeCall(socket, "session.list", {})) as { items: WireSession[] };
  wireSessions = list.items;

  seeded = {
    alpha: alpha.sessionId,
    beta: beta.sessionId,
    blank: blank.sessionId,
    child: forked.sessionId,
  };

  // The seed is the fixture: a missing row means every later assertion lies.
  expect(wireSessions).toHaveLength(4);
  const child = wireSessions.find((item) => item.sessionId === seeded.child);
  expect(child?.parentSessionId, "the fork child must carry its parent's id").toBe(seeded.alpha);
});

const prefsCookie = (prefs: Record<string, string>): string =>
  "dsh-next-app.prefs=" + encodeURIComponent(JSON.stringify(prefs));
const authHeader =
  "Basic " + Buffer.from(state.auth.user + ":" + state.auth.password).toString("base64");

test("seeded sessions render with their titles; the blank one shows New Session", async ({
  page,
}) => {
  await page.goto(profile.baseURL + "/");
  const nav = page.getByRole("navigation", { name: "Primary" });
  for (const [sessionId, title] of [
    [seeded.alpha, ALPHA_TITLE],
    [seeded.beta, BETA_TITLE],
    [seeded.child, CHILD_TITLE],
  ] as const) {
    const row = nav.locator(rowSelector(sessionId));
    await expect(row).toBeVisible();
    await expect(row).toContainText(title);
  }
  // No title projection on the never-renamed session: the fallback shows.
  const blankRow = nav.locator(rowSelector(seeded.blank));
  await expect(blankRow).toBeVisible();
  await expect(blankRow).toContainText("New Session");
  // A healthy bridge with rows renders no bridge-down error state.
  await expect(nav.getByText("Sessions unavailable")).toHaveCount(0);
});

test("rows order by recency - the session.list wire order", async ({ page }) => {
  await page.goto(profile.baseURL + "/");
  // Top-level DOM order (nested rows render inside their parent's row) must
  // equal the wire's recency order restricted to the same rows - the nav's
  // byRecency sort is the wire order by construction.
  const domTopLevel = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-session-id]"))
      .filter((el) => el.parentElement?.closest("[data-session-id]") === null)
      .map((el) => el.getAttribute("data-session-id")),
  );
  expect(domTopLevel).toEqual(topLevelOf(wireSessions).map((item) => item.sessionId));
});

test("By workspace buckets by cwd with the full path as the header detail", async ({ page }) => {
  await page.goto(profile.baseURL + "/");
  const nav = page.getByRole("navigation", { name: "Primary" });
  await nav.getByRole("button", { name: "Session grouping" }).click();
  await page.getByRole("menuitemradio", { name: "By workspace" }).click();

  // Every seeded row carries a cwd (the blank one got the host's), so the
  // buckets are exactly the distinct cwds of the top-level rows; the fork
  // child nests inside its parent's bucket.
  const buckets = new Map<string, string[]>();
  for (const item of topLevelOf(wireSessions)) {
    const key = item.cwd ?? "";
    const members = buckets.get(key);
    if (members !== undefined) members.push(item.sessionId);
    else buckets.set(key, [item.sessionId]);
  }
  await expect(page.locator("[data-testid^='session-group-']")).toHaveCount(buckets.size);

  // Workspace groups order by their newest member's activity; each shows the
  // cwd's basename with the full path as its detail, and holds its rows.
  const expectedOrder = [...buckets.entries()]
    .sort(
      ([, a], [, b]) =>
        Math.max(...b.map((id) => wireSessions.find((w) => w.sessionId === id)!.updatedAt)) -
        Math.max(...a.map((id) => wireSessions.find((w) => w.sessionId === id)!.updatedAt)),
    )
    .map(([cwd]) => "session-group-" + cwd);
  const domGroupOrder = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-testid^='session-group-']")).map((el) =>
      el.getAttribute("data-testid"),
    ),
  );
  expect(domGroupOrder).toEqual(expectedOrder);

  for (const [cwd, memberIds] of buckets) {
    const group = page.getByTestId("session-group-" + cwd);
    await expect(group).toBeVisible();
    await expect(group.getByTitle(cwd)).toBeVisible();
    for (const memberId of memberIds) {
      await expect(group.locator(rowSelector(memberId))).toBeVisible();
    }
    // The nested child renders inside its parent's workspace bucket.
    if (memberIds.includes(seeded.alpha)) {
      await expect(group.locator(rowSelector(seeded.child))).toBeVisible();
    }
  }
});

test("the grouping choice persists across reloads, server-rendered into the first paint", async ({
  page,
  request,
}) => {
  await page.goto(profile.baseURL + "/");
  const nav = page.getByRole("navigation", { name: "Primary" });
  await nav.getByRole("button", { name: "Session grouping" }).click();
  await page.getByRole("menuitemradio", { name: "By workspace" }).click();
  await expect(page.locator("[data-testid^='session-group-']")).not.toHaveCount(0);

  // A reload carries the choice (the prefs cookie): the grouped arrangement
  // renders immediately, not after a client-side re-arrange.
  await page.reload();
  await expect(page.locator("[data-testid^='session-group-']")).not.toHaveCount(0);

  // The server renders the stored grouping into the first HTML - the same
  // request with the cookie must contain the workspace group containers,
  // proving the first paint (no flash) rather than a post-hydration fix-up.
  const res = await request.get(profile.baseURL + "/", {
    headers: { authorization: authHeader, cookie: prefsCookie({ sessionGroup: "workspace" }) },
  });
  expect(res.status()).toBe(200);
  const html = await res.text();
  const cwdKeys = new Set(topLevelOf(wireSessions).map((item) => item.cwd ?? ""));
  for (const cwd of cwdKeys) {
    expect(html).toContain('data-testid="session-group-' + cwd + '"');
  }
});

test("switching back to No grouping flattens the list again", async ({ page }) => {
  await page.context().addCookies([
    {
      name: "dsh-next-app.prefs",
      value: encodeURIComponent(JSON.stringify({ sessionGroup: "workspace" })),
      url: profile.baseURL,
    },
  ]);
  await page.goto(profile.baseURL + "/");
  const nav = page.getByRole("navigation", { name: "Primary" });
  await expect(page.locator("[data-testid^='session-group-']")).not.toHaveCount(0);

  await nav.getByRole("button", { name: "Session grouping" }).click();
  await page.getByRole("menuitemradio", { name: "No grouping" }).click();

  // The flat view is one implicit group (empty key) with no workspace
  // headers, and every row - top-level and nested - still renders.
  await expect(page.locator("[data-testid='session-group-']")).toHaveCount(1);
  await expect(page.locator("[data-session-id]")).toHaveCount(wireSessions.length);
});

test("the fork child nests under its parent row", async ({ page }) => {
  await page.goto(profile.baseURL + "/");
  // RowNode renders the child inside the parent's nested list - containment
  // in the DOM is the nesting contract (a dropped child would vanish).
  const parent = page.locator(rowSelector(seeded.alpha));
  const child = parent.locator(rowSelector(seeded.child));
  await expect(child).toBeVisible();
  await expect(child).toContainText(CHILD_TITLE);
});

test("the bridge-down state renders distinctly and recovers via Retry", async ({ page }) => {
  // Move the socket file aside: the listener survives the rename (posix),
  // but every connect to the row's path now fails - the real transport
  // failure AC 6 covers, without stopping the profile. The listener keeps
  // the inode, so moving the file back restores the channel exactly.
  const moved = socket + ".e2e-moved";
  renameSync(socket, moved);
  let restored = false;
  try {
    await page.goto(profile.baseURL + "/");
    // The distinct error state - never stale placeholder rows.
    await expect(page.getByTestId("sessions-unavailable")).toBeVisible();
    await expect(page.getByText("Sessions unavailable")).toBeVisible();
    const retry = page.getByRole("button", { name: "Retry loading sessions" });
    await expect(retry).toBeVisible();
    // The rest of the page still renders.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Into the Unknown");
    await expect(page.locator("[data-session-id]")).toHaveCount(0);

    // Recovery: with the channel back, Retry re-fetches and the rows render.
    renameSync(moved, socket);
    restored = true;
    await retry.click();
    await expect(page.locator(rowSelector(seeded.alpha))).toBeVisible();
    await expect(page.getByText("Sessions unavailable")).toHaveCount(0);
  } finally {
    // Never leave the suite's instance unwired, whatever the assertions did.
    if (!restored && existsSync(moved)) renameSync(moved, socket);
  }
});

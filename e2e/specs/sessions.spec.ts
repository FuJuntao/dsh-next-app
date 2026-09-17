import { randomUUID } from "node:crypto";
import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { httpPost } from "../support/bridge-client";
// The drift guard reads the SAME budget the UI ships (the carved e2e
// cross-import, review #4 - same precedent as home-composer's slash list).
import { SESSION_PAGE_SIZE } from "../../apps/web/lib/session-view";
// The extended test carries the sessionsProfile worker fixture.
import { expect, test } from "../support/fixtures";
import type { Page } from "@playwright/test";
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
 *
 * Story #148 grows the seed: twelve more ALPHA_CWD sessions put the alpha
 * bucket at 13 top-level rows - three pages against the budget, so the
 * pager runs twice there and the middle page shows Show less and Show
 * {n} more side by side - while BETA_CWD stays at 1 row as the no-control
 * case.
 */

/** The two workspaces the seed creates (arbitrary, stable, distinct). */
const ALPHA_CWD = "/tmp/dsh-e2e-ws-alpha";
const BETA_CWD = "/tmp/dsh-e2e-ws-beta";
const ALPHA_TITLE = "Alpha workspace session";
const BETA_TITLE = "Beta workspace session";
const CHILD_TITLE = "Alpha forked child";
/** The extra alpha rows that take the bucket past two pages (#148, review #3). */
const ALPHA_EXTRA_TITLES = [
  "Alpha extra 1",
  "Alpha extra 2",
  "Alpha extra 3",
  "Alpha extra 4",
  "Alpha extra 5",
  "Alpha extra 6",
  "Alpha extra 7",
  "Alpha extra 8",
  "Alpha extra 9",
  "Alpha extra 10",
  "Alpha extra 11",
  "Alpha extra 12",
] as const;

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

/**
 * The alpha bucket's top-level rows in UI order, chunked into pages of the
 * imported SESSION_PAGE_SIZE. session.list is already updatedAt-descending
 * with no seed-time ties, so that is exactly the nav's byRecency order;
 * alpha itself leads (its seed prompt is the newest activity), so the fork
 * child rides into page 1.
 */
function alphaPages(): string[][] {
  const members = topLevelOf(wireSessions)
    .filter((item) => item.cwd === ALPHA_CWD)
    .map((item) => item.sessionId);
  const pages: string[][] = [];
  for (let i = 0; i < members.length; i += SESSION_PAGE_SIZE) {
    pages.push(members.slice(i, i + SESSION_PAGE_SIZE));
  }
  return pages;
}

let profile: BootedProfile;
let socket: string;
let wireSessions: WireSession[];
let seeded: { alpha: string; beta: string; blank: string; child: string; extras: string[] };

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

  // 1b. The #148 growth: twelve more alpha-bucket sessions, so that bucket
  //     pages three times (13 top-level rows against the imported budget).
  //     Created before the seed prompt renews the parent, so the window
  //     leads with alpha itself and the oldest extras wait on the last page.
  const extras: string[] = [];
  for (const title of ALPHA_EXTRA_TITLES.values()) {
    const extra = (await envelopeCall(socket, "session.create", { cwd: ALPHA_CWD })) as {
      sessionId: string;
    };
    await envelopeCall(socket, "session.rename", { sessionId: extra.sessionId, title });
    await sleep(SEED_GAP_MS);
    extras.push(extra.sessionId);
  }

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
    extras,
  };

  // The seed is the fixture: a missing row means every later assertion lies.
  expect(wireSessions).toHaveLength(2 + ALPHA_EXTRA_TITLES.length + 2);
  const child = wireSessions.find((item) => item.sessionId === seeded.child);
  expect(child?.parentSessionId, "the fork child must carry its parent's id").toBe(seeded.alpha);
});

const prefsCookie = (prefs: Record<string, string>): string =>
  "dsh-next-app.prefs=" + encodeURIComponent(JSON.stringify(prefs));
const authHeader =
  "Basic " + Buffer.from(state.auth.user + ":" + state.auth.password).toString("base64");

/** Install the workspace-grouping pref so a fresh navigation server-renders grouped. */
async function withWorkspaceGrouping(page: Page): Promise<void> {
  await page.context().addCookies([
    {
      name: "dsh-next-app.prefs",
      value: encodeURIComponent(JSON.stringify({ sessionGroup: "workspace" })),
      url: profile.baseURL,
    },
  ]);
}

/**
 * The PLATFORM accessible name of the button whose name starts with
 * `namePrefix`, read from Chromium's own accessibility tree over CDP - the
 * computation assistive technology consumes. Playwright's toHaveAccessibleName
 * / ariaSnapshot run a SEPARATE accname implementation that inserts a
 * separator between text nodes, so they pass the glued multi-child markup
 * this guards (review round 4); the CDP tree is the faithful source.
 */
async function platformButtonName(page: Page, namePrefix: string): Promise<string | undefined> {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { nodes } = (await cdp.send("Accessibility.getFullAXTree")) as {
      nodes: { role?: { value?: string }; name?: { value?: string } }[];
    };
    return nodes.find(
      (n) => n.role?.value === "button" && (n.name?.value ?? "").startsWith(namePrefix),
    )?.name?.value;
  } finally {
    await cdp.detach();
  }
}

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
    // The nested child renders inside its parent's workspace bucket, on the
    // parent's page - asserted before the page walk moves the window (the
    // child rides with alpha, whose renewed activity leads page 1).
    if (memberIds.includes(seeded.alpha)) {
      await expect(group.locator(rowSelector(seeded.child))).toBeVisible();
    }
    // #148 makes a busy group page (#149 grew alpha to 13 top-level rows):
    // walk the pages and assert every member is REACHED by the pager -
    // expand first, then assert membership; untouched here, the old
    // all-visible-at-once assertion would now be the weakened one.
    const seen = new Set<string>();
    for (;;) {
      for (const memberId of memberIds) {
        const row = group.locator(rowSelector(memberId));
        if ((await row.count()) > 0) {
          await expect(row).toBeVisible();
          seen.add(memberId);
        }
      }
      const more = group.getByRole("button", { name: /^Show \d+ more$/ });
      if ((await more.count()) === 0) break;
      await more.click();
    }
    expect([...seen].sort()).toEqual([...memberIds].sort());
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

// ---------- story #148 task #149: fold + 5-row pager ----------

test("pager: windows the budget, pages forward through the pair state, steps back one page", async ({
  page,
}) => {
  await withWorkspaceGrouping(page);
  await page.goto(profile.baseURL + "/");
  const pages = alphaPages();
  // The seed puts alpha at three pages: a full first page, a middle page
  // where BOTH controls sit side by side (review #3's unasserted state),
  // and a short last page.
  expect(pages.map((p) => p.length)).toEqual([SESSION_PAGE_SIZE, SESSION_PAGE_SIZE, 3]);
  const alpha = page.getByTestId("session-group-" + ALPHA_CWD);

  // AC 1 unfolded page 1: the budget's newest rows, the rest not in the DOM.
  for (const id of pages[0]!) await expect(alpha.locator(rowSelector(id))).toBeVisible();
  for (const id of pages[1]!) await expect(alpha.locator(rowSelector(id))).toHaveCount(0);
  // AC 2 at page 1: Show less absent; Show more carries the hidden budget.
  await expect(alpha.getByRole("button", { name: "Show less" })).toHaveCount(0);
  await alpha.getByRole("button", { name: "Show " + SESSION_PAGE_SIZE + " more" }).click();

  // Page 2, the pair state: Show less AND Show {min(5, hidden)=3} more.
  for (const id of pages[1]!) await expect(alpha.locator(rowSelector(id))).toBeVisible();
  for (const id of pages[0]!) await expect(alpha.locator(rowSelector(id))).toHaveCount(0);
  await expect(alpha.getByRole("button", { name: "Show less" })).toBeVisible();
  await alpha.getByRole("button", { name: "Show 3 more" }).click();

  // Last page: Show more gone (everything shows), Show less steps back to
  // the pair state - exactly one page, not all the way out (AC 2).
  for (const id of pages[2]!) await expect(alpha.locator(rowSelector(id))).toBeVisible();
  await expect(alpha.getByRole("button", { name: /^Show \d+ more$/ })).toHaveCount(0);
  await alpha.getByRole("button", { name: "Show less" }).click();
  await expect(alpha.getByRole("button", { name: "Show less" })).toBeVisible();
  await expect(alpha.getByRole("button", { name: "Show 3 more" })).toBeVisible();
  for (const id of pages[1]!) await expect(alpha.locator(rowSelector(id))).toBeVisible();
  // ...and once more to the floor, where Show less vanishes.
  await alpha.getByRole("button", { name: "Show less" }).click();
  for (const id of pages[0]!) await expect(alpha.locator(rowSelector(id))).toBeVisible();
  await expect(alpha.getByRole("button", { name: "Show less" })).toHaveCount(0);

  // AC 2 no-control case: the one-row beta group renders no pager row at all.
  await expect(page.getByTestId("session-pager-" + BETA_CWD)).toHaveCount(0);
});

test("whole-group fold: the header folds, and reopening lands on page 1", async ({ page }) => {
  await withWorkspaceGrouping(page);
  await page.goto(profile.baseURL + "/");
  const pages = alphaPages();
  const alpha = page.getByTestId("session-group-" + ALPHA_CWD);
  const fold = page.getByTestId("session-fold-" + ALPHA_CWD);

  // AC 3: aria-expanded state, top-level count beside the name (read off
  // the same seed, review #4), full path tooltip.
  await expect(fold).toHaveAttribute("aria-expanded", "true");
  await expect(fold).toHaveAttribute("title", ALPHA_CWD);
  await expect(fold).toContainText(String(pages.flat().length));
  // The packet's Copy rule pinned on the PLATFORM accname (review round 4):
  // toHaveAccessibleName was no guard - Playwright's own accname inserts a
  // space between the two text nodes and passes the glued markup, while
  // Chromium's computation (what AT hears) glues it. The CDP tree is the
  // faithful read, and the single-text-node shape is pinned structurally.
  const basename = ALPHA_CWD.split("/").at(-1) ?? "";
  await expect(platformButtonName(page, basename)).resolves.toBe(
    basename + " " + pages.flat().length + " sessions",
  );
  await expect(fold.locator("span.sr-only").evaluate((el) => el.childNodes.length)).resolves.toBe(
    1,
  );

  // Park on the LAST page, so a reopen-to-page-1 that actually reset is
  // provable across more than one step.
  await alpha.getByRole("button", { name: "Show " + SESSION_PAGE_SIZE + " more" }).click();
  await alpha.getByRole("button", { name: "Show 3 more" }).click();

  await fold.click();
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  // Folded renders ONLY the header: no rows (top-level or nested), no pager.
  await expect(alpha.locator("[data-session-id]")).toHaveCount(0);
  await expect(page.getByTestId("session-pager-" + ALPHA_CWD)).toHaveCount(0);

  await fold.click();
  await expect(fold).toHaveAttribute("aria-expanded", "true");
  for (const id of pages[0]!) await expect(alpha.locator(rowSelector(id))).toBeVisible();
  for (const id of pages[1]!.concat(pages[2]!))
    await expect(alpha.locator(rowSelector(id))).toHaveCount(0);
});

test("active-session arrival: a deep link to a last-page row server-paints that page", async ({
  page,
  request,
}) => {
  const pages = alphaPages();
  // The seed pins alpha at 13 top-level rows, so the last page carries the
  // three oldest extras - the target and its same-page siblings.
  expect(pages[2]).toHaveLength(3);
  const [target, sibling] = pages[2] as [string, string];

  // AC 6 + AC 4 together: the FIRST paint (no JS, raw fetch) already windows
  // to the holding page - target and its sibling render, every page-1 row is
  // absent. A post-hydration patch-up would leave all sixteen rows in the
  // initial HTML and the jump would be a visible fix-up.
  const res = await request.get(profile.baseURL + "/sessions/" + target, {
    headers: { authorization: authHeader, cookie: prefsCookie({ sessionGroup: "workspace" }) },
  });
  expect(res.status()).toBe(200);
  const html = await res.text();
  expect(html).toContain('data-session-id="' + target + '"');
  expect(html).toContain('data-session-id="' + sibling + '"');
  for (const id of pages[0]!) expect(html).not.toContain('data-session-id="' + id + '"');

  // The hydrated page agrees: unfolded, on the holding page, row visible.
  await withWorkspaceGrouping(page);
  await page.goto(profile.baseURL + "/sessions/" + target);
  const alpha = page.getByTestId("session-group-" + ALPHA_CWD);
  await expect(page.getByTestId("session-fold-" + ALPHA_CWD)).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(alpha.locator(rowSelector(target))).toBeVisible();
  await expect(alpha.getByRole("button", { name: "Show less" })).toBeVisible();
});

test("active-session reveal scrolls a below-fold row into view", async ({ page }) => {
  // AC 4's scroll clause, mutation-guarded (review #3): a short viewport
  // makes the blank host-cwd row genuinely start below the fold - the
  // alpha group's page 1 plus pager fill the visible band - so deleting
  // the scrollIntoView call leaves this leg red, not silently green.
  await page.setViewportSize({ width: 1280, height: 320 });
  await withWorkspaceGrouping(page);
  await page.goto(profile.baseURL + "/sessions/" + seeded.blank);
  await expect(page.locator(rowSelector(seeded.blank))).toBeInViewport();
});

test("active-session reveal: navigation back into a folded group unfolds it", async ({ page }) => {
  await withWorkspaceGrouping(page);
  await page.goto(profile.baseURL + "/sessions/" + seeded.alpha);
  const fold = page.getByTestId("session-fold-" + ALPHA_CWD);
  await expect(page.locator(rowSelector(seeded.alpha))).toBeVisible();

  // Folding the group holding the ACTIVE session is allowed (blast radius:
  // the user's own control) and the reveal does not fight it in place...
  await fold.click();
  await expect(fold).toHaveAttribute("aria-expanded", "false");

  // ...nor does leaving disturb it: clicking the beta row is a client-side
  // navigation, and the beta reveal acts on the beta group only.
  const beta = page.getByTestId("session-group-" + BETA_CWD);
  await beta.locator(rowSelector(seeded.beta)).click();
  await expect(page).toHaveURL(new RegExp("/sessions/" + seeded.beta));
  await expect(fold).toHaveAttribute("aria-expanded", "false");

  // Back (client-side) changes the active session: the folded group holding
  // it now unfolds and its row is reachable (AC 4, once per change).
  await page.goBack();
  await expect(fold).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(rowSelector(seeded.alpha))).toBeVisible();
});

test("at 375px the fold header and pager answer taps", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await withWorkspaceGrouping(page);
  await page.goto(profile.baseURL + "/");
  // Below the desktop breakpoint the side nav is an overlay drawer.
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  const nav = page.getByRole("navigation", { name: "Primary" });
  await expect(nav).toBeVisible();

  const pages = alphaPages();
  const alpha = nav.getByTestId("session-group-" + ALPHA_CWD);
  const fold = nav.getByTestId("session-fold-" + ALPHA_CWD);

  // The window cap holds on the phone surface too.
  await expect(alpha.locator(rowSelector(pages[0]![0] as string))).toBeVisible();
  await expect(alpha.locator(rowSelector(pages[1]![0] as string))).toHaveCount(0);

  // The whole header row is the tap target (nothing hover-gated): fold, reopen.
  await fold.click();
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await fold.click();
  await expect(fold).toHaveAttribute("aria-expanded", "true");

  // Pager buttons are reachable and carry the same contract.
  await alpha.getByRole("button", { name: "Show " + SESSION_PAGE_SIZE + " more" }).click();
  await expect(alpha.locator(rowSelector(pages[1]![0] as string))).toBeVisible();
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

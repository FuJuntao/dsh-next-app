/**
 * The `/` roster is the host's roster (story #152 task #153 commit 6).
 *
 * Everything above commit 6 in this task is assertable per-function; what is
 * not is the CLAIM the story exists for - that the menu shows what the host
 * actually recognizes - because that claim spans two data doors that share no
 * code path: home walks the chosen folder with `yaml`, the session page asks
 * `skill.list` and takes the host's word. So this spec crosses the doors
 * rather than re-testing their internals.
 *
 * The five cases, and the criterion each one carries:
 *
 *  1. A block-scalar description reaches the menu as its own sentence, through
 *     the shared clamp (AC 4, and AC 3's clamp on the home door). This is the
 *     deployment's measured bug: a third of `~/homecenter/.agents/skills`
 *     rendered a literal `>`.
 *  2. A project with an empty family lists the vendored six and says NOTHING
 *     extra (AC 6's "genuinely empty" half).
 *  3. A family that cannot be read lists the vendored six and SAYS so in the
 *     hint row (AC 6's other half) - the distinction the whole criterion is
 *     about, told apart here by the only evidence the user has.
 *  4. The session door: the host's rows first, in the host's order, with the
 *     host's own descriptions clamped by the shared rule (AC 1, AC 2, AC 3);
 *     and a skills-less session keeping the six with the send path untouched
 *     (AC 5).
 *  5. The parity guard (AC 7): home's roster for the checkout is a SUBSET of
 *     the host's roster for a session at the same folder, name-for-name and
 *     description-for-description, order-agnostic.
 *
 * AC 7's direction is the load-bearing part and the reason the guard reads the
 * DOM: a row home invents - a skill the host will not list - fails it. That is
 * not hypothetical: this repo's own family carries `user-invocable: false`
 * (`shadcn`), which `skill.list` filters out and home must therefore hide.
 * Extra rows the host sees that home cannot (user-level roots, bundled
 * entries, flat Markdown) never fail it: home's scope is the chosen folder's
 * `.agents/skills` and nothing more, and the header of host-skills.ts says so.
 *
 * Fixture projects are created INSIDE the instance's default working folder -
 * not under /tmp - because home's read is fenced to that subtree, and a
 * fixture the fence cannot see cannot exercise the door at all. They are
 * gitignored (`/e2e-slash-*`) and removed in `afterAll`.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { httpPost } from "../support/bridge-client";
// The guard compares against the rule the UI actually ships - the same e2e
// carve-out #126's drift guard uses for the vendored list. A clamp restated
// here would be the second parser story #152 exists to delete.
import { clampSkillDescription } from "../../apps/web/lib/slash-menu";
import { VENDORED_SLASH_COMMANDS } from "../../apps/web/lib/slash-commands";
import { expect, test } from "../support/fixtures";
import type { BootedProfile } from "../support/profile";
import { readState } from "../support/state";

const state = readState();
test.use({ httpCredentials: { username: state.auth.user, password: state.auth.password } });
test.use({ viewport: { width: 1280, height: 800 } });

let profile: BootedProfile;
let socket: string;
/** The instance's host default folder: the checkout this suite runs from. */
let hostRoot: string;

/** The scratch projects, all direct children of the default folder. */
const FOLDED = "e2e-slash-folded";
const EMPTY = "e2e-slash-empty";
const BROKEN = "e2e-slash-broken";

/**
 * The folded block scalar's own lines. The menu must show them JOINED (YAML's
 * clipping adds one trailing newline), so the sentence and the file that
 * carries it are derived from the same list: no transcription to drift.
 */
const FOLDED_LINES = [
  "Deploy the stack and tail the logs, then name the services that",
  "restarted and the ones that refused to come up, so a green pipeline",
  "cannot hide a dead worker for a whole shift",
];
const FOLDED_SKILL = "fixture-folded";
const FOLDED_DESCRIPTION = FOLDED_LINES.join(" ") + "\n";

/** One envelope call over the bridge; a business error is a hard failure. */
async function envelopeCall<T>(method: string, payload: unknown): Promise<T> {
  const rpcId = "e2e-roster-" + randomUUID();
  const res = await httpPost(
    socket,
    "/api/" + method,
    JSON.stringify({ type: "client-request", rpcId, method, payload }),
  );
  const frame = JSON.parse(res.body) as {
    result: { ok: boolean; value?: T; error?: { code: string; message?: string } };
  };
  if (!frame.result.ok) {
    throw new Error(
      method +
        " failed: " +
        (frame.result.error?.code ?? "http-" + res.status) +
        " " +
        (frame.result.error?.message ?? ""),
    );
  }
  return frame.result.value as T;
}

/** One `skill.list` row, as the carrier's contract spells it. */
type HostSkill = { name: string; description: string; modelInvocable: boolean };

/** The host's own roster for a session, in its own order. */
function hostRoster(sessionId: string): Promise<HostSkill[]> {
  return envelopeCall<{ skills: HostSkill[] }>("skill.list", { sessionId }).then(
    (value) => value.skills,
  );
}

async function createSession(cwd: string): Promise<string> {
  const created = await envelopeCall<{ sessionId: string }>("session.create", { cwd });
  return created.sessionId;
}

/**
 * Write one fixture project: `<name>/.agents/skills/<skill>/SKILL.md`, its
 * frontmatter assembled from the caller's field lines.
 */
function writeProject(name: string, skill: string, fields: string[]): string {
  const project = join(hostRoot, name);
  const dir = join(project, ".agents", "skills", skill);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\n${fields.join("\n")}\n---\nBody.\n`);
  return project;
}

/** Open home, choose a top-level folder in the tree, await the unlocked editor. */
async function homeWithFolder(page: Page, folder: string): Promise<Locator> {
  await page.goto(profile.baseURL + "/");
  const trigger = page.getByRole("button", { name: "Working folder", exact: true });
  await expect
    .poll(
      async () => {
        await trigger.click();
        return page.getByRole("dialog").isVisible();
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  await page.getByRole("dialog").getByRole("button", { name: folder, exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const composer = page.getByRole("textbox", { name: "Describe what you want to build" });
  await expect(composer).toBeEditable();
  return composer;
}

/**
 * Open the `/` menu on a surface whose editor is already live. The empty
 * query is the whole roster: the trigger matches a bare `/`, so no filter
 * narrows what the guard is about to enumerate.
 */
async function openSlashMenu(page: Page, composer: Locator): Promise<void> {
  await composer.click();
  await composer.pressSequentially("/");
  await expect(page.getByRole("option").first()).toBeVisible();
}

/** One rendered menu row: the label and its second line, as the DOM holds them. */
type MenuRow = { label: string; description: string };

/**
 * The open menu's rows, top to bottom. The order is the assertion: AC 1 is a
 * claim about sequence, and a `toBeVisible` per name cannot express it.
 */
async function menuRows(page: Page): Promise<MenuRow[]> {
  const options = page.getByRole("option");
  const count = await options.count();
  const rows: MenuRow[] = [];
  for (let index = 0; index < count; index += 1) {
    // Row shape (session-composer's shared renderer): an icon, then the
    // label span, then the description span - both children of the text column.
    const spans = options.nth(index).locator("span span");
    rows.push({
      label: (await spans.nth(0).textContent()) ?? "",
      description: (await spans.nth(1).textContent()) ?? "",
    });
  }
  return rows;
}

/** The menu's hint row (`text-2xs`, outside the option list), or null. */
async function menuHint(page: Page, copy: string): Promise<string | null> {
  const hint = page.getByText(copy, { exact: true });
  return (await hint.count()) > 0 ? ((await hint.first().textContent()) ?? "") : null;
}

const HOME_HINT = "Couldn't read this folder's skills";
const SESSION_HINT = "Couldn't read this session's skills";

const vendoredLabels = VENDORED_SLASH_COMMANDS.map((command) => "/" + command.name);

test.beforeAll(async ({ homeProfile }) => {
  profile = homeProfile;
  socket = join(profile.profileDir, "run", "next-app-" + profile.port + ".sock");
  hostRoot = (await envelopeCall<{ cwd: string }>("host.describe", {})).cwd;

  // 1. the folded block scalar - the shape the first-colon reader turned into
  //    a literal ">", and long enough that the clamp has to bite.
  writeProject(FOLDED, FOLDED_SKILL, [
    `name: ${FOLDED_SKILL}`,
    "description: >",
    ...FOLDED_LINES.map((line) => "  " + line),
  ]);
  // 2. a real family, genuinely empty: an answer, not a failure.
  mkdirSync(join(hostRoot, EMPTY, ".agents", "skills"), { recursive: true });
  // 3. a family that exists but cannot be listed: `.agents/skills` is a file.
  mkdirSync(join(hostRoot, BROKEN, ".agents"), { recursive: true });
  writeFileSync(join(hostRoot, BROKEN, ".agents", "skills"), "not a directory\n");
});

test.afterAll(() => {
  for (const name of [FOLDED, EMPTY, BROKEN]) {
    rmSync(join(hostRoot, name), { recursive: true, force: true });
  }
});

test("a block-scalar description reaches the / menu as its own sentence", async ({ page }) => {
  const composer = await homeWithFolder(page, FOLDED);
  await openSlashMenu(page, composer);
  const row = page.getByRole("option", { name: new RegExp("/" + FOLDED_SKILL) });
  await expect(row).toBeVisible();
  const [first] = await menuRows(page);
  expect(first?.label).toBe("/" + FOLDED_SKILL);
  // The measured bug, inverted: this line used to read exactly ">".
  expect(first?.description).not.toBe(">");
  expect(first?.description).toBe(clampSkillDescription(FOLDED_DESCRIPTION));
  // Long enough to prove the clamp runs END to END, not just in the unit test.
  expect(first?.description.endsWith("…")).toBe(true);
  expect(first?.description.length ?? 0).toBe(160);
  // AC 6: a roster that arrived says nothing about itself.
  expect(await menuHint(page, HOME_HINT)).toBeNull();
});

test("a project with no skills keeps the vendored six and stays quiet", async ({ page }) => {
  const composer = await homeWithFolder(page, EMPTY);
  await openSlashMenu(page, composer);
  const rows = await menuRows(page);
  expect(rows.map((row) => row.label)).toEqual(vendoredLabels);
  expect(await menuHint(page, HOME_HINT)).toBeNull();
});

test("a family that cannot be read says so instead of claiming none", async ({ page }) => {
  const composer = await homeWithFolder(page, BROKEN);
  await openSlashMenu(page, composer);
  const rows = await menuRows(page);
  // AC 5: the floor holds - the menu never goes empty and never blocks a send.
  expect(rows.map((row) => row.label)).toEqual(vendoredLabels);
  // AC 6: and the one visible difference from the case above is the hint.
  expect(await menuHint(page, HOME_HINT)).toBe(HOME_HINT);
});

test("the session menu lists the host's roster, in the host's order", async ({ page }) => {
  // The checkout ships the skill family, so the host has a real answer here;
  // `session.create` takes the folder over the bridge, where no browser-named
  // path and no fence is involved (AC 2's whole point).
  const sessionId = await createSession(hostRoot);
  const skills = await hostRoster(sessionId);
  expect(
    skills.length,
    "the host must recognize the checkout's family for a session created at it",
  ).toBeGreaterThan(0);

  await page.goto(profile.baseURL + "/sessions/" + sessionId);
  const composer = page.getByRole("textbox", { name: "Message the session" });
  await composer.click();
  await composer.pressSequentially("/");
  await expect(page.getByRole("option").first()).toBeVisible();
  // The roster arrives after hydration, through the action (there is no
  // server-rendered copy of it to race against): until it lands, the menu is
  // at AC 5's floor - the vendored six, no more. Wait for the answer, and let
  // a count that never grows be the failure message.
  await expect
    .poll(async () => (await menuRows(page)).length, { timeout: 15_000 })
    .toBe(skills.length + vendoredLabels.length);
  const rows = await menuRows(page);
  const labels = rows.map((row) => row.label);

  // AC 1: skills first, in the order skill.list returned them - no sort
  // invented between the host and the menu.
  expect(labels.slice(0, skills.length)).toEqual(skills.map((skill) => "/" + skill.name));
  // AC 2: at least one row only the host knows about (the vendored six carry
  // none of this repo's skill names), so the roster is not the vendored list
  // with decoration.
  expect(labels.some((label) => !vendoredLabels.includes(label))).toBe(true);
  // AC 3: every skill row's second line is the host's own description through
  // the one shared clamp - never a fragment of the YAML.
  rows.slice(0, skills.length).forEach((row, index) => {
    expect(row.description).toBe(clampSkillDescription((skills[index] as HostSkill).description));
  });
  // AC 1's remainder, and AC 5's floor in the same breath: the vendored
  // commands all survive, in registration order, after the skills.
  expect(labels.slice(skills.length)).toEqual(vendoredLabels);
});

test("a session whose folder ships no skills keeps the six and sends anyway", async ({ page }) => {
  // A bare directory outside every git root: the host's own project-root walk
  // finds no family there, so the PROJECT half of the roster is empty by
  // construction - not by a severed bridge, which would take the page's own
  // data down with it and prove nothing about the menu. User-level and bundled
  // roots may still answer (they are the host's to list), which is why this
  // asserts the six survive rather than that they are alone.
  const bare = realpathSync(mkdtempSync(join(tmpdir(), "dsh-e2e-roster-bare-")));
  const sessionId = await createSession(bare);
  const skills = await hostRoster(sessionId);

  await page.goto(profile.baseURL + "/sessions/" + sessionId);
  const composer = page.getByRole("textbox", { name: "Message the session" });
  await composer.click();
  await composer.pressSequentially("/");
  await expect(page.getByRole("option").first()).toBeVisible();
  const labels = (await menuRows(page)).map((row) => row.label);
  for (const command of vendoredLabels) {
    expect(labels, "the empty roster must cost nothing: " + command).toContain(command);
  }
  // AC 6: an empty answer is not a failure, so it earns no hint line.
  if (skills.length === 0) {
    await expect(page.getByText(SESSION_HINT, { exact: true })).toHaveCount(0);
  }
  // AC 5's other half, and the reason a wrong menu is never a broken send:
  // the prompt path does not pass through the menu at all.
  await composer.pressSequentially("scripted-stream roster empty roster send path");
  await composer.press("Enter");
  await expect(
    page.getByTestId("transcript-scroll").getByText("empty roster send path", { exact: false }),
  ).toBeVisible({ timeout: 15_000 });
});

test("home's roster is a subset of the host's roster for the same folder", async ({ page }) => {
  const sessionId = await createSession(hostRoot);
  const host = new Map(
    (await hostRoster(sessionId)).map((skill) => [
      "/" + skill.name,
      clampSkillDescription(skill.description),
    ]),
  );

  await page.goto(profile.baseURL + "/");
  const rootBase = realpathSync(hostRoot).split("/").pop() as string;
  const composer = await homeWithFolder(page, rootBase + " (default)");
  await openSlashMenu(page, composer);
  // The menu must be showing the project's skills before its rows can prove
  // anything about them; wait for the read to land, then take the whole list.
  await expect
    .poll(
      async () => {
        const rows = await menuRows(page);
        return rows.filter((row) => !vendoredLabels.includes(row.label)).length;
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);
  const homeRows = (await menuRows(page)).filter((row) => !vendoredLabels.includes(row.label));

  expect(homeRows.length, "home must see this checkout's .agents/skills family").toBeGreaterThan(0);
  for (const row of homeRows) {
    // Name-for-name...
    expect(host.has(row.label), `the host does not list ${row.label}`).toBe(true);
    // ...and description-for-description, both through the one shared clamp.
    expect(host.get(row.label), row.label + "'s second line differs").toBe(row.description);
  }
});

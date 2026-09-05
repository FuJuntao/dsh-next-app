/**
 * The chat island, live in a browser (story #134 task #135; AC 27's live
 * streaming append, paging, and the empty/unknown states).
 *
 * Everything here asserts the DOWNLINK path end-to-end: prompts arrive
 * from the bridge (the UI send lands in commit 7), the open page must
 * stream them in without a reload, follow the bottom, page older history
 * in place, and pick up the title projection in header AND nav (AC 11).
 * The scripted provider's timing knobs (delayed chunked replies) are what
 * make "live" observable rather than a race against a settled turn.
 */
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { httpPost } from "../support/bridge-client";
import { expect, test } from "../support/fixtures";
import type { BootedProfile } from "../support/profile";
import { sleep } from "../support/process";

test.use({ httpCredentials: { username: "e2e", password: "dsh-next-app-e2e-password" } });
test.use({ viewport: { width: 1280, height: 800 } });

interface EnvelopeFrame {
  result: { ok: boolean; value?: unknown; error?: { code: string } };
}

let profile: BootedProfile;
let socket: string;
let cwd: string;

async function envelopeCall(method: string, payload: unknown): Promise<unknown> {
  const rpcId = "e2e-live-" + randomUUID();
  const res = await httpPost(
    socket,
    "/api/" + method,
    JSON.stringify({ type: "client-request", rpcId, method, payload }),
  );
  const frame = JSON.parse(res.body) as EnvelopeFrame;
  if (!frame.result.ok) throw new Error(method + ": " + frame.result.error?.code);
  return frame.result.value;
}

async function createSession(): Promise<string> {
  const created = (await envelopeCall("session.create", { cwd })) as { sessionId: string };
  return created.sessionId;
}

async function prompt(sessionId: string, text: string): Promise<void> {
  await envelopeCall("session.prompt", {
    sessionId,
    mode: "queue",
    content: [{ type: "text", text }],
  });
}

/** Poll one session's history until its turn count reaches n. */
async function awaitTurns(sessionId: string, turns: number): Promise<void> {
  const deadline = Date.now() + 90_000;
  for (;;) {
    const page = (await envelopeCall("session.history", {
      sessionId,
      maxMessages: 100,
    })) as { events: { event: { type: string } }[] };
    const ends = page.events.filter((entry) => entry.event.type === "turn/end").length;
    if (ends >= turns || Date.now() > deadline) return;
    await sleep(400);
  }
}

test.beforeAll(async ({ liveProfile }) => {
  profile = liveProfile;
  socket = join(profile.profileDir, "run", "next-app-" + profile.port + ".sock");
  cwd = realpathSync(mkdtempSync(join(tmpdir(), "dsh-e2e-chat-live-")));
  writeFileSync(join(cwd, "notes.txt"), "hello from the fixture\n");
});

test("a running prompt streams into the open page, settled exactly once", async ({ page }) => {
  const sessionId = await createSession();
  await page.goto(profile.baseURL + "/sessions/" + sessionId);
  await expect(page.getByText("No conversation yet")).toBeVisible();

  await prompt(sessionId, "scripted-stream live append proof");
  // The settled text must arrive WITHOUT a reload, together with the
  // user row's reconciliation (both come over the downlink).
  const scroller = page.getByTestId("transcript-scroll");
  const assistant = scroller.getByText("END-OF-STREAM", { exact: false });
  await expect(assistant).toBeVisible({ timeout: 45_000 });
  // The user row landed through the downlink too (the gap-check resync).
  await expect(scroller.getByText("scripted-stream live append proof")).toBeVisible();
  // Exactly-once fold: the streamed bubbles collapsed into ONE settled row.
  await expect(assistant).toHaveCount(1);

  // AC 11: the fallback title projection ("scripted-stream live append...")
  // lands in the page header and the side nav row without a reload.
  await expect(
    page.locator("header").getByRole("heading", { name: /live append proof/ }),
  ).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('[data-session-id="' + sessionId + '"]')).toContainText(
    "live append proof",
    { timeout: 45_000 },
  );
});

test("Load older pages the transcript in place", async ({ page }) => {
  const sessionId = await createSession();
  // 16 fast default-reply turns push the log past the 30-message tail
  // window so the tail page reports hasMore (AC 8).
  for (let i = 0; i < 16; i += 1) {
    await prompt(sessionId, `paging filler ${String(i)}`);
    await awaitTurns(sessionId, i + 1);
  }
  await page.goto(profile.baseURL + "/sessions/" + sessionId);
  const scroller = page.getByTestId("transcript-scroll");
  await expect(scroller).toBeVisible();
  const older = page.getByRole("button", { name: "Load older" });
  await expect(older).toBeVisible({ timeout: 15_000 });
  // The oldest loaded row before the click (whatever it is) must remain
  // visible after, and a row from the newly fetched page must appear.
  await older.click();
  await expect(scroller.getByText("paging filler 0", { exact: false })).toBeVisible({
    timeout: 20_000,
  });
  // Scroll preservation: the viewport did not slam to the top on prepend -
  // the settled rows near the bottom are still in view.
  await expect(scroller.getByText("paging filler 15", { exact: false })).toBeVisible();
});

test("an unknown id gets the distinct unknown-session state", async ({ page }) => {
  await page.goto(profile.baseURL + "/sessions/session-does-not-exist-at-all");
  await expect(page.getByRole("heading", { name: "Unknown session" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to sessions" })).toBeVisible();
  // The shell and nav keep working around it (AC 23).
  await expect(page.getByTestId("sessions-unavailable")).toHaveCount(0);
});

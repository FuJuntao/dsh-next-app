/**
 * Talking back from the browser (story #134 task #135 commit 7; AC 27's
 * "send and reconciliation"). The composer's real send rides the
 * session.prompt action; these specs pin what the packet promised:
 * a typed send's row lands exactly once (from the host's own event - the
 * page mints no optimistic echo), the queue gesture and the
 * queued strip behave, and the stop control settles the turn as stopped.
 */
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { httpPost } from "../support/bridge-client";
import { expect, test } from "../support/fixtures";
import type { BootedProfile } from "../support/profile";
import { sleep } from "../support/process";

test.use({ httpCredentials: { username: "e2e", password: "dsh-next-app-e2e-password" } });
test.use({ viewport: { width: 1280, height: 800 } });

let profile: BootedProfile;
let socket: string;
let cwd: string;

async function envelopeCall(method: string, payload: unknown): Promise<unknown> {
  const rpcId = "e2e-send-" + randomUUID();
  const res = await httpPost(
    socket,
    "/api/" + method,
    JSON.stringify({ type: "client-request", rpcId, method, payload }),
  );
  const frame = JSON.parse(res.body) as {
    result: { ok: boolean; value?: unknown; error?: { code: string } };
  };
  if (!frame.result.ok) throw new Error(method + ": " + frame.result.error?.code);
  return frame.result.value;
}

test.beforeAll(async ({ liveProfile }) => {
  profile = liveProfile;
  socket = join(profile.profileDir, "run", "next-app-" + profile.port + ".sock");
  cwd = realpathSync(mkdtempSync(join(tmpdir(), "dsh-e2e-send-")));
});

async function createSession(): Promise<string> {
  const created = (await envelopeCall("session.create", { cwd })) as { sessionId: string };
  return created.sessionId;
}

test("a typed send lands its row exactly once, from the host's event", async ({ page }) => {
  const sessionId = await createSession();
  await page.goto(profile.baseURL + "/sessions/" + sessionId);
  const box = page.getByRole("textbox", { name: "Message the session" });
  await box.click();
  await box.pressSequentially("scripted-stream typed send reconciliation");
  await box.press("Enter");
  const scroller = page.getByTestId("transcript-scroll");
  const userRow = scroller.getByText("typed send reconciliation", { exact: false });
  await expect(userRow).toBeVisible({ timeout: 10_000 }); // when the host records it
  await expect(userRow).toHaveCount(1); // one row, and only ever one
  await expect(scroller.getByText("END-OF-STREAM", { exact: false })).toBeVisible({
    timeout: 45_000,
  });
  await expect(userRow).toHaveCount(1);
});

test("Cmd/Ctrl+Enter queues while a turn runs and the queued strip settles", async ({ page }) => {
  const sessionId = await createSession();
  await page.goto(profile.baseURL + "/sessions/" + sessionId);
  // Start a long turn from the bridge so the NEXTUI send lands mid-turn.
  await envelopeCall("session.prompt", {
    sessionId,
    mode: "queue",
    content: [{ type: "text", text: "scripted-stream first long turn" }],
  });
  const box = page.getByRole("textbox", { name: "Message the session" });
  await box.click();
  await box.pressSequentially("queued second message");
  await box.press("Control+Enter"); // the queue chord (#134's Design packet, Gestures)
  const scroller = page.getByTestId("transcript-scroll");
  await expect(scroller.getByText("queued second message", { exact: false })).toBeVisible({
    timeout: 10_000,
  });
  // The queued strip (the host's own session/queue snapshot) carries it
  // first; after the agent claims it, exactly one durable user row remains.
  await expect(scroller.getByText("first long turn", { exact: false })).toBeVisible();
  await expect(scroller.getByText("queued second message", { exact: false })).toHaveCount(1, {
    timeout: 60_000,
  });
});

test("a steer into a blocked turn shows up at once, as the host's own fact (AC 13)", async ({
  page,
}) => {
  // The regression this closes: a steer is only recorded as a durable
  // `user/message` when the loop claims it at the NEXT STEP, and a turn
  // blocked on an approval never reaches that boundary until someone
  // answers. The optimistic echo used to cover the window and was removed, so
  // at one point a steered message was visible NOWHERE - draft cleared, no
  // row, no strip (the strip filtered `queued` only). It now renders from the
  // host's own `steering` placement, which the splice broadcasts immediately.
  const sessionId = await createSession();
  await page.goto(profile.baseURL + "/sessions/" + sessionId);
  await envelopeCall("session.prompt", {
    sessionId,
    mode: "queue",
    content: [{ type: "text", text: "scripted-approval block the step" }],
  });
  const card = page.getByTestId("approval-card");
  await expect(card).toBeVisible({ timeout: 30_000 }); // the step is now parked

  const box = page.getByRole("textbox", { name: "Message the session" });
  await box.click();
  await box.pressSequentially("steer while blocked");
  await box.press("Enter"); // Enter = steer

  const scroller = page.getByTestId("transcript-scroll");
  const stripLine = scroller.getByText("steer while blocked", { exact: false });
  const steeringGroup = scroller.getByText("Steering", { exact: false });
  await expect(steeringGroup).toBeVisible({ timeout: 10_000 });
  await expect(stripLine).toBeVisible();
  // Pending work, not a message in the session: the strip is the ONE
  // rendering of this text while the step is parked - no durable row yet.
  await expect(stripLine).toHaveCount(1);

  // Unblock: the loop claims the steer, its durable row lands, the strip
  // drains, and the text exists exactly once on the whole page.
  await card.getByRole("button", { name: "Allow once" }).click();
  await expect(scroller.getByText("Approval round complete", { exact: false })).toBeVisible({
    timeout: 60_000,
  });
  await expect(stripLine).toHaveCount(1, { timeout: 30_000 });
  await expect(steeringGroup).toHaveCount(0);
});

test("an approval ask renders an answerable card that settles from the client answer", async ({
  page,
}) => {
  const sessionId = await createSession();
  await page.goto(profile.baseURL + "/sessions/" + sessionId);
  await envelopeCall("session.prompt", {
    sessionId,
    mode: "queue",
    content: [{ type: "text", text: "scripted-approval escalate please" }],
  });
  const card = page.getByTestId("approval-card");
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText("bash");
  await card.getByRole("button", { name: "Allow once" }).click();
  // Settles from the broadcast approval/resolved frame (AC 16).
  await expect(page.getByTestId("approval-resolved")).toBeVisible({ timeout: 30_000 });
  // The bash call then runs and the model concludes.
  await expect(
    page.getByTestId("transcript-scroll").getByText("Approval round complete"),
  ).toBeVisible({ timeout: 30_000 });
});

test("the stop control settles the turn as stopped", async ({ page }) => {
  const sessionId = await createSession();
  await page.goto(profile.baseURL + "/sessions/" + sessionId);
  const box = page.getByRole("textbox", { name: "Message the session" });
  await box.click();
  await box.pressSequentially("scripted-stream please be long");
  await box.press("Enter");
  // While the turn runs the composer offers the two mode gestures; the idle
  // Send button is gone for exactly that duration.
  await expect(page.getByRole("button", { name: "Steer the session now" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("button", { name: "Queue this message" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send message" })).toHaveCount(0);
  const stop = page.getByRole("button", { name: "Stop current turn" });
  await expect(stop).toBeVisible(); // grew while the turn ran
  await stop.click();
  await expect(page.getByText("Turn stopped", { exact: false })).toBeVisible({
    timeout: 30_000,
  });
  await expect(stop).toBeHidden(); // running state settled from the stream
});

// --- The Stop handback (story #146 task #147 commit 6) --------------------
//
// A mid-turn steer is preserved by `session.cancel` (keepInbox) but the
// aborted driver never wakes again, so the steer parks in `session/queue`
// with nothing coming back for it. These legs prove the surface hands that
// work back to the composer, and that resending it runs as one turn.

test("Stop returns a stranded steer to the composer; resending lands it once (AC 1-3, AC 7)", async ({
  page,
}) => {
  const sessionId = await createSession();
  await page.goto(profile.baseURL + "/sessions/" + sessionId);
  // A long first turn to steer into and then stop.
  await envelopeCall("session.prompt", {
    sessionId,
    mode: "queue",
    content: [{ type: "text", text: "scripted-stream first long turn" }],
  });
  const box = page.getByRole("textbox", { name: "Message the session" });
  await expect(page.getByRole("button", { name: "Steer the session now" })).toBeVisible({
    timeout: 15_000,
  });
  await box.click();
  await box.pressSequentially("a steer to bring back");
  await box.press("Enter"); // Enter steers into the running turn
  const scroller = page.getByTestId("transcript-scroll");
  await expect(scroller.getByText("a steer to bring back", { exact: false })).toBeVisible({
    timeout: 10_000,
  }); // pending in the strip

  await page.getByRole("button", { name: "Stop current turn" }).click();

  // The strip empties on the host's release, and the text is back in the
  // composer - never a Continue/Resume/Retry control (AC 7).
  await expect(scroller.getByText("a steer to bring back", { exact: false })).toHaveCount(0, {
    timeout: 15_000,
  });
  await expect(box).toContainText("a steer to bring back");
  await expect(page.getByTestId("handback-notice")).toHaveText(
    "Returned 1 message to the composer.",
  );
  for (const name of [/continue/i, /resume/i, /retry/i]) {
    await expect(page.getByRole("button", { name })).toHaveCount(0);
    await expect(page.getByRole("link", { name })).toHaveCount(0);
  }

  // Resend the returned work: it becomes ONE durable row and runs a turn.
  await box.press("Enter");
  await expect(scroller.getByText("a steer to bring back", { exact: false })).toHaveCount(1, {
    timeout: 30_000,
  });
});

test("a Stop from another client is handed back on the first load (AC 1)", async ({ page }) => {
  // The deterministic shape of "after a Stop initiated from another client":
  // nothing drains it first, because no page is open while the stop happens.
  const sessionId = await createSession();
  await envelopeCall("session.prompt", {
    sessionId,
    mode: "queue",
    content: [{ type: "text", text: "scripted-stream another-client turn" }],
  });
  await envelopeCall("session.prompt", {
    sessionId,
    mode: "steer",
    content: [{ type: "text", text: "stranded by another client" }],
  });
  await envelopeCall("session.cancel", { sessionId }); // the other client's Stop

  await page.goto(profile.baseURL + "/sessions/" + sessionId);
  const box = page.getByRole("textbox", { name: "Message the session" });
  await expect(box).toContainText("stranded by another client", { timeout: 15_000 });
});

test("deleting the returned draft does not re-offer it on reload (AC 6)", async ({ page }) => {
  const sessionId = await createSession();
  await page.goto(profile.baseURL + "/sessions/" + sessionId);
  await envelopeCall("session.prompt", {
    sessionId,
    mode: "queue",
    content: [{ type: "text", text: "scripted-stream dismiss turn" }],
  });
  const box = page.getByRole("textbox", { name: "Message the session" });
  await expect(page.getByRole("button", { name: "Steer the session now" })).toBeVisible({
    timeout: 15_000,
  });
  await box.click();
  await box.pressSequentially("delete this return");
  await box.press("Enter");
  await page.getByRole("button", { name: "Stop current turn" }).click();
  await expect(box).toContainText("delete this return", { timeout: 15_000 });

  // Dismiss the returned draft, then reload.
  await box.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Delete");
  await page.reload();
  await expect(box).toBeVisible({ timeout: 30_000 });
  await sleep(3_000); // give any (wrongly) re-offered handback a window to appear
  await expect(box).not.toContainText("delete this return");
});

test("an image-bearing steer is residue, never returned (AC 4)", async ({ page }) => {
  const sessionId = await createSession();
  await envelopeCall("session.prompt", {
    sessionId,
    mode: "queue",
    content: [{ type: "text", text: "scripted-stream image turn" }],
  });
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR42mP4z8CAFTEMLQkAKP8/wc53yE8AAAAASUVORK5CYII=";
  await envelopeCall("session.prompt", {
    sessionId,
    mode: "steer",
    content: [
      { type: "text", text: "an image steer" },
      { type: "image", mediaType: "image/png", data: png, name: "shot.png" },
    ],
  });
  await envelopeCall("session.cancel", { sessionId }); // Stop: the steer parks

  await page.goto(profile.baseURL + "/sessions/" + sessionId);
  const box = page.getByRole("textbox", { name: "Message the session" });
  await expect(box).toBeVisible({ timeout: 30_000 });
  await sleep(3_000); // let any (wrongly) handback fire
  // The composer never receives the image-bearing item's text...
  await expect(box).not.toContainText("an image steer");
  // ...and the strip holds it up as the stopped fact, not a promised next step.
  const residue = page.getByTestId("queue-residue");
  await expect(residue).toBeVisible();
  await expect(residue).toContainText("the session is stopped");
});

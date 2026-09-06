/**
 * Talking back from the browser (story #134 task #135 commit 7; AC 27's
 * "send and reconciliation"). The composer's real send rides the
 * session.prompt action; these specs pin what the packet promised:
 * the optimistic row reconciles exactly once, the queue gesture and the
 * queued strip behave, and the stop control settles the turn as stopped.
 */
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { httpPost } from "../support/bridge-client";
import { expect, test } from "../support/fixtures";
import type { BootedProfile } from "../support/profile";

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

test("a typed send reconciles its optimistic row exactly once", async ({ page }) => {
  const sessionId = await createSession();
  await page.goto(profile.baseURL + "/sessions/" + sessionId);
  const box = page.getByRole("textbox", { name: "Message the session" });
  await box.click();
  await box.pressSequentially("scripted-stream typed send reconciliation");
  await box.press("Enter");
  const scroller = page.getByTestId("transcript-scroll");
  const userRow = scroller.getByText("typed send reconciliation", { exact: false });
  await expect(userRow).toBeVisible({ timeout: 10_000 }); // optimistic, instantly
  await expect(userRow).toHaveCount(1); // and the durable echo replaced it, no twin
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
  await box.press("Control+Enter"); // the queue chord (packet Q2)
  const scroller = page.getByTestId("transcript-scroll");
  await expect(scroller.getByText("queued second message", { exact: false })).toBeVisible({
    timeout: 10_000,
  });
  // The provisional row persists (queued placement is not the model's yet);
  // after the agent claims it, exactly one durable user row remains.
  await expect(scroller.getByText("first long turn", { exact: false })).toBeVisible();
  await expect(scroller.getByText("queued second message", { exact: false })).toHaveCount(1, {
    timeout: 60_000,
  });
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
  const stop = page.getByRole("button", { name: "Stop current turn" });
  await expect(stop).toBeVisible({ timeout: 15_000 }); // grew while the turn ran
  await stop.click();
  await expect(page.getByText("Turn stopped", { exact: false })).toBeVisible({
    timeout: 30_000,
  });
  await expect(stop).toBeHidden(); // running state settled from the stream
});

/**
 * The scripted model provider proves itself (story #134 task #135 commit 2;
 * AC 27's unblock).
 *
 * Everything a later live spec needs - deterministic chunks, a tool call
 * with a host-executed result, an approval ask, a failed model call - is
 * asserted HERE at the bridge/mux level: if the fixture cannot produce it,
 * no UI assertion downstream means anything. Sessions are seeded exactly
 * like sessions.spec.ts does (raw envelope calls over the socket), and the
 * mux assertions ride the same SSE the /api/events route relays.
 */
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { httpPost, openMux } from "../support/bridge-client";
import { expect, test } from "../support/fixtures";
import type { BootedProfile } from "../support/profile";
import { sleep } from "../support/process";

/** Budget for one scripted turn to settle (boot-to-first-token is the slow part). */
const TURN_SETTLE_MS = 60_000;

/** Wire shapes this spec reads (structural, per the suite's convention). */
interface WireEvent {
  type: string;
  seq: number;
  data: Record<string, unknown>;
}

interface HistoryPage {
  events: { event: WireEvent }[];
  hasMore: boolean;
}

interface EnvelopeFrame {
  type: string;
  rpcId: string;
  result: { ok: true; value: unknown } | { ok: false; error: { code: string; message?: string } };
}

async function envelopeCall(socket: string, method: string, payload: unknown): Promise<unknown> {
  const rpcId = "e2e-scripted-" + randomUUID();
  const res = await httpPost(
    socket,
    "/api/" + method,
    JSON.stringify({ type: "client-request", rpcId, method, payload }),
  );
  expect(res.status).toBe(200);
  const frame = JSON.parse(res.body) as EnvelopeFrame;
  expect(frame.rpcId).toBe(rpcId);
  if (!frame.result.ok) {
    throw new Error(
      method + " failed: " + frame.result.error.code + " " + (frame.result.error.message ?? ""),
    );
  }
  return frame.result.value;
}

/** Poll one session's whole history until `pred` accepts it (or the budget runs out). */
async function historyUntil(
  socket: string,
  sessionId: string,
  pred: (events: WireEvent[]) => boolean,
): Promise<WireEvent[]> {
  const deadline = Date.now() + TURN_SETTLE_MS;
  for (;;) {
    const page = (await envelopeCall(socket, "session.history", {
      sessionId,
      maxMessages: 50,
    })) as HistoryPage;
    const events = page.events.map((entry) => entry.event);
    if (pred(events)) return events;
    if (Date.now() > deadline) return events; // let the caller's assertion fail with the truth
    await sleep(250);
  }
}

const hasTurnEnd = (events: WireEvent[]): boolean => events.some((e) => e.type === "turn/end");

/** Create a session in a fixture cwd holding notes.txt. */
async function createLiveSession(socket: string, cwd: string): Promise<string> {
  const created = (await envelopeCall(socket, "session.create", { cwd })) as {
    sessionId: string;
  };
  return created.sessionId;
}

let profile: BootedProfile;
let socket: string;
let cwd: string;

test.beforeAll(async ({ liveProfile }) => {
  profile = liveProfile;
  socket = join(profile.profileDir, "run", "next-app-" + profile.port + ".sock");
  cwd = realpathSync(mkdtempSync(join(tmpdir(), "dsh-e2e-live-")));
  writeFileSync(join(cwd, "notes.txt"), "hello from the fixture\n");
});

test("a prompted turn streams chunks and lands a real assistant message", async () => {
  const sessionId = await createLiveSession(socket, cwd);
  await envelopeCall(socket, "session.prompt", {
    sessionId,
    mode: "queue",
    content: [{ type: "text", text: "scripted-stream hello the stub" }],
  });
  const events = await historyUntil(socket, sessionId, hasTurnEnd);
  const chunks = events.filter((e) => e.type === "assistant/chunk");
  const finals = events.filter((e) => e.type === "assistant/message");
  expect(chunks.length, "the scripted reply arrives as streamed chunk events").toBeGreaterThan(3);
  expect(finals).toHaveLength(1);
  const content = JSON.stringify(finals[0]?.data);
  expect(content).toContain("Streaming alpha");
  expect(content).toContain("END-OF-STREAM");
  const turnEnd = events.find((e) => e.type === "turn/end");
  expect((turnEnd?.data["reason"] as { kind?: string })?.kind).toBe("completed");
});

test("a scripted tool call executes on the host and its result reaches the model", async () => {
  const sessionId = await createLiveSession(socket, cwd);
  await envelopeCall(socket, "session.prompt", {
    sessionId,
    mode: "queue",
    content: [{ type: "text", text: "scripted-tool please read the notes" }],
  });
  const events = await historyUntil(socket, sessionId, hasTurnEnd);
  const call = events.find((e) => e.type === "tool/call");
  expect(call?.data["name"], "the model's requested tool ran").toBe("read");
  const result = events.find((e) => e.type === "tool/result");
  expect(JSON.stringify(result?.data)).toContain("hello from the fixture");
  const final = events.filter((e) => e.type === "assistant/message").at(-1);
  expect(JSON.stringify(final?.data)).toContain("File read complete");
});

test("a sandbox escalation asks on the mux stream and settles from the client answer", async () => {
  const sessionId = await createLiveSession(socket, cwd);
  // Subscribe BEFORE prompting: the ask must not race the subscription.
  const asked = new Promise<{ rpcId: string; payload: Record<string, unknown> }>(
    (resolve, reject) => {
      const handle = openMux(socket, (frame) => {
        if (
          frame.payload["type"] === "approval/requested" &&
          frame.payload["sessionId"] === sessionId
        ) {
          handle.close();
          resolve(frame);
        }
      });
      setTimeout(() => {
        handle.close();
        reject(new Error("no approval/requested frame within budget"));
      }, 60_000);
    },
  );
  await envelopeCall(socket, "session.prompt", {
    sessionId,
    mode: "queue",
    content: [{ type: "text", text: "scripted-approval escalate please" }],
  });
  const ask = await asked;
  // Answer by echoing the frame's rpcId (the client mints nothing), on
  // the carrier's respond leg - a raw envelope POST, not a method path.
  const res = await httpPost(
    socket,
    "/api/respond",
    JSON.stringify({
      type: "client-response",
      rpcId: ask.rpcId,
      result: {
        ok: true,
        value: { sessionId, approvalId: ask.payload["approvalId"], outcome: "allowed-once" },
      },
    }),
  );
  expect(res.status).toBe(200);
  expect(JSON.parse(res.body)).toMatchObject({ accepted: true });

  const events = await historyUntil(socket, sessionId, hasTurnEnd);
  const decided = events.find((e) => e.type === "approval/decided");
  expect(decided?.data["outcome"]).toBe("allowed-once");
  const final = events.filter((e) => e.type === "assistant/message").at(-1);
  expect(JSON.stringify(final?.data)).toContain("Approval round complete");
});

test("a failed model call settles the turn as an error", async () => {
  const sessionId = await createLiveSession(socket, cwd);
  await envelopeCall(socket, "session.prompt", {
    sessionId,
    mode: "queue",
    content: [{ type: "text", text: "scripted-fail break the turn" }],
  });
  const events = await historyUntil(socket, sessionId, hasTurnEnd);
  const turnEnd = events.find((e) => e.type === "turn/end");
  expect((turnEnd?.data["reason"] as { kind?: string })?.kind).toBe("error");
});

/**
 * Unit tests for the pure downlink protocol (task #135 commit 1).
 *
 * The re-emit boundary is where ADR-0001's promise lives ("the browser
 * never sees the envelope"), so its three rules - token only on answerable
 * frames, session filtering that never drops session-less frames, and the
 * SSE wire shape - are pinned here without a bridge; the streaming
 * transport itself is pinned in bridge-stream.test.ts.
 */
import { describe, expect, it } from "vitest";
import type { MuxFrame } from "@deepseek-ai/dsh-host-apiproxy/api";
import { encodeHeartbeat, encodeSse, frameBelongsToSession, toDownlinkEvent } from "./downlink";

const SUBSCRIBED: MuxFrame = {
  type: "session/subscribed",
  sessionId: "sess-a",
  lastSeq: 41,
} as unknown as MuxFrame;

const APPROVAL: MuxFrame = {
  type: "approval/requested",
  sessionId: "sess-a",
  approvalId: "appr-1",
  toolName: "bash",
} as unknown as MuxFrame;

const QUEUE_FOREIGN: MuxFrame = {
  type: "session/queue",
  sessionId: "sess-b",
  items: [],
} as unknown as MuxFrame;

const STREAM_ERROR: MuxFrame = {
  type: "stream/error",
  error: { code: "internal", message: "boom", details: {} },
};

describe("toDownlinkEvent", () => {
  it("lifts the envelope rpcId into an answerToken only for answerable frames", () => {
    const approval = toDownlinkEvent("rpc-9", APPROVAL);
    expect(approval.frame).toBe(APPROVAL);
    expect(approval.answerToken).toBe("rpc-9");

    const question = toDownlinkEvent("rpc-10", {
      type: "question/requested",
      sessionId: "sess-a",
      questions: [],
    } as unknown as MuxFrame);
    expect(question.answerToken).toBe("rpc-10");

    const push = toDownlinkEvent("rpc-11", SUBSCRIBED);
    expect(push.answerToken).toBeUndefined();
    expect("answerToken" in push).toBe(false);
  });
});

describe("frameBelongsToSession", () => {
  it("keeps the tab's own session and drops foreign ones", () => {
    expect(frameBelongsToSession(SUBSCRIBED, "sess-a")).toBe(true);
    expect(frameBelongsToSession(QUEUE_FOREIGN, "sess-a")).toBe(false);
  });

  it("passes session-less frames (stream/error) to every tab", () => {
    expect(frameBelongsToSession(STREAM_ERROR, "sess-a")).toBe(true);
  });
});

describe("SSE encoding", () => {
  it("emits one JSON data record per event, frame and token round-tripping", () => {
    const wire = encodeSse(toDownlinkEvent("rpc-9", APPROVAL));
    expect(wire.startsWith("data: ")).toBe(true);
    expect(wire.endsWith("\n\n")).toBe(true);
    const parsed = JSON.parse(wire.slice("data: ".length, -2)) as ReturnType<
      typeof toDownlinkEvent
    >;
    expect(parsed.answerToken).toBe("rpc-9");
    expect(parsed.frame.type).toBe("approval/requested");
  });

  it("keeps the heartbeat a comment record (no browser event fires)", () => {
    expect(encodeHeartbeat()).toBe(": ping\n\n");
  });
});

/**
 * Unit tests for the respond relay (task #135 commit 1).
 *
 * The relay's whole job is the envelope rebuild - echo the frame's token,
 * never mint one - and the receipt fold. The e2e suite cannot cheaply
 * produce a pending server-request on a scratch profile's socket, so the
 * accepted / not-pending / bad-response / transport outcomes are pinned
 * here with a mocked bridge (precedent: start-session.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// The relay module pulls the bridge client at call time; hand it the fake
// below instead of a unix socket (same seam start-session.test.ts uses).
const fake = vi.hoisted(() => ({
  respond: vi.fn(),
}));

vi.mock("./bridge", () => ({
  getActionBridgeClient: () => fake,
}));

const { relayRespond } = await import("./respond");

beforeEach(() => {
  fake.respond.mockReset();
});

describe("relayRespond", () => {
  it("echoes the frame token as the envelope rpcId and reports acceptance", async () => {
    fake.respond.mockResolvedValueOnce({ accepted: true });
    const result = await relayRespond({
      answerToken: "rpc-frame-1",
      result: {
        ok: true,
        value: { sessionId: "sess-1", approvalId: "appr-1", outcome: "allowed-once" },
      },
    });
    expect(result).toEqual({ status: "accepted" });
    expect(fake.respond).toHaveBeenCalledWith({
      type: "client-response",
      rpcId: "rpc-frame-1",
      result: {
        ok: true,
        value: { sessionId: "sess-1", approvalId: "appr-1", outcome: "allowed-once" },
      },
    });
  });

  it("folds not-pending into its own status (a second client already answered)", async () => {
    fake.respond.mockResolvedValueOnce({ accepted: false, reason: "not-pending" });
    const result = await relayRespond({
      answerToken: "rpc-frame-2",
      result: { ok: false, code: "cancelled", message: "answered elsewhere" },
    });
    expect(result).toEqual({ status: "not-pending" });
  });

  it("folds a host bad-response into rejected", async () => {
    fake.respond.mockResolvedValueOnce({ accepted: false, reason: "bad-response" });
    const result = await relayRespond({
      answerToken: "rpc-frame-3",
      result: { ok: true, value: { nonsense: true } },
    });
    expect(result).toEqual({ status: "rejected" });
  });

  it("folds a transport failure into transport without throwing", async () => {
    fake.respond.mockRejectedValueOnce(new Error("bridge down"));
    const result = await relayRespond({
      answerToken: "rpc-frame-4",
      result: { ok: true, value: {} },
    });
    expect(result).toEqual({ status: "transport" });
  });

  it("refuses an empty token locally, without touching the bridge", async () => {
    const result = await relayRespond({ answerToken: "", result: { ok: true, value: {} } });
    expect(result).toEqual({ status: "rejected" });
    expect(fake.respond).not.toHaveBeenCalled();
  });
});

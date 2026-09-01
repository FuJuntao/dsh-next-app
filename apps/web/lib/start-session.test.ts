/**
 * Unit tests for the startSession server action (story #117 task #119).
 *
 * The e2e suite will cover the happy home flow against a real profile
 * (task #126), but the failure branches this action exists for - bridge
 * down, business errors, the best-effort selectModel - are exactly what a
 * real profile refuses to produce on demand, so they are pinned here with
 * a mocked bridge (precedent: session-view.test.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { RpcId } from "@deepseek-ai/dsh-host-apiproxy/api";
import type { RpcResponse } from "@deepseek-ai/dsh-host-apiproxy/api";

// The action module pulls the bridge client at call time; hand it the fake
// below instead of a unix socket.
const fake = vi.hoisted(() => ({
  sessions: {
    create: vi.fn(),
    selectModel: vi.fn(),
    prompt: vi.fn(),
  },
}));

vi.mock("./bridge", () => ({
  getActionBridgeClient: () => fake,
}));

const { startSession } = await import("./start-session");

/** One typed success response; the action only reads result.value. */
function ok<T>(value: T): RpcResponse<T> {
  return { rpcId: RpcId("rpc-test"), result: { ok: true, value } };
}

/** One typed business failure; details vary per code, so they ride as given. */
function fail<T>(code: string, message: string): RpcResponse<T> {
  return {
    rpcId: RpcId("rpc-test"),
    result: { ok: false, error: { code, message, details: {} } },
  } as unknown as RpcResponse<T>;
}

/** Mock call arguments, widened for ergonomic assertions. */
function calls(fn: Mock): unknown[] {
  return fn.mock.calls.map((args) => args[0]);
}

beforeEach(() => {
  fake.sessions.create.mockReset();
  fake.sessions.selectModel.mockReset();
  fake.sessions.prompt.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("startSession - happy path", () => {
  it("runs create -> selectModel -> prompt in order with the payloads contract asks for", async () => {
    // Record the sequence: each leg logs itself, so the assertion pins the
    // create -> selectModel -> prompt order the issue prescribes.
    const order: string[] = [];
    fake.sessions.create.mockImplementationOnce(async () => {
      order.push("create");
      return ok({ sessionId: "session-1" });
    });
    fake.sessions.selectModel.mockImplementationOnce(async () => {
      order.push("selectModel");
      return ok({ selected: {} });
    });
    fake.sessions.prompt.mockImplementationOnce(async () => {
      order.push("prompt");
      return ok({ accepted: true });
    });

    const result = await startSession({
      text: "  build me a thing  ",
      cwd: "/work/thing",
      agentPreset: "builder",
      model: { provider: "acme", model: "acme-xl", reasoningEffort: "high" },
      clientTimeZone: "Asia/Shanghai",
    });

    expect(result).toEqual({ ok: true, sessionId: "session-1" });
    expect(order).toEqual(["create", "selectModel", "prompt"]);
    expect(calls(fake.sessions.create)).toEqual([{ cwd: "/work/thing", agentPreset: "builder" }]);
    expect(calls(fake.sessions.selectModel)).toEqual([
      { sessionId: "session-1", provider: "acme", model: "acme-xl", reasoningEffort: "high" },
    ]);
    // mode queue per story AC 2; the text reaches the prompt trimmed.
    expect(calls(fake.sessions.prompt)).toEqual([
      {
        sessionId: "session-1",
        mode: "queue",
        content: [{ type: "text", text: "build me a thing" }],
        clientTimeZone: "Asia/Shanghai",
      },
    ]);
  });

  it("omits absent picker fields from the wire payloads (host defaults apply)", async () => {
    fake.sessions.create.mockResolvedValueOnce(ok({ sessionId: "session-2" }));
    fake.sessions.prompt.mockResolvedValueOnce(ok({ accepted: true }));

    const result = await startSession({ text: "hello" });

    expect(result).toEqual({ ok: true, sessionId: "session-2" });
    // exactOptionalPropertyTypes on the wire: omitted keys, not undefined.
    expect(calls(fake.sessions.create)).toEqual([{}]);
    expect(fake.sessions.selectModel).not.toHaveBeenCalled();
    expect(calls(fake.sessions.prompt)).toEqual([
      { sessionId: "session-2", mode: "queue", content: [{ type: "text", text: "hello" }] },
    ]);
  });
});

describe("startSession - failure semantics (story AC 4)", () => {
  it("a create business error folds into ok:false and stops the flow", async () => {
    fake.sessions.create.mockResolvedValueOnce(fail("agent-preset-not-found", "preset gone"));

    const result = await startSession({ text: "hi", agentPreset: "gone" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("session.create failed: agent-preset-not-found");
    }
    expect(fake.sessions.prompt).not.toHaveBeenCalled();
  });

  it("a selectModel business error is logged and best-effort: the prompt still runs", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    fake.sessions.create.mockResolvedValueOnce(ok({ sessionId: "session-3" }));
    fake.sessions.selectModel.mockResolvedValueOnce(fail("model-unavailable", "provider says no"));
    fake.sessions.prompt.mockResolvedValueOnce(ok({ accepted: true }));

    const result = await startSession({
      text: "go",
      model: { provider: "acme", model: "acme-nope" },
    });

    expect(result).toEqual({ ok: true, sessionId: "session-3" });
    expect(fake.sessions.prompt).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("session.selectModel failed"));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("model-unavailable"));
  });

  it("a prompt business error folds into ok:false with the host's code and message", async () => {
    fake.sessions.create.mockResolvedValueOnce(ok({ sessionId: "session-4" }));
    fake.sessions.prompt.mockResolvedValueOnce(fail("command-error", "usage: /model <id>"));

    const result = await startSession({ text: "/model" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("session.prompt failed: command-error");
      expect(result.error).toContain("usage: /model <id>");
    }
  });

  it("a transport failure (bridge down or timeout) folds into ok:false", async () => {
    fake.sessions.create.mockRejectedValueOnce(
      new Error("cannot reach the dsh bridge: ECONNREFUSED"),
    );

    const result = await startSession({ text: "hello" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("bridge call failed");
      expect(result.error).toContain("ECONNREFUSED");
    }
  });

  it("rejects empty text before touching the bridge", async () => {
    const result = await startSession({ text: "   \n " });

    expect(result.ok).toBe(false);
    expect(fake.sessions.create).not.toHaveBeenCalled();
  });
});

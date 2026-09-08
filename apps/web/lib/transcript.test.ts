/**
 * Unit tests for the pure transcript fold (task #135 commit 3).
 *
 * These fixtures are the branches real profile data cannot produce on
 * demand (compaction replacements, unknown event types, provisional
 * reconciliations), pinned over the wire types exactly as the carrier
 * delivers them (precedent: session-view.test.ts). The catalog drift guard
 * runs LAST: a pinned-host bump that renames or adds an event type fails
 * loudly here instead of silently changing what the transcript renders.
 */
import { describe, expect, it } from "vitest";
import { KNOWN_SESSION_EVENT_TYPES } from "@deepseek-ai/dsh-session";
import type { MuxFrame } from "@deepseek-ai/dsh-host-apiproxy/api";
import {
  RENDERED_EVENT_TYPES,
  SILENT_EVENT_TYPES,
  createTranscript,
  foldDownlinkEvent,
  foldEvent,
  foldFrame,
  foldHistoryPage,
  prependHistoryPage,
  seedProjections,
  type WireEvent,
} from "./transcript";

/** One structural event fixture with the envelope defaults filled. */
function ev(
  type: string,
  seq: number,
  data: Record<string, unknown>,
  extra?: Partial<WireEvent>,
): WireEvent {
  return { type, seq, time: 1000 + seq, data, ...extra };
}

const humanSource = { kind: "user" };
const userMsg = (seq: number, text: string, source: unknown = humanSource): WireEvent =>
  ev("user/message", seq, {
    role: "user",
    id: `m${String(seq)}`,
    content: [{ type: "text", text }],
    source,
  });

const asstMsg = (seq: number, text: string, turn = 1, step = 1): WireEvent =>
  ev("assistant/message", seq, {
    turn,
    step,
    message: {
      id: `a${String(seq)}`,
      role: "assistant",
      content: [{ type: "text", text }],
      source: { kind: "model", provider: "stub", model: "scripted-1" },
    },
  });

describe("entry kinds (AC 3)", () => {
  it("folds human prompts, assistant replies, and tool pairs", () => {
    const state = createTranscript();
    foldEvent(state, ev("turn/start", 1, { turn: 1 }));
    foldEvent(state, userMsg(2, "do the thing"));
    foldEvent(state, asstMsg(3, "working"));
    foldEvent(
      state,
      ev("tool/call", 4, {
        turn: 1,
        step: 1,
        callId: "c1",
        name: "bash",
        arguments: '{"command":"ls"}',
      }),
    );
    foldEvent(
      state,
      ev("tool/result", 5, {
        turn: 1,
        step: 1,
        message: {
          id: "r1",
          role: "user",
          content: [
            {
              type: "tool-result",
              toolCallId: "c1",
              content: [{ type: "text", text: "files..." }],
              isError: false,
            },
          ],
          source: { kind: "tool", callId: "c1" },
        },
      }),
    );
    foldEvent(state, ev("turn/end", 6, { turn: 1, reason: { kind: "completed" } }));

    const kinds = state.items.map((item) => item.kind);
    expect(kinds).toEqual(["user", "assistant", "tool", "turn"]);
    const tool = state.items.find((item) => item.kind === "tool");
    expect(tool?.kind === "tool" && tool.result?.text).toBe("files...");
    // The boundary row lands at the END of the turn; liveness settled.
    const turns = state.items.filter((item) => item.kind === "turn");
    expect(turns).toHaveLength(1);
    expect(turns[0]?.kind === "turn" && turns[0].state).toBe("completed");
    expect(state.runningTurn).toBeNull();
  });

  it("marks failed and aborted turns visibly", () => {
    const state = createTranscript();
    foldEvent(state, ev("turn/start", 1, { turn: 1 }));
    foldEvent(
      state,
      ev("turn/end", 2, {
        turn: 1,
        reason: { kind: "error", error: { message: "no credential", code: "AUTH" } },
      }),
    );
    foldEvent(state, ev("turn/start", 3, { turn: 2 }));
    foldEvent(
      state,
      ev("turn/end", 4, { turn: 2, reason: { kind: "aborted", reason: { kind: "user" } } }),
    );
    const [first, second] = state.items;
    expect(first?.kind === "turn" && first.state).toBe("error");
    expect(first?.kind === "turn" && first.detail).toBe("no credential");
    expect(second?.kind === "turn" && second.state).toBe("aborted");
    expect(second?.kind === "turn" && second.detail).toBe("user");
    expect(state.runningTurn).toBeNull();
  });

  it("keeps ONE live checklist updated in place by later todo/write snapshots", () => {
    const state = createTranscript();
    foldEvent(state, userMsg(1, "start"));
    foldEvent(state, ev("todo/write", 2, { todos: [{ content: "a", status: "pending" }] }));
    foldEvent(state, asstMsg(3, "ok"));
    foldEvent(state, ev("todo/write", 4, { todos: [{ content: "a", status: "in_progress" }] }));
    const todos = state.items.filter((item) => item.kind === "todo");
    expect(todos).toHaveLength(1);
    const first = state.items[0];
    expect(first?.kind).toBe("user"); // checklist kept its position, updated in place
    const todo = todos[0];
    expect(todo?.kind === "todo" && todo.todos[0]?.status).toBe("in_progress");
  });

  it("renders synthetic context messages as context rows, not prompts", () => {
    const state = createTranscript();
    foldEvent(
      state,
      ev("user/message", 1, {
        role: "user",
        id: "m1",
        content: [{ type: "text", text: "AGENTS.md changed" }],
        source: { kind: "plugin", plugin: "instructions", form: "notice", summary: "file changed" },
      }),
    );
    const item = state.items[0];
    expect(item?.kind).toBe("context");
    expect(item?.kind === "context" && item.form).toBe("notice");
  });

  it("joins an adjacent request/context into its request/header disclosure row", () => {
    const state = createTranscript();
    foldEvent(state, ev("request/header", 1, { header: { config: {} }, reason: "initial" }));
    foldEvent(
      state,
      ev("request/context", 2, { provider: "stub", model: "scripted-1", contextWindow: 200000 }),
    );
    expect(state.items).toHaveLength(1);
    const item = state.items[0];
    expect(item?.kind === "request" && item.header?.reason).toBe("initial");
    expect(item?.kind === "request" && item.context?.model).toBe("scripted-1");
  });
});

describe("chunk merging (AC 3, AC 10)", () => {
  it("streams chunks into one bubble and settles the finalized message in place", () => {
    const state = createTranscript();
    foldEvent(state, userMsg(1, "hi"));
    foldEvent(
      state,
      ev("assistant/chunk", 2, {
        turn: 1,
        step: 1,
        chunk: { type: "text-delta", index: 0, text: "Hel" },
      }),
    );
    foldEvent(
      state,
      ev("assistant/chunk", 3, {
        turn: 1,
        step: 1,
        chunk: { type: "text-delta", index: 0, text: "lo" },
      }),
    );
    const streaming = state.items[1];
    expect(streaming?.kind === "assistant" && streaming.streaming).toBe(true);
    expect(streaming?.kind === "assistant" && streaming.text).toBe("Hello");
    // A later user message lands after the bubble; finalization must not move it.
    foldEvent(
      state,
      ev("assistant/message", 4, {
        turn: 1,
        step: 1,
        message: {
          id: "a",
          role: "assistant",
          content: [{ type: "text", text: "Hello" }],
          source: { kind: "model", provider: "stub", model: "scripted-1" },
        },
      }),
    );
    expect(state.items).toHaveLength(2);
    const settled = state.items[1];
    expect(settled?.kind === "assistant" && settled.streaming).toBe(false);
    expect(settled?.kind === "assistant" && settled.id).toBe("e4");
  });

  it("ignores step/* and never rows them; block-end replaces delta text", () => {
    const state = createTranscript();
    foldEvent(state, ev("step/start", 1, { turn: 1, step: 1 }));
    foldEvent(
      state,
      ev("assistant/chunk", 2, {
        turn: 1,
        step: 1,
        chunk: { type: "text-delta", index: 0, text: "part" },
      }),
    );
    foldEvent(
      state,
      ev("assistant/chunk", 3, {
        turn: 1,
        step: 1,
        chunk: { type: "block-end", index: 0, block: { type: "text", text: "whole" } },
      }),
    );
    foldEvent(state, ev("step/end", 4, { turn: 1, step: 1 }));
    expect(state.items).toHaveLength(1);
    expect(state.items[0]?.kind === "assistant" && state.items[0].text).toBe("whole");
  });
});

describe("surface fold (AC 6)", () => {
  /** A compacted session: two visible messages, then summary + replacement. */
  function compactedTail(): ReturnType<typeof createTranscript> {
    const state = createTranscript();
    foldEvent(state, userMsg(1, "old question"));
    foldEvent(state, asstMsg(2, "old answer"));
    foldEvent(
      state,
      ev("compaction/summary", 3, {
        compactionId: "cmp1",
        summary: [{ type: "text", text: "We discussed the old thing." }],
        shadowedRange: { start: 1, end: 2 },
        shadowedSeqs: [1, 2],
        shadowedTokenCount: 10,
        provider: "stub",
        model: "scripted-1",
        rawOutput: [],
        llmStreamCall: true,
      }),
    );
    foldEvent(
      state,
      ev(
        "user/message",
        4,
        {
          role: "user",
          id: "cmp",
          content: [{ type: "text", text: "We discussed the old thing." }],
          source: { kind: "plugin", plugin: "compaction" },
        },
        { surfaceOp: { op: "replace", start: 1, end: 2 }, sourceEventSeqs: [1, 2] },
      ),
    );
    return state;
  }

  it("removes shadowed nodes, keeps the divider, renders history once", () => {
    const state = compactedTail();
    const kinds = state.items.map((item) => item.kind);
    expect(kinds).toEqual(["compaction"]); // the two shadowed rows are gone; the copy adds none
    const divider = state.items[0];
    expect(divider?.kind === "compaction" && divider.summary).toContain("old thing");
    expect(divider?.kind === "compaction" && divider.shadowedCount).toBe(2);
  });

  it("applies the fold across page boundaries: an older page contributes nothing shadowed", () => {
    const state = compactedTail();
    // Now Load older delivers the page the shadowed seqs live on (as would
    // a re-sync overlap): the shadow memory must keep them out.
    prependHistoryPage(
      state,
      [
        { event: userMsg(1, "old question") as never },
        { event: asstMsg(2, "old answer") as never },
      ],
      { hasMore: true },
    );
    expect(state.items.map((item) => item.kind)).toEqual(["compaction"]);
    expect(state.hasMore).toBe(true);
  });
});

describe("fail-loud unknowns (AC 7)", () => {
  it("renders a marker for an unrecognized required type and keeps folding", () => {
    const state = createTranscript();
    foldEvent(state, userMsg(1, "hi"));
    foldEvent(state, ev("future/thought", 2, { whatever: true }));
    foldEvent(state, asstMsg(3, "hello"));
    const unsupported = state.items.find((item) => item.kind === "unsupported");
    expect(unsupported?.kind === "unsupported" && unsupported.type).toBe("future/thought");
    expect(state.items).toHaveLength(3);
  });

  it("skips ignorable unknowns silently", () => {
    const state = createTranscript();
    foldEvent(state, ev("future/noise", 1, {}, { ignorable: true }));
    expect(state.items).toHaveLength(0);
    expect(state.lastSeq).toBe(1); // the seq is still consumed (dedupe keeps working)
  });
});

describe("send receipt (AC 13, as amended on #134)", () => {
  it("appends exactly one row, from the host's durable event, stamped with its rpcId", () => {
    const state = createTranscript();
    foldEvent(state, userMsg(1, "first", humanSource));
    foldEvent(
      state,
      ev("user/message", 2, {
        role: "user",
        id: "m2",
        content: [{ type: "text", text: "second" }],
        source: { kind: "user", rpcId: "rpc-9" },
      }),
    );
    const users = state.items.filter((item) => item.kind === "user");
    expect(users).toHaveLength(2);
    const row = users[1];
    expect(row?.kind === "user" && row.rpcId).toBe("rpc-9");
    expect(row?.kind === "user" && row.seq).toBe(2); // durable, always
  });

  it("a re-delivered echo (resync overlap) still produces one row", () => {
    const state = createTranscript();
    const echo = ev("user/message", 5, {
      role: "user",
      id: "m5",
      content: [{ type: "text", text: "twice" }],
      source: { kind: "user", rpcId: "rpc-9" },
    });
    foldEvent(state, echo);
    foldEvent(state, echo);
    expect(state.items.filter((item) => item.kind === "user")).toHaveLength(1);
  });
});

describe("live frames", () => {
  const subscribed = (lastSeq: number): MuxFrame =>
    ({ type: "session/subscribed", sessionId: "sess-a", lastSeq }) as unknown as MuxFrame;

  it("folds session/event frames through the same model and dedupes overlap by seq", () => {
    const state = createTranscript();
    const message = userMsg(1, "live");
    foldFrame(state, {
      type: "session/event",
      sessionId: "sess-a",
      event: message,
    } as unknown as MuxFrame);
    foldFrame(state, {
      type: "session/event",
      sessionId: "sess-a",
      event: message,
    } as unknown as MuxFrame);
    expect(state.items).toHaveLength(1);
    expect(state.lastSeq).toBe(1);
  });

  it("records subscribed.lastSeq for the gap check", () => {
    const state = createTranscript();
    foldFrame(state, subscribed(7));
    expect(state.subscribedLastSeq).toBe(7);
  });

  it("keeps both human placements in the strip and hides context items (AC 13/14)", () => {
    const state = createTranscript();
    const message = (text: string): unknown => ({
      id: "x",
      role: "user",
      content: [{ type: "text", text }],
      source: { kind: "user" },
    });
    foldFrame(state, {
      type: "session/queue",
      sessionId: "sess-a",
      items: [
        { id: "i1", placement: "queued", message: message("queued one") },
        { id: "i2", placement: "steering", message: message("steering") },
        { id: "i3", placement: "context", message: message("context") },
      ],
    } as unknown as MuxFrame);
    // The steer is the case that used to be invisible: the host claims it at
    // the NEXT STEP, so a steer into a blocked turn had no row anywhere.
    expect(state.queue).toEqual([
      { id: "i1", text: "queued one", placement: "queued" },
      { id: "i2", text: "steering", placement: "steering" },
    ]);
    foldFrame(state, {
      type: "session/queue",
      sessionId: "sess-a",
      items: [],
    } as unknown as MuxFrame);
    expect(state.queue).toEqual([]); // claimed -> the strip empties
  });

  it("keeps projections under higher-seq-wins, seeded by the tail block (AC 11)", () => {
    const state = createTranscript();
    seedProjections(state, { asOfSeq: 5, values: { title: "Seeded" } });
    foldFrame(state, {
      type: "session/projection",
      sessionId: "sess-a",
      key: "title",
      value: "Stale",
      seq: 4,
    } as unknown as MuxFrame);
    expect(state.projections["title"]).toEqual({ value: "Seeded", seq: 5 });
    foldFrame(state, {
      type: "session/projection",
      sessionId: "sess-a",
      key: "title",
      value: "Fresh",
      seq: 9,
    } as unknown as MuxFrame);
    expect(state.projections["title"]).toEqual({ value: "Fresh", seq: 9 });
  });

  it("opens answerable cards with their token and settles them from resolved frames (AC 16)", () => {
    const state = createTranscript();
    const approval = {
      type: "approval/requested",
      sessionId: "sess-a",
      approvalId: "ap1",
      toolName: "bash",
      reason: "rm",
    } as unknown as MuxFrame;
    foldDownlinkEvent(state, approval, "tok-1");
    foldDownlinkEvent(state, approval, "tok-1"); // replay -> still one card
    expect(state.pending).toHaveLength(1);
    expect(state.pending[0]?.answerToken).toBe("tok-1");
    expect(state.pending[0]?.state).toBe("pending");
    foldFrame(state, {
      type: "approval/resolved",
      sessionId: "sess-a",
      approvalId: "ap1",
      outcome: "allowed-once",
    } as unknown as MuxFrame);
    expect(state.pending[0]?.state).toBe("resolved");
    expect(state.pending[0]?.outcome).toBe("allowed-once"); // settled by ANOTHER client is fine
  });

  it("settles question batches by their stable token", () => {
    const state = createTranscript();
    const question = {
      type: "question/requested",
      sessionId: "sess-a",
      questions: [{ id: "q1", question: "Which?", options: [{ label: "A" }, { label: "B" }] }],
    } as unknown as MuxFrame;
    foldDownlinkEvent(state, question, "ask-rpc-1");
    expect(state.pending).toHaveLength(1);
    expect(state.pending[0]?.kind).toBe("question");
    foldFrame(state, {
      type: "question/resolved",
      sessionId: "sess-a",
      questionRpcId: "ask-rpc-1",
      outcome: "answered",
    } as unknown as MuxFrame);
    expect(state.pending[0]?.state).toBe("resolved");
    expect(state.pending[0]?.outcome).toBe("answered");
  });

  it("consumes out-of-story and error frames without a row or state", () => {
    const state = createTranscript();
    foldFrame(state, {
      type: "session/jobs",
      sessionId: "sess-a",
      jobs: [],
    } as unknown as MuxFrame);
    expect(state.items).toHaveLength(0);
    // `stream/error` rides the same path: the reader's throw is what drives
    // the reconnect (use-session-live), so the fold keeps no copy of it.
    foldFrame(state, {
      type: "stream/error",
      error: { code: "internal", message: "boom", details: {} },
    } as unknown as MuxFrame);
    expect(state.items).toHaveLength(0);
    expect(state.subscribedLastSeq).toBeNull();
  });
});

describe("history pages", () => {
  it("foldHistoryPage tails the page and tracks hasMore", () => {
    const state = createTranscript();
    foldHistoryPage(
      state,
      [{ event: userMsg(1, "a") as never }, { event: asstMsg(2, "b") as never }],
      { hasMore: false },
    );
    expect(state.items).toHaveLength(2);
    expect(state.hasMore).toBe(false);
    expect(state.lastSeq).toBe(2);
  });
});

describe("tool views (AC 4)", () => {
  it("keeps the call view and the result view on one card", () => {
    const state = createTranscript();
    const callView = { card: "terminal", title: "ls -al", description: "List files" } as never;
    const resultView = { card: "terminal", output: "total 3\nfile.txt", exitCode: 0 } as never;
    foldEvent(state, userMsg(1, "hi"));
    foldEvent(
      state,
      ev("tool/call", 2, { turn: 1, step: 1, callId: "c1", name: "bash", arguments: "{}" }),
      { for: "call", view: callView } as never,
    );
    foldEvent(
      state,
      ev("tool/result", 3, {
        turn: 1,
        step: 1,
        message: {
          id: "r1",
          role: "user",
          content: [
            {
              type: "tool-result",
              toolCallId: "c1",
              content: [{ type: "text", text: "total 3\nfile.txt" }],
              isError: false,
            },
          ],
          source: { kind: "tool", callId: "c1" },
        },
      }),
      { for: "result", view: resultView } as never,
    );
    const tool = state.items.find((item) => item.kind === "tool");
    expect(tool?.kind === "tool" && tool.callView).toBeDefined();
    expect(tool?.kind === "tool" && tool.resultView).toBeDefined();
    expect(tool?.kind === "tool" && (tool.callView as { title?: string }).title).toBe("ls -al");
  });
});

describe("a steer converges from strip to row exactly once (AC 13/14)", () => {
  const steerFrame = (text: string): MuxFrame =>
    ({
      type: "session/queue",
      sessionId: "sess-a",
      items: [
        {
          id: "s1",
          placement: "steering",
          message: { role: "user", content: [{ type: "text", text }] },
        },
      ],
    }) as unknown as MuxFrame;

  it("strip first, then the durable row: one row, and the strip drains", () => {
    const state = createTranscript();
    foldFrame(state, steerFrame("hold on, change of plan"));
    expect(state.queue).toHaveLength(1); // visible the moment the host took it
    expect(state.items).toHaveLength(0); // and no transcript row yet

    foldEvent(
      state,
      ev("user/message", 9, {
        role: "user",
        id: "m9",
        content: [{ type: "text", text: "hold on, change of plan" }],
        source: { kind: "user", rpcId: "rpc-3" },
      }),
    );
    foldFrame(state, {
      type: "session/queue",
      sessionId: "sess-a",
      items: [],
    } as unknown as MuxFrame);
    expect(state.items).toHaveLength(1); // the row it was always going to be
    expect(state.queue).toHaveLength(0);
  });

  it("a discarded steer leaves nothing behind", () => {
    const state = createTranscript();
    foldFrame(state, steerFrame("never claimed"));
    foldFrame(state, {
      type: "session/queue",
      sessionId: "sess-a",
      items: [],
    } as unknown as MuxFrame);
    expect(state.items).toHaveLength(0); // it was never in the session
    expect(state.queue).toHaveLength(0);
  });
});

describe("catalog drift guard", () => {
  const handled = new Set<string>([...RENDERED_EVENT_TYPES, ...SILENT_EVENT_TYPES]);

  it("handles every event type the pinned host catalog knows", () => {
    const missed = [...KNOWN_SESSION_EVENT_TYPES].filter((type) => !handled.has(type));
    expect(missed, `new host event types need a transcript decision: ${missed.join(", ")}`).toEqual(
      [],
    );
  });

  it("lists no event types the pinned host catalog forgot", () => {
    const stale = [...handled].filter((type) => !KNOWN_SESSION_EVENT_TYPES.has(type));
    expect(stale, `event types this app invented or the host dropped: ${stale.join(", ")}`).toEqual(
      [],
    );
  });

  it("keeps the rendered and silent sets disjoint", () => {
    const rendered = new Set<string>(RENDERED_EVENT_TYPES);
    const overlap = SILENT_EVENT_TYPES.filter((type) => rendered.has(type));
    expect(overlap).toEqual([]);
  });
});

/**
 * Pure transcript model shared by the server and the client bundle
 * (story #134 task #135 commit 3) - the `session-view.ts` pattern applied
 * to the conversation itself.
 *
 * The same functions fold the durable history a page carries (a
 * `session.history` page is `HistoryEntry[]`: raw `SessionEvent`s plus the
 * optional host-computed `ToolEventView`) and the live `MuxFrame`s the
 * downlink streams into ONE ordered model, so a first paint and a live
 * append cannot disagree about what the transcript looks like. Ordering
 * across pages follows the host's guarantee that a page is a contiguous
 * raw-event range aligned to append-origin message boundaries; a
 * `compaction/summary` record stays on the page of the replacement citing
 * it.
 *
 * The rules this module owns (AC 3, 6, 7, 10, 13, 14):
 *   - Entry kinds: `user/message` (human prompts), synthetic context
 *     messages, `assistant/message`, `tool/call` + `tool/result` paired by
 *     callId, `turn/start`/`turn/end` boundaries (failed/aborted turns
 *     marked visibly), `todo/write` as ONE live checklist (snapshot
 *     semantics: a later write updates the card in place), `request/header`
 *     / `request/context` as disclosure rows (an adjacent context row
 *     joins its header), and `compaction/summary` as the divider.
 *     `assistant/chunk` never renders as its own row - it extends the
 *     streaming bubble for its `turn:step`, which the finalized
 *     `assistant/message` then replaces in place; `step/*` never rows.
 *   - The surface fold: a surface event carrying
 *     `surfaceOp: {op: 'replace', ...}` removes the transcript items of the
 *     surface seqs it shadows and remembers them, so a page loaded LATER
 *     (an older page, or a re-sync overlap) contributes nothing the
 *     replacement already erased - "no history appears twice" across page
 *     boundaries (AC 6).
 *   - Fail-loud unknowns (AC 7): a `type` outside the handled vocabulary
 *     renders a visible unsupported-record marker unless it carries
 *     `ignorable: true` (skipped silently); the rest of the fold still
 *     applies. The vocabulary is EXPLICIT and drift-guarded against the
 *     pinned host catalog by the unit tests - never "everything else
 *     renders nothing".
 *   - Optimistic echoes (AC 13): a provisional user row keyed by the
 *     prompt's rpcId is reconciled in place by the durable `user/message`
 *     carrying that rpcId, marked failed when the send failed, and
 *     withdrawn when the host discards it.
 *   - Live control frames: `session/queue` replaces the queued strip
 *     wholesale (`queued` placement only - steering rides the provisional
 *     row), `session/projection` cells win by seq, `session/subscribed
 *     .lastSeq` is recorded for the caller's gap check, answerable
 *     approval/question frames become cards settling from their resolved
 *     frames (any client's answer included), and `stream/error` is
 *     recorded for the caller's reconnect path.
 *
 * Purity contract: no node imports, no react, no fetch - the only package
 * references are types from the pinned wire contracts, erased at compile.
 * Raw events are read STRUCTURALLY (the union's members do not all carry
 * `surfaceOp`/`sourceEventSeqs`, and plugin-merged event types are invisible
 * to this package's view of the map); the carrier has already zod-validated
 * every frame, so the structural read is total, not defensive.
 */
import type {
  HistoryEntry,
  MuxFrame,
  ToolCallView,
  ToolEventView,
  ToolResultView,
} from "@deepseek-ai/dsh-host-apiproxy/api";
import type { SessionEvent, SurfaceOp } from "@deepseek-ai/dsh-session/types";

// ---------------------------------------------------------------------------
// Structural wire view (the carrier validated these; read, don't re-guess)
// ---------------------------------------------------------------------------

/** One answerable frame, structurally (the union members this fold stores). */
export type AnswerableFrame = Extract<
  MuxFrame,
  { type: "approval/requested" } | { type: "question/requested" }
>;

/** Any session event, read structurally (see the header note). */
export interface WireEvent {
  type: string;
  seq: number;
  time: number;
  data: Record<string, unknown>;
  ignorable?: true;
  surfaceOp?: SurfaceOp;
  sourceEventSeqs?: number[];
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function optStr(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

// ---------------------------------------------------------------------------
// Render items
// ---------------------------------------------------------------------------

/**
 * A durable image reference for rendering (the display subset of the
 * attachment package's `ImageAttachmentRef`; `attachmentId` is what the
 * attachment route is asked for - never a host path).
 */
export interface TranscriptImage {
  attachmentId: string;
  mediaType: string;
  bytes: number;
  width: number;
  height: number;
  name?: string;
}

/** A durable or provisional human prompt row. */
export interface UserItem {
  kind: "user";
  /** Stable item id: `e<seq>` durable, `p<rpcId>` provisional. */
  id: string;
  seq: number | null;
  time: number;
  text: string;
  images: TranscriptImage[];
  /** The prompt's rpcId when recorded (reconciles the provisional echo). */
  rpcId?: string;
  /** True while the durable event has not replaced the optimistic echo. */
  provisional?: boolean;
  /** True when the send itself failed (kept visible; AC 13). */
  failed?: boolean;
}

/** A synthetic (non-human) context message (injected instructions, notices...). */
export interface ContextItem {
  kind: "context";
  id: string;
  seq: number;
  time: number;
  /** Producer identity for the disclosure label (plugin name or source kind). */
  source: string;
  /** Declared context form (notice/catalog/snapshot/...), when any. */
  form?: string;
  /** The host-bound one-line account for `notice` forms. */
  summary?: string;
  text: string;
}

/** An assistant bubble - streamed into from chunks, settled by the final message. */
export interface AssistantItem {
  kind: "assistant";
  /** `s<turn>:<step>` while streaming, `e<seq>` once finalized. */
  id: string;
  seq: number | null;
  time: number;
  turn: number;
  step: number;
  text: string;
  reasoning: string;
  /** True while only chunks have landed (open fences stay plain until closed). */
  streaming: boolean;
  /** The finalize marker: a cancelled turn's delivered prefix. */
  interrupted?: boolean;
  model?: string;
}

/** The model-facing result folded into a tool item when it lands. */
export interface ToolResultFold {
  text: string;
  isError: boolean;
  images: TranscriptImage[];
}

/** A tool call, paired with its result by callId. */
export interface ToolItem {
  kind: "tool";
  id: string;
  seq: number;
  time: number;
  turn: number;
  step: number;
  callId: string;
  name: string;
  /** The raw JSON arguments string exactly as the model produced it. */
  arguments: string;
  result?: ToolResultFold;
  /** The tool's own failure identity (distinct from an isError result). */
  error?: { name: string; code: string };
  /** Host-computed render intents, kept separately for the call and the
   * result (each arrives on its own event; AC 4 renders them on one card). */
  callView?: ToolCallView;
  resultView?: ToolResultView;
}

/** The live checklist row: one at a time, kept current by `todo/write`. */
export interface TodoFoldItem {
  kind: "todo";
  id: string;
  seq: number;
  time: number;
  todos: readonly { content: string; status: string }[];
}

/** The compaction divider: the summary text and what it shadowed. */
export interface CompactionItem {
  kind: "compaction";
  id: string;
  seq: number;
  time: number;
  summary: string;
  provider: string;
  model: string;
  /** Surface nodes the replacement shadowed (settled when the copy lands). */
  shadowedCount: number;
}

/** A `request/header` / `request/context` row (the collapsed disclosure). */
export interface RequestItem {
  kind: "request";
  id: string;
  seq: number;
  time: number;
  header?: { reason: string };
  context?: { provider: string; model: string; contextWindow?: number };
}

/** Turn boundary; non-completed endings carry the visible mark (AC 3). */
export interface TurnItem {
  kind: "turn";
  id: string;
  seq: number;
  turn: number;
  state: "running" | "completed" | "aborted" | "blocked" | "error" | "max-tokens" | "interrupted";
  /** Displayable failure detail for `error`/`aborted` endings. */
  detail?: string;
}

/** AC 7's fail-loud row. */
export interface UnsupportedItem {
  kind: "unsupported";
  id: string;
  seq: number;
  time: number;
  type: string;
}

/** The durable audit pair (`approval/asked` + `approval/decided`) as one row. */
export interface ApprovalRowItem {
  kind: "approval-row";
  id: string;
  seq: number;
  time: number;
  approvalId: string;
  toolName: string;
  reason?: string;
  outcome?: string;
}

/** Any transcript row. */
export type TranscriptItem =
  | UserItem
  | ContextItem
  | AssistantItem
  | ToolItem
  | TodoFoldItem
  | CompactionItem
  | RequestItem
  | TurnItem
  | UnsupportedItem
  | ApprovalRowItem;

// ---------------------------------------------------------------------------
// Tail overlays (live surfaces, not durable rows)
// ---------------------------------------------------------------------------

/** One pending `queued` inbox item (AC 14; read-only in this story). */
export interface QueuedItem {
  id: string;
  text: string;
}

/** A pending answerable card (approval ask or question batch). */
export interface PendingCard {
  id: string;
  kind: "approval" | "question";
  state: "pending" | "resolved";
  /** Present while pending: the token the respond relay echoes. */
  answerToken?: string;
  /** The settled outcome once any client (or the terminal) answered. */
  outcome?: string;
  frame: AnswerableFrame;
}

// ---------------------------------------------------------------------------
// Fold state
// ---------------------------------------------------------------------------

/** One projection cell kept under higher-seq-wins (AC 11's title rides it). */
export interface ProjectionCell {
  value: unknown;
  seq: number;
}

/** The complete fold state. */
export interface TranscriptState {
  items: TranscriptItem[];
  /** Surface seqs shadowed by a later replacement (cross-page memory). */
  shadowed: Set<number>;
  /** Raw event seqs already folded (page-overlap / re-sync dedupe). */
  seen: Set<number>;
  /** Highest folded durable seq (the gap check against subscribed.lastSeq). */
  lastSeq: number;
  /** The tail page's `hasMore` (drives the Load older control, AC 8). */
  hasMore: boolean;
  /** The turn currently between `turn/start` and `turn/end` (AC 15 liveness). */
  runningTurn: number | null;
  /** The `turn/start` time of that turn: the tail's live line reads it so
   * "Working" also says how long the wait has been (null while idle). */
  runningSince: number | null;
  /** Latest `session/subscribed.lastSeq` control value, once seen. */
  subscribedLastSeq: number | null;
  /** The last `stream/error` frame (the island's reconnect trigger reads it). */
  streamError: Extract<MuxFrame, { type: "stream/error" }>["error"] | null;
  pending: PendingCard[];
  queue: QueuedItem[];
  /** Per-projection-unit cells (title, imageLimits, ...). */
  projections: Record<string, ProjectionCell>;
}

/** Fresh empty state - a blank session renders this with no rows (AC 23). */
export function createTranscript(): TranscriptState {
  return {
    items: [],
    shadowed: /* @__PURE__ */ new Set(),
    seen: /* @__PURE__ */ new Set(),
    lastSeq: -1,
    hasMore: false,
    runningTurn: null,
    runningSince: null,
    subscribedLastSeq: null,
    streamError: null,
    pending: [],
    queue: [],
    projections: {},
  };
}

// ---------------------------------------------------------------------------
// The handled vocabulary (AC 7's "recognized" line; drift-tested)
// ---------------------------------------------------------------------------

/** Event types that produce or update transcript rows. */
export const RENDERED_EVENT_TYPES = [
  "turn/start",
  "turn/end",
  "user/message",
  "assistant/chunk", // merges into the streaming bubble - never its own row
  "assistant/message",
  "tool/call",
  "tool/result",
  "todo/write",
  "request/header",
  "request/context",
  "compaction/summary",
  "approval/asked",
  "approval/decided",
] as const;

/** Known event types consumed without a row of their own (documented above). */
export const SILENT_EVENT_TYPES = [
  "step/start",
  "step/end",
  "session/end-seed",
  "session/title", // title renders from the projection, not the audit row
  "session/title-llm-request",
  "compaction/start",
  "compaction/end",
  "compaction/prune", // its fact rides the replacement + summary pair
  "approval/policy",
  "permission/preset",
  "sandbox/mode",
  "plan/mode",
  "goal/change",
  "schedule/change",
  "command/run",
  "command/done",
  "hook/invoked",
  "hook/result",
  "llm/retry",
  "llm/retry-started",
  "feedback/record",
  "agent/inbox/spliced",
  "agent-preset/selected",
  "subagent/descriptor",
  "team/member",
  "team/message/delivered",
  "team/message/queued",
  "team/task",
  "tool-workflow/agent-end",
  "tool-workflow/agent-start",
  "tool-workflow/run-end",
  "tool-workflow/run-start",
  "tool/code-dispatch",
  "tool/code-dispatch-start",
  "web/deepseek-search-llm-request",
] as const;

/** Everything the fold handles; anything else is the fail-loud branch. */
const HANDLED_EVENT_TYPES: ReadonlySet<string> = new Set<string>([
  ...RENDERED_EVENT_TYPES,
  ...SILENT_EVENT_TYPES,
]);

const SILENT_SET: ReadonlySet<string> = new Set<string>(SILENT_EVENT_TYPES);

// ---------------------------------------------------------------------------
// Content-shape parsing (the durable user/message spike parser)
// ---------------------------------------------------------------------------

/** The transcript-side parse of a content-block array (text, reasoning, images). */
export function parseContentBlocks(content: readonly unknown[]): {
  text: string;
  reasoning: string;
  images: TranscriptImage[];
} {
  const texts: string[] = [];
  const reasonings: string[] = [];
  const images: TranscriptImage[] = [];
  for (const block of content) {
    if (block === null || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if (b["type"] === "text") texts.push(str(b["text"]));
    else if (b["type"] === "reasoning") reasonings.push(str(b["text"]));
    else if (b["type"] === "image") {
      const ref = b["attachment"];
      if (ref !== null && typeof ref === "object") {
        const r = ref as Record<string, unknown>;
        const name = optStr(r["name"]);
        images.push({
          attachmentId: str(r["attachmentId"]),
          mediaType: str(r["mediaType"]),
          bytes: typeof r["bytes"] === "number" ? r["bytes"] : 0,
          width: typeof r["width"] === "number" ? r["width"] : 0,
          height: typeof r["height"] === "number" ? r["height"] : 0,
          ...(name !== undefined ? { name } : {}),
        });
      }
    }
    // tool-call / tool-result blocks ride their own transcript rows (the
    // tool/call + tool/result events); a content parse ignores them.
  }
  return { text: texts.join("\n\n"), reasoning: reasonings.join("\n\n"), images };
}

function blocksOf(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

// ---------------------------------------------------------------------------
// The durable-event fold (history entries and live session/event frames)
// ---------------------------------------------------------------------------

function durableId(seq: number): string {
  return `e${String(seq)}`;
}

function stepKey(turn: number, step: number): string {
  return `s${String(turn)}:${String(step)}`;
}

/**
 * Apply one raw event (from a history entry or a live `session/event`
 * frame). Idempotent per seq: a page that overlaps what was already folded
 * (resync) contributes nothing twice.
 */
export function foldEvent(
  state: TranscriptState,
  raw: SessionEvent | WireEvent,
  view?: ToolEventView,
): void {
  // The carrier zod-validated this event already; the structural view is a
  // compile-time read, not a runtime guess.
  const event = raw as unknown as WireEvent;
  const { seq } = event;

  if (state.seen.has(seq)) return;
  state.seen.add(seq);
  if (seq > state.lastSeq) state.lastSeq = seq;

  const data = event.data ?? {};

  // AC 7: an unrecognized type is a visible marker unless the log says it
  // may be skipped; either way the rest of the fold proceeds.
  if (!HANDLED_EVENT_TYPES.has(event.type)) {
    if (event.ignorable !== true) {
      state.items.push({
        kind: "unsupported",
        id: durableId(seq),
        seq,
        time: event.time,
        type: event.type,
      });
    }
    return;
  }
  if (SILENT_SET.has(event.type)) return;

  const isReplacement =
    typeof event.surfaceOp === "object" &&
    event.surfaceOp !== null &&
    event.surfaceOp.op === "replace";

  // Cross-page compaction memory: an ordinary event a later replacement
  // already shadowed contributes nothing (its row was erased by design).
  if (!isReplacement && state.shadowed.has(seq)) return;

  switch (event.type) {
    case "user/message": {
      const parsed = parseContentBlocks(blocksOf(data["content"]));
      const source = (data["source"] ?? {}) as Record<string, unknown>;
      if (isReplacement) {
        // The compaction copy: shadow the range's rows (the divider from
        // the paired `compaction/summary` already renders the summary),
        // never a user row of its own.
        const shadowed = event.sourceEventSeqs ?? [];
        for (const shadowedSeq of shadowed) {
          state.shadowed.add(shadowedSeq);
        }
        state.items = state.items.filter(
          (item) => !(item.seq !== null && state.shadowed.has(item.seq)),
        );
        for (const item of state.items) {
          if (item.kind === "compaction" && item.seq < seq) {
            item.shadowedCount = shadowed.length;
            break;
          }
        }
        break;
      }
      if (source["kind"] === "user") {
        const rpcId = optStr(source["rpcId"]);
        const item: UserItem = {
          kind: "user",
          id: durableId(seq),
          seq,
          time: event.time,
          text: parsed.text,
          images: parsed.images,
          ...(rpcId !== undefined ? { rpcId } : {}),
        };
        const provisionalIndex =
          rpcId !== undefined
            ? state.items.findIndex(
                (existing) =>
                  existing.kind === "user" &&
                  existing.provisional === true &&
                  existing.rpcId === rpcId,
              )
            : -1;
        if (provisionalIndex !== -1)
          state.items[provisionalIndex] = item; // AC 13 settle
        else state.items.push(item);
      } else {
        const form = optStr(source["form"]);
        const summary = optStr(source["summary"]);
        const item: ContextItem = {
          kind: "context",
          id: durableId(seq),
          seq,
          time: event.time,
          source: optStr(source["plugin"]) ?? str(source["kind"]),
          ...(form !== undefined ? { form } : {}),
          ...(summary !== undefined ? { summary } : {}),
          text: parsed.text,
        };
        state.items.push(item);
      }
      break;
    }
    case "assistant/chunk": {
      const turn = data["turn"] as number;
      const step = data["step"] as number;
      const chunk = (data["chunk"] ?? {}) as Record<string, unknown>;
      const id = stepKey(turn, step);
      let bubble = state.items.find(
        (item): item is AssistantItem => item.kind === "assistant" && item.id === id,
      );
      if (bubble === undefined) {
        bubble = {
          kind: "assistant",
          id,
          seq: null,
          time: event.time,
          turn,
          step,
          text: "",
          reasoning: "",
          streaming: true,
        };
        state.items.push(bubble);
      }
      switch (chunk["type"]) {
        case "text-delta":
          bubble.text += str(chunk["text"]);
          break;
        case "reasoning-delta":
          bubble.reasoning += str(chunk["text"]);
          break;
        case "block-end": {
          // A finalized block's whole text replaces what deltas assembled.
          const block = (chunk["block"] ?? {}) as Record<string, unknown>;
          if (block["type"] === "text") bubble.text = str(block["text"]);
          else if (block["type"] === "reasoning") bubble.reasoning = str(block["text"]);
          break;
        }
        default:
          // usage / finish / tool-call-delta chunks render no text: tool
          // calls ride their own rows (AC 3).
          break;
      }
      break;
    }
    case "assistant/message": {
      const turn = data["turn"] as number;
      const step = data["step"] as number;
      const message = (data["message"] ?? {}) as Record<string, unknown>;
      const parsed = parseContentBlocks(blocksOf(message["content"]));
      const source = (message["source"] ?? {}) as Record<string, unknown>;
      const interrupted = data["interrupted"] === true;
      const item: AssistantItem = {
        kind: "assistant",
        id: durableId(seq),
        seq,
        time: event.time,
        turn,
        step,
        text: parsed.text,
        reasoning: parsed.reasoning,
        streaming: false,
        ...(interrupted ? { interrupted: true } : {}),
        ...(source["kind"] === "model" && optStr(source["model"]) !== undefined
          ? { model: source["model"] as string }
          : {}),
      };
      // The finalized message settles over the streaming bubble IN PLACE
      // (AC 10) - or simply lands when the tail page carried no partial.
      const index = state.items.findIndex(
        (existing) =>
          existing.id === item.id ||
          (existing.kind === "assistant" && existing.id === stepKey(turn, step)),
      );
      if (index === -1) state.items.push(item);
      else state.items[index] = item;
      break;
    }
    case "tool/call": {
      const item: ToolItem = {
        kind: "tool",
        id: durableId(seq),
        seq,
        time: event.time,
        turn: data["turn"] as number,
        step: data["step"] as number,
        callId: str(data["callId"]),
        name: str(data["name"]),
        arguments: str(data["arguments"]),
        ...(view !== undefined && view.for === "call" ? { callView: view.view } : {}),
      };
      state.items.push(item);
      break;
    }
    case "tool/result": {
      const message = (data["message"] ?? {}) as Record<string, unknown>;
      const source = (message["source"] ?? {}) as Record<string, unknown>;
      const callId = optStr(source["callId"]);
      const resultBlock = blocksOf(message["content"])
        .map((b) =>
          b !== null && typeof b === "object" ? (b as Record<string, unknown>) : undefined,
        )
        .find((b) => b?.["type"] === "tool-result");
      const parsed = parseContentBlocks(blocksOf(resultBlock?.["content"]));
      const error = data["error"] as { name?: string; code?: string } | undefined;
      const fold: ToolResultFold = {
        text: parsed.text,
        isError: resultBlock?.["isError"] === true || error !== undefined,
        images: parsed.images,
      };
      const target =
        callId !== undefined
          ? state.items.find(
              (item): item is ToolItem =>
                item.kind === "tool" && item.callId === callId && item.result === undefined,
            )
          : undefined;
      if (target !== undefined) {
        target.result = fold;
        if (error !== undefined) {
          target.error = { name: str(error["name"]), code: str(error["code"]) };
        }
        if (view !== undefined && view.for === "result") target.resultView = view.view;
      } else {
        // Orphan result (its call was shadowed or dropped): show the fact
        // it happened rather than lose it.
        const item: ToolItem = {
          kind: "tool",
          id: durableId(seq),
          seq,
          time: event.time,
          turn: data["turn"] as number,
          step: data["step"] as number,
          callId: callId ?? "",
          name: "(result only)",
          arguments: "",
          result: fold,
          ...(error !== undefined
            ? { error: { name: str(error["name"]), code: str(error["code"]) } }
            : {}),
        };
        state.items.push(item);
      }
      break;
    }
    case "todo/write": {
      const todos = blocksOf(data["todos"])
        .map((t) =>
          t !== null && typeof t === "object" ? (t as Record<string, unknown>) : undefined,
        )
        .filter((t): t is Record<string, unknown> => t !== undefined)
        .map((t) => ({ content: str(t["content"]), status: str(t["status"]) }));
      const existing = state.items.find((item) => item.kind === "todo");
      const item: TodoFoldItem = {
        kind: "todo",
        id: existing?.id ?? durableId(seq),
        seq,
        time: event.time,
        todos,
      };
      if (existing !== undefined) {
        const index = state.items.indexOf(existing);
        state.items[index] = item; // one live checklist, updated in place
      } else {
        state.items.push(item);
      }
      break;
    }
    case "request/header": {
      const item: RequestItem = {
        kind: "request",
        id: durableId(seq),
        seq,
        time: event.time,
        header: { reason: str(data["reason"]) },
      };
      state.items.push(item);
      break;
    }
    case "request/context": {
      const contextWindow = data["contextWindow"];
      const context = {
        provider: str(data["provider"]),
        model: str(data["model"]),
        ...(typeof contextWindow === "number" ? { contextWindow } : {}),
      };
      const previous = state.items[state.items.length - 1];
      if (previous !== undefined && previous.kind === "request" && previous.context === undefined) {
        previous.context = context; // one disclosure for the pair
      } else {
        state.items.push({ kind: "request", id: durableId(seq), seq, time: event.time, context });
      }
      break;
    }
    case "compaction/summary": {
      const parsed = parseContentBlocks(blocksOf(data["summary"]));
      const item: CompactionItem = {
        kind: "compaction",
        id: durableId(seq),
        seq,
        time: event.time,
        summary: parsed.text,
        provider: str(data["provider"]),
        model: str(data["model"]),
        shadowedCount: blocksOf(data["shadowedSeqs"]).length,
      };
      state.items.push(item);
      break;
    }
    case "turn/start": {
      // Liveness only - the boundary row lands with turn/end, where a
      // failure reads at the end of the turn it broke (AC 3's visible
      // mark, and the composer's stop control keys off runningTurn).
      state.runningTurn = data["turn"] as number;
      state.runningSince = event.time;
      break;
    }
    case "turn/end": {
      const turn = data["turn"] as number;
      const reason = (data["reason"] ?? {}) as Record<string, unknown>;
      const kind = str(reason["kind"]);
      let detail: string | undefined;
      if (kind === "error") {
        const failure = (reason["error"] ?? {}) as Record<string, unknown>;
        detail = optStr(failure["message"]);
      } else if (kind === "aborted") {
        const cause = reason["reason"];
        detail =
          cause !== null && typeof cause === "object"
            ? optStr((cause as Record<string, unknown>)["kind"])
            : optStr(cause);
      }
      const known = [
        "completed",
        "aborted",
        "blocked",
        "error",
        "max-tokens",
        "interrupted",
      ] as const;
      const mark: TurnItem = {
        kind: "turn",
        id: durableId(seq),
        seq,
        turn,
        state: known.includes(kind as (typeof known)[number])
          ? (kind as TurnItem["state"])
          : "completed",
        ...(detail !== undefined ? { detail } : {}),
      };
      state.items.push(mark);
      if (state.runningTurn === turn) {
        state.runningTurn = null;
        state.runningSince = null;
      }
      break;
    }
    case "approval/asked": {
      const reason = optStr(data["reason"]);
      const item: ApprovalRowItem = {
        kind: "approval-row",
        id: durableId(seq),
        seq,
        time: event.time,
        approvalId: str(data["id"]),
        toolName: str(data["toolName"]),
        ...(reason !== undefined ? { reason } : {}),
      };
      state.items.push(item);
      break;
    }
    case "approval/decided": {
      const row = state.items.find(
        (item): item is ApprovalRowItem =>
          item.kind === "approval-row" && item.approvalId === str(data["id"]),
      );
      if (row !== undefined) row.outcome = str(data["outcome"]);
      break;
    }
    default:
      break;
  }
}

/** Fold the tail (or a whole fresh session) from one history page. */
export function foldHistoryPage(
  state: TranscriptState,
  entries: readonly HistoryEntry[],
  page: { hasMore: boolean },
): void {
  for (const entry of entries) foldEvent(state, entry.event, entry.view);
  state.hasMore = page.hasMore;
}

/**
 * Seed the projection cells from the tail page's block (AC 11's baseline:
 * the registry cut every value reflects, under the same higher-seq-wins
 * rule live frames use).
 */
export function seedProjections(
  state: TranscriptState,
  block: { asOfSeq: number; values: Record<string, unknown> } | undefined,
): void {
  if (block === undefined) return;
  for (const [key, value] of Object.entries(block.values)) {
    const cell = state.projections[key];
    if (cell === undefined || block.asOfSeq > cell.seq) {
      state.projections[key] = { value, seq: block.asOfSeq };
    }
  }
}

/**
 * Prepend an OLDER page (Load older): fold it into a scratch state, drop
 * anything the tail's replacements already shadowed, and splice it before
 * the current items. Scroll preservation is the renderer's job; the fold
 * guarantee here is ordering plus the shadow memory (AC 6, AC 8).
 */
export function prependHistoryPage(
  state: TranscriptState,
  entries: readonly HistoryEntry[],
  page: { hasMore: boolean },
): void {
  const older = createTranscript();
  for (const entry of entries) foldEvent(older, entry.event, entry.view);
  const kept = older.items.filter((item) => !(item.seq !== null && state.shadowed.has(item.seq)));
  state.items = [...kept, ...state.items];
  for (const seq of older.seen) state.seen.add(seq);
  for (const seq of older.shadowed) state.shadowed.add(seq);
  if (older.lastSeq > state.lastSeq) state.lastSeq = older.lastSeq;
  state.hasMore = page.hasMore;
}

// ---------------------------------------------------------------------------
// Live frames
// ---------------------------------------------------------------------------

/**
 * The question-card identity: the answer token when one exists (the host's
 * stable logical id for the ask), else a content-derived key of the batch.
 */
function questionCardId(questions: readonly unknown[], token: string | undefined): string {
  if (token !== undefined) return `card-q-${token}`;
  const key = questions
    .map((q) => {
      if (q === null || typeof q !== "object") return "";
      const r = q as Record<string, unknown>;
      return [r["id"], r["question"], r["header"]].map((v) => String(v ?? "")).join("\u0000");
    })
    .join("\u0001");
  return `card-q-${key}`;
}

function cardFor(
  state: TranscriptState,
  id: string,
  kind: PendingCard["kind"],
  token: string | undefined,
  frame: AnswerableFrame,
): void {
  const existing = state.pending.find((card) => card.id === id);
  const card: PendingCard = {
    id,
    kind,
    state: existing?.state ?? "pending",
    ...(token !== undefined
      ? { answerToken: token }
      : existing?.answerToken !== undefined
        ? { answerToken: existing.answerToken }
        : {}),
    ...(existing?.outcome !== undefined ? { outcome: existing.outcome } : {}),
    frame,
  };
  const index = state.pending.findIndex((candidate) => candidate.id === id);
  if (index === -1) state.pending.push(card);
  else state.pending[index] = card;
}

/**
 * Apply one browser downlink frame. Answerable frames arrive with their
 * correlation token when the caller routes through this same function's
 * sibling {@link foldDownlinkEvent}; calling `foldFrame` directly keeps the
 * settle logic (the token simply stays whatever the open path recorded).
 */
export function foldFrame(state: TranscriptState, frame: MuxFrame): void {
  switch (frame.type) {
    case "session/event":
      foldEvent(state, frame.event, frame.view);
      break;
    case "session/subscribed":
      state.subscribedLastSeq = frame.lastSeq;
      break;
    case "session/queue": {
      // AC 14: queued placement only; steering rides the provisional row,
      // context items stay invisible until claimed.
      const queued = frame.items.filter((item) => item.placement === "queued");
      state.queue = queued.map((item) => ({
        id: String(item.id),
        text: parseContentBlocks(item.message.content).text,
      }));
      break;
    }
    case "session/projection": {
      const cell = state.projections[frame.key];
      if (cell === undefined || frame.seq > cell.seq) {
        state.projections[frame.key] = { value: frame.value, seq: frame.seq };
      }
      break;
    }
    case "approval/requested":
      cardFor(state, `card-appr-${String(frame.approvalId)}`, "approval", undefined, frame);
      break;
    case "approval/resolved": {
      const card = state.pending.find(
        (candidate) => candidate.id === `card-appr-${String(frame.approvalId)}`,
      );
      if (card !== undefined) {
        card.state = "resolved";
        card.outcome = frame.outcome;
      }
      break;
    }
    case "question/requested":
      // Without a token (a fold that never answers) the card is still
      // identified by its question set, so a replay does not duplicate it.
      cardFor(state, questionCardId(frame.questions, undefined), "question", undefined, frame);
      break;
    case "question/resolved": {
      // Match by the token (the ask's stable logical id); the content-keyed
      // no-token fallback matches by the same token once it is known.
      const card = state.pending.find(
        (candidate) =>
          candidate.kind === "question" && candidate.answerToken === String(frame.questionRpcId),
      );
      if (card !== undefined) {
        card.state = "resolved";
        card.outcome = frame.outcome;
      }
      break;
    }
    case "session/jobs":
      // Explicitly out of this story (Non-Goals); consume silently.
      break;
    case "stream/error":
      state.streamError = frame.error;
      break;
  }
}

/**
 * Apply one browser downlink EVENT (frame + its opaque token): answerable
 * frames keep their token through the fold so the card can answer; every
 * other frame folds as before.
 */
export function foldDownlinkEvent(
  state: TranscriptState,
  frame: MuxFrame,
  answerToken?: string,
): void {
  if (
    answerToken !== undefined &&
    (frame.type === "approval/requested" || frame.type === "question/requested")
  ) {
    const id =
      frame.type === "approval/requested"
        ? `card-appr-${String(frame.approvalId)}`
        : questionCardId(frame.questions, answerToken);
    cardFor(
      state,
      id,
      frame.type === "approval/requested" ? "approval" : "question",
      answerToken,
      frame,
    );
    return;
  }
  foldFrame(state, frame);
}

// ---------------------------------------------------------------------------
// Optimistic echo (AC 13)
// ---------------------------------------------------------------------------

/**
 * Add the provisional user row for a send whose durable echo has not
 * arrived; keyed by the prompt's rpcId, replaced in place by the matching
 * `user/message`, withdrawn on discard.
 */
export function markProvisional(
  state: TranscriptState,
  input: { rpcId: string; text: string; images?: TranscriptImage[]; time?: number },
): void {
  state.items.push({
    kind: "user",
    id: `p${input.rpcId}`,
    seq: null,
    time: input.time ?? Date.now(),
    text: input.text,
    images: input.images ?? [],
    rpcId: input.rpcId,
    provisional: true,
  });
}

/**
 * Converge the provisional row with its durable echo once the send action
 * resolves - BOTH orders, because the downlink can beat the action's
 * response: if the durable `user/message` (carrying the RPC's rpcId) has
 * already landed, the provisional row is simply withdrawn (the durable one
 * IS the row); if it has not, the provisional row is re-keyed so the
 * arriving echo replaces it in place. Either order settles to exactly one.
 */
export function reconcileProvisional(state: TranscriptState, tempKey: string, rpcId: string): void {
  const durable = state.items.some(
    (item) => item.kind === "user" && item.provisional !== true && item.rpcId === rpcId,
  );
  if (durable) {
    withdrawProvisional(state, tempKey);
    return;
  }
  for (const item of state.items) {
    if (item.kind === "user" && item.provisional === true && item.rpcId === tempKey) {
      item.rpcId = rpcId;
      return;
    }
  }
}

/** Flag the provisional row failed (a refused send keeps the draft, AC 13). */
export function markProvisionalFailed(state: TranscriptState, rpcId: string): void {
  const item = state.items.find(
    (candidate) =>
      candidate.kind === "user" && candidate.provisional === true && candidate.rpcId === rpcId,
  );
  if (item !== undefined && item.kind === "user") item.failed = true;
}

/** Withdraw the provisional row entirely (the host discarded the prompt). */
export function withdrawProvisional(state: TranscriptState, rpcId: string): void {
  state.items = state.items.filter(
    (item) => !(item.kind === "user" && item.provisional === true && item.rpcId === rpcId),
  );
}

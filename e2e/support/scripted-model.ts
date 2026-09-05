/**
 * The scripted model provider (story #134 task #135 commit 2) - a local
 * OpenAI-compatible HTTP stub the e2e dsh profile talks to through the REAL
 * adapter path.
 *
 * Why this shape: the parent's open question offered a dedicated bundle row
 * or a local stub behind a real provider adapter; the stub wins because it
 * composes nothing new into the product - settings.yaml declares an
 * `llm-pi-ai` provider route with `api: openai-completions` (resolved by the
 * pinned pi-ai adapter over the OpenAI SDK: `POST <baseURL>/chat/completions`
 * with `stream: true`), so every live assertion (chunks, a tool call with a
 * result, an approval ask, a failed model call) rides the same wire a real
 * deployment answers.
 *
 * Determinism model (stateless on purpose): a prompt opts into a scripted
 * SCENARIO by embedding a marker (`scripted-<name>`) in its first human
 * message; the step within the scenario is the count of `role:"tool"`
 * messages in the request - the host's own conversation carry - so no
 * per-session server state can drift. The default scenario answers any
 * unmarked prompt, which is what makes the existing seed prompts settle.
 *
 * The chunk discipline the adapter requires (verified against pi-ai 0.82.1):
 * each delta is `data: {chat.completion.chunk}\n\n`, a `finish_reason` is
 * mandatory before the terminator, tool-call argument fragments accumulate
 * leniently, and the stream ends with `data: [DONE]`.
 */
import { createServer, type Server } from "node:http";

/** One assistant turn the stub emits: streamed text, then optional tool calls. */
export interface ScriptedStep {
  /** Text to stream, split across `chunkParts` SSE deltas. */
  text?: string;
  /** How many deltas the text is split into (>= 1; live-append demos need > 1). */
  chunkParts?: number;
  /** Delay between text deltas (ms) - opens the live streaming window. */
  chunkDelayMs?: number;
  /** Reasoning streamed before the text (renders as thinking). */
  reasoning?: string;
  /** Tool calls to request after the text (finish_reason becomes tool_calls). */
  toolCalls?: { id: string; name: string; arguments: Record<string, unknown> }[];
  /** Answer HTTP 4xx (INVALID_REQUEST - non-retryable) instead of a stream. */
  httpError?: number;
}

/** One named scenario: steps indexed by the round trip within the turn. */
export interface ScriptedScenario {
  /** The marker substring that selects this scenario (prompt text match). */
  marker: string;
  steps: ScriptedStep[];
}

/** What {@link startScriptedModel} returns. */
export interface ScriptedModel {
  /** The loopback port serving the OpenAI-compatible wire. */
  port: number;
  /** The provider baseURL to configure (ends with `/v1`). */
  baseURL: string;
  /** Every completion request served (marker + step), for spec assertions. */
  readonly served: { marker: string | null; step: number; model: string }[];
  stop(): Promise<void>;
}

/** The scenarios composed into every e2e profile boot. */
export const DEFAULT_SCENARIOS: ScriptedScenario[] = [
  {
    // A long, chunked, DELAYED reply: the live-append specs (commit 6) get
    // a real streaming window to observe and assert "exactly once" on.
    // One step only - the step index advances per tool round-trip, and a
    // text-only scenario has none.
    marker: "scripted-stream",
    steps: [
      {
        text: "Streaming alpha. beta gamma. delta. the quick brown fox. jumps over. the lazy dog. END-OF-STREAM.",
        chunkParts: 12,
        chunkDelayMs: 120,
      },
    ],
  },
  {
    // One tool call with a real host-executed result, then the final text.
    marker: "scripted-tool",
    steps: [
      {
        text: "Reading the notes now.",
        chunkParts: 2,
        toolCalls: [{ id: "call-read-1", name: "read", arguments: { file_path: "notes.txt" } }],
      },
      { text: "File read complete: hello from the fixture." },
    ],
  },
  {
    // A bash call asking for sandbox escalation - the standing
    // workspace-write mode turns that into an approval ask on the mux
    // stream (approveEscalation -> ctx.approval.request); the answer (or a
    // rejection) comes back as the tool result and the scenario concludes.
    marker: "scripted-approval",
    steps: [
      {
        toolCalls: [
          {
            id: "call-approve-1",
            name: "bash",
            arguments: {
              command: "echo approved-ok",
              description: "Echo the approval marker",
              sandbox_permissions: "danger-full-access",
              justification: "e2e scripted approval scenario",
            },
          },
        ],
      },
      { text: "Approval round complete." },
    ],
  },
  {
    // An aborted-answer ask: the questions card flow (commit 8 specs).
    marker: "scripted-question",
    steps: [
      {
        toolCalls: [
          {
            id: "call-ask-1",
            name: "ask_user_question",
            arguments: {
              questions: [
                {
                  id: "q-flavor",
                  question: "Which flavor?",
                  header: "Flavor",
                  options: [
                    { label: "Vanilla", description: "classic" },
                    { label: "Chocolate", description: "rich" },
                  ],
                  multi_select: false,
                },
              ],
            },
          },
        ],
      },
      { text: "Answered: thanks for the flavor." },
    ],
  },
  {
    // A model-call failure: a non-retryable 4xx lands a `turn/end` with
    // reason.kind 'error' fast (a truncated stream would ride the default
    // retry ladder first) - the transcript's visibly-failed-turn mark.
    marker: "scripted-fail",
    steps: [{ httpError: 400 }],
  },
];

/** The fallback step for any unmarked prompt (existing seeds settle). */
const DEFAULT_STEP: ScriptedStep = { text: "Stub scripted reply.", chunkParts: 2 };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Split a string into n non-empty pieces (as equal as integers allow). */
function splitText(text: string, parts: number): string[] {
  const n = Math.max(1, Math.min(parts, text.length));
  const size = Math.ceil(text.length / n);
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out.length > 0 ? out : [""];
}

interface ChatCompletionRequest {
  model?: unknown;
  messages?: unknown;
}

/**
 * One message's text (a plain string, or the text blocks of a content array;
 * tool results flatten their own content).
 */
function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) =>
        b !== null && typeof b === "object" && (b as { type?: string }).type === "text"
          ? String((b as { text?: unknown }).text ?? "")
          : "",
      )
      .join("\n");
  }
  return "";
}

/**
 * Every user-role message's text, joined. dsh injects context (workspace
 * notices, AGENTS.md, goal/plan state) as user messages, so the human
 * prompt that carries the scenario marker is NOT necessarily the first -
 * the marker can live anywhere in the user channel.
 */
function allUserText(messages: readonly unknown[]): string {
  const parts: string[] = [];
  for (const m of messages) {
    if (m === null || typeof m !== "object") continue;
    const msg = m as { role?: unknown; content?: unknown };
    if (msg.role !== "user") continue;
    const text = messageText(msg.content);
    if (text !== "") parts.push(text);
  }
  return parts.join("\n");
}

function pickScenario(
  scenarios: readonly ScriptedScenario[],
  prompt: string,
): { scenario: ScriptedScenario | null; marker: string | null } {
  for (const scenario of scenarios) {
    if (prompt.includes(scenario.marker)) return { scenario, marker: scenario.marker };
  }
  return { scenario: null, marker: null };
}

/**
 * Start the stub on a free loopback port serving
 * `POST /v1/chat/completions` (OpenAI chat-completions SSE) plus a 200
 * `GET /v1/models` (harmless; the provider declares models in settings).
 */
export async function startScriptedModel(
  scenarios: readonly ScriptedScenario[] = DEFAULT_SCENARIOS,
): Promise<ScriptedModel> {
  const served: { marker: string | null; step: number; model: string }[] = [];
  let seq = 0;
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://stub");
    if (req.method === "GET" && url.pathname === "/v1/models") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [{ id: "stub-model", object: "model" }] }));
      return;
    }
    if (req.method !== "POST" || url.pathname !== "/v1/chat/completions") {
      res.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    void (async () => {
      try {
        await new Promise<void>((resolve) => req.on("end", () => resolve()));
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as ChatCompletionRequest;
        const messages = Array.isArray(body.messages) ? body.messages : [];
        const prompt = allUserText(messages);
        const { scenario, marker } = pickScenario(scenarios, prompt);
        const step = messages.filter(
          (m) => m !== null && typeof m === "object" && (m as { role?: unknown }).role === "tool",
        ).length;
        const model = typeof body.model === "string" ? body.model : "stub-model";
        served.push({ marker, step, model });
        const scripted = scenario?.steps[step] ?? (step === 0 ? DEFAULT_STEP : { text: "Done." });
        if (scripted.httpError !== undefined) {
          res.writeHead(scripted.httpError, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              error: { message: "scripted failure scenario", type: "invalid_request_error" },
            }),
          );
          return;
        }

        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache, no-store",
          "x-accel-buffering": "no",
        });
        const id = `chatcmpl-stub-${String(++seq)}`;
        const send = (payload: unknown): void => {
          res.write(`data: ${JSON.stringify(payload)}\n\n`);
        };
        const chunk = (delta: Record<string, unknown>, finish: string | null = null): void => {
          send({
            id,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [{ index: 0, delta, ...(finish !== null ? { finish_reason: finish } : {}) }],
          });
        };
        chunk({ role: "assistant" });
        if (scripted.reasoning !== undefined) {
          for (const piece of splitText(scripted.reasoning, 2)) chunk({ reasoning_content: piece });
        }
        if (scripted.text !== undefined) {
          for (const piece of splitText(scripted.text, scripted.chunkParts ?? 1)) {
            chunk({ content: piece });
            if (scripted.chunkDelayMs !== undefined) await sleep(scripted.chunkDelayMs);
          }
        }
        for (const [index, call] of (scripted.toolCalls ?? []).entries()) {
          const args = JSON.stringify(call.arguments);
          const half = Math.ceil(args.length / 2);
          chunk({
            tool_calls: [
              {
                index,
                id: call.id,
                type: "function",
                function: { name: call.name, arguments: args.slice(0, half) },
              },
            ],
          });
          chunk({ tool_calls: [{ index, function: { arguments: args.slice(half) } }] });
        }
        const finish =
          scripted.toolCalls !== undefined && scripted.toolCalls.length > 0 ? "tool_calls" : "stop";
        chunk({}, finish);
        send({
          id,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [],
          usage: { prompt_tokens: 128, completion_tokens: 32, total_tokens: 160 },
        });
        res.write("data: [DONE]\n\n");
        res.end();
      } catch (error) {
        // A malformed request gets the OpenAI error body shape.
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: String(error) } }));
      }
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("stub port unresolved");
  const port = address.port;
  return {
    port,
    baseURL: `http://127.0.0.1:${String(port)}/v1`,
    served,
    async stop() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/**
 * The settings.yaml the scratch DSH_HOME needs to default every session onto
 * the stub: the `agent-default-model` namespace pins the route (the base
 * layer's default-model provider reads it) and `llm-pi-ai.providers` declares
 * the hand-declared route (its `models` list is REQUIRED for a route the
 * installed pi-ai catalog does not know).
 */
export function scriptedSettingsYaml(baseURL: string): string {
  return [
    "# e2e scripted model provider (story #134 task #135 commit 2).",
    "# Default model pins every scratch session onto the local stub route.",
    "agent-default-model:",
    "  provider: stub",
    "  model: stub-model",
    "llm-pi-ai:",
    "  providers:",
    "    stub:",
    "      displayName: Scripted Stub",
    "      api: openai-completions",
    `      baseURL: ${baseURL}`,
    "      # A static Authorization header satisfies the SDK's key check",
    "      # without the credentials/env resolution.",
    "      headers:",
    "        Authorization: Bearer e2e-stub-key",
    "      # A scripted provider never retries: failures must land as a",
    "      # turn/end error in the time a spec can afford.",
    "      retryPolicy:",
    "        mode: normal",
    "        maxRetries: 0",
    "      streamIdleTimeoutMs: 30000",
    "      models:",
    "        - id: stub-model",
    "          name: Stub Model",
    "          contextWindow: 8192",
    "          maxTokens: 1024",
    "",
  ].join("\n");
}

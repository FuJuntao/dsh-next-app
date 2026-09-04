"use server";

/**
 * The startSession server action (story #117 task #119): create a session,
 * optionally select a model, and prompt it - all over the unary envelope
 * bridge (apps/web/lib/bridge.ts, ADR-0010), which is server-only, so the
 * call must run server-side. The home composer is the caller that lands
 * with task #120; the picker fields ride in from the later tasks (#121,
 * #122, #125) and stay optional here. A client-named `cwd` passes the
 * shared containment fence (host-path.ts) before `session.create`: what
 * the picker may name, this door accepts - nothing more.
 *
 * The result is a deliberate discriminated union rather than a throw: the
 * composer keeps the draft and renders the inline destructive Alert on
 * `ok: false` (story AC 4), and navigates on `ok: true` (story AC 2). Both
 * transport failures (bridge down, timeout) and RPC business errors fold
 * into that one error branch; the shipped client's pinned schemas validate
 * every payload and value, so anything malformed still surfaces here as a
 * failure instead of a partial success.
 */
import type { RpcError } from "@deepseek-ai/dsh-host-apiproxy/api";
import { getActionBridgeClient } from "./bridge";
import { fenceInsideHostRoot } from "./host-path";

/** A complete model selection to apply before the first prompt (task #125). */
export type StartSessionModel = {
  provider: string;
  model: string;
  reasoningEffort?: string;
};

/** What the surface submits: the draft plus the picker selections. */
export type StartSessionInput = {
  /** The composer text; trimmed, must be non-empty. */
  text: string;
  /** Session working directory; omitted means the host default (task #122). */
  cwd?: string;
  /** Agent preset id; omitted means the effective default (task #121). */
  agentPreset?: string;
  /** Model selection applied best-effort before the prompt (task #125). */
  model?: StartSessionModel;
  /**
   * The browser's IANA zone, attached per the prompt contract ("browser
   * callers attach their current zone; the Host validates, canonicalizes,
   * and records it"). An invalid value fails `invalid-time-zone` and rides
   * the standard failure path.
   */
  clientTimeZone?: string;
};

/** Accept or reject: the sessionId to navigate to, or the displayable error. */
export type StartSessionResult = { ok: true; sessionId: string } | { ok: false; error: string };

/** The Alert text for an RPC business error: the code the host named, then its message. */
function rpcFailure(method: string, error: RpcError): StartSessionResult {
  return { ok: false, error: `${method} failed: ${error.code}: ${error.message}` };
}

export async function startSession(input: StartSessionInput): Promise<StartSessionResult> {
  // The composer gates the empty send client-side; as the server-side door
  // of this action, re-check before any bridge call.
  const text = input.text.trim();
  if (text === "") {
    return { ok: false, error: "nothing to send: the composer text is empty" };
  }
  // The picker's containment is a server rule, not a client courtesy: a
  // client-named cwd passes the same shared fence the browse door and the
  // skills read enforce, or the send folds into the standard Alert.
  let cwd: string | undefined;
  if (input.cwd !== undefined) {
    const fenced = await fenceInsideHostRoot(input.cwd);
    if (!fenced.ok) {
      return { ok: false, error: fenced.reason };
    }
    cwd = fenced.path;
  }
  const client = getActionBridgeClient();
  try {
    const created = await client.sessions.create({
      ...(cwd !== undefined && { cwd }),
      ...(input.agentPreset !== undefined && { agentPreset: input.agentPreset }),
    });
    if (!created.result.ok) {
      return rpcFailure("session.create", created.result.error);
    }
    const sessionId = created.result.value.sessionId;
    if (input.model !== undefined) {
      // Best-effort per story AC 4: a failed selection is logged and the
      // session proceeds on the deployment's default model - the prompt the
      // user typed must not be lost to a picker glitch.
      const selected = await client.sessions.selectModel({
        sessionId,
        provider: input.model.provider,
        model: input.model.model,
        ...(input.model.reasoningEffort !== undefined && {
          reasoningEffort: input.model.reasoningEffort,
        }),
      });
      if (!selected.result.ok) {
        console.error(
          `[start-session] session.selectModel failed, continuing on the default model: ${selected.result.error.code}: ${selected.result.error.message}`,
        );
      }
    }
    const prompted = await client.sessions.prompt({
      sessionId,
      mode: "queue",
      content: [{ type: "text", text }],
      ...(input.clientTimeZone !== undefined && { clientTimeZone: input.clientTimeZone }),
    });
    if (!prompted.result.ok) {
      return rpcFailure("session.prompt", prompted.result.error);
    }
    return { ok: true, sessionId };
  } catch (error) {
    // Transport level: the bridge refused or timed out (BridgeUnavailableError
    // and friends), or the value failed the shipped client's schema.
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `the dsh bridge call failed: ${message}` };
  }
}

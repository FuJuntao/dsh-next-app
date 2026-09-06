"use server";

/**
 * The chat write door (story #134 task #135 commit 7; the channel split:
 * small JSON writes ride server actions): prompt and cancel over the unary
 * bridge, in the shapes the page may name and nothing more.
 *
 * AC 13's contract lives in the RETURN value, not in throws: the action is
 * the door, so an empty draft is refused locally, a transport failure or an
 * RPC business error folds into a displayable string the composer shows in
 * its inline Alert (draft preserved - the composer only clears on success),
 * and success carries the prompt's rpcId: the same id the host records on
 * the durable `user/message` (MessageSource 'user-rpc'), which is what lets
 * the provisional row settle in place instead of duplicating.
 *
 * AC 15's cancel is fire-and-settle: `session.cancel` stops the ACTIVE
 * turn; the transcript settles on the resulting `turn/end` (aborted) over
 * the downlink. The client never resends or promotes pending queue work -
 * the host owns that ordering.
 *
 * The browser's IANA zone rides every prompt (the prompt contract: browser
 * callers attach their zone; the host validates and records it).
 */
import { SessionId } from "@deepseek-ai/dsh-session/types";
import { getActionBridgeClient } from "./bridge";

/** Prompt input: the composer's draft and the send mode the gesture chose. */
/** One intake image: base64 the host admits and promotes to a durable
 * reference (the PromptContentPart image leg; mediaType verified host-side). */
export interface PromptImage {
  mediaType: string;
  /** Canonical base64 (no data-URL prefix). */
  data: string;
  name?: string;
}

export interface SendPromptInput {
  sessionId: string;
  text: string;
  mode: "steer" | "queue";
  images?: PromptImage[];
  /** The browser's IANA zone (captured client-side; the host canonicalizes). */
  clientTimeZone?: string;
}

/** Send outcome: accepted with the durable reconciliation key, or the Alert text. */
export type SendPromptResult = { ok: true; rpcId: string } | { ok: false; error: string };

export async function sendPrompt(input: SendPromptInput): Promise<SendPromptResult> {
  const text = input.text.trim();
  if (input.mode !== "steer" && input.mode !== "queue") {
    return { ok: false, error: "unknown send mode" };
  }
  const images = input.images ?? [];
  if (text === "" && images.length === 0) {
    return { ok: false, error: "nothing to send: the message is empty" };
  }
  try {
    const response = await getActionBridgeClient().sessions.prompt({
      sessionId: SessionId(input.sessionId),
      mode: input.mode,
      content: [
        ...(text === "" ? [] : [{ type: "text" as const, text }]),
        ...images.map((image) => ({
          type: "image" as const,
          mediaType: image.mediaType as "image/png",
          data: image.data,
          ...(image.name !== undefined ? { name: image.name } : {}),
        })),
      ],
      ...(input.clientTimeZone !== undefined && input.clientTimeZone !== ""
        ? { clientTimeZone: input.clientTimeZone }
        : {}),
    });
    if (!response.result.ok) {
      return {
        ok: false,
        error: `${response.result.error.code}: ${response.result.error.message}`,
      };
    }
    // The response frame echoes the request's rpcId - the key the durable
    // user/message will carry (callUnary verifies that echo).
    return { ok: true, rpcId: response.rpcId };
  } catch (error) {
    console.error("[chat-send] session.prompt failed:", error);
    return { ok: false, error: "the message could not be sent (the dsh bridge is unavailable)" };
  }
}

/** Cancel outcome: accepted, or the Alert text. */
export type CancelResult = { ok: true } | { ok: false; error: string };

export async function cancelTurn(sessionId: string): Promise<CancelResult> {
  try {
    const response = await getActionBridgeClient().sessions.cancel({
      sessionId: SessionId(sessionId),
    });
    if (!response.result.ok) {
      return {
        ok: false,
        error: `${response.result.error.code}: ${response.result.error.message}`,
      };
    }
    return { ok: true };
  } catch (error) {
    console.error("[chat-send] session.cancel failed:", error);
    return { ok: false, error: "the stop could not be sent (the dsh bridge is unavailable)" };
  }
}

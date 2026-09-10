"use server";

/**
 * The respond relay (story #134 task #135 commit 1; ADR-0001 re-emission,
 * ADR-0003 answer path, ADR-0010 carrier).
 *
 * The browser never addresses the transport, and answerable downlink frames
 * are answered by echoing the frame's own rpcId, never a minted one
 * (ADR-0003). So the answer to an `approval/requested` or
 * `question/requested` frame rides this server action: the client hands back
 * the opaque `answerToken` the re-emit route attached (lib/downlink.ts) plus
 * a result value, and this module rebuilds the envelope's
 * `client-response` around it and POSTs it to the bridge's respond leg. The
 * rpcId is the ONLY correlation the client controls, and it is a value it
 * was given, not one it invented.
 *
 * The result slot mirrors the RpcResult the envelope carries: success
 * (`ok: true`) with a domain-shaped value (ApprovalResponsePayload /
 * QuestionResponsePayload - commit 8 builds them), or an explicit
 * cancellation (`ok: false, code: 'cancelled'`) for dismissing an ask the
 * page will answer elsewhere. Anything else is refused locally: the host's
 * second parse (clientResponseSchema) is the authority, and a malformed
 * guess would only burn the frame's pending slot.
 *
 * The carrier receipt folds into a small discriminated union so the card
 * that answered can react: `accepted` settles it, `not-pending` means a
 * second tab (or the terminal) already answered - the resolved frame will
 * carry the outcome - and `transport` means the bridge is down, so the card
 * stays answerable.
 */
import type { RpcResult } from "@deepseek-ai/dsh-host-apiproxy/api";
import { RpcId } from "@deepseek-ai/dsh-host-apiproxy/api";
import { getActionBridgeClient } from "./bridge";

/** The two outcomes a client is allowed to report; a cancel is a failure result. */
export type RelayResultInput =
  | { ok: true; value: unknown }
  | { ok: false; code: "cancelled"; message: string };

/** What the client submits: the token from the frame plus its answer. */
export interface RespondInput {
  /** The opaque `answerToken` a `DownlinkEvent` carried. */
  answerToken: string;
  result: RelayResultInput;
}

/** Discriminated relay outcome (see the header note). */
export type RespondResult =
  | { status: "accepted" }
  | { status: "not-pending" }
  | { status: "rejected" }
  | { status: "transport" };

export async function relayRespond(input: RespondInput): Promise<RespondResult> {
  if (typeof input.answerToken !== "string" || input.answerToken === "") {
    return { status: "rejected" };
  }
  if (input.result === null || typeof input.result !== "object") {
    return { status: "rejected" };
  }
  const message = {
    type: "client-response" as const,
    rpcId: RpcId(input.answerToken),
    result: input.result as RpcResult<unknown>,
  };
  return postRespond(message);
}

async function postRespond(message: unknown): Promise<RespondResult> {
  try {
    const receipt = await getActionBridgeClient().respond(message as never);
    if (receipt.accepted === true) return { status: "accepted" };
    // 'not-pending' settles the card from the resolved frame instead;
    // 'bad-response' means our shape was wrong and the host refused it.
    return receipt.reason === "not-pending" ? { status: "not-pending" } : { status: "rejected" };
  } catch (error) {
    console.error("[respond] relay failed:", error);
    return { status: "transport" };
  }
}

/** An approval verdict a client may give (the host's other outcomes are host-side). */
export type ApprovalVerdict = "allowed-once" | "rejected";

/**
 * Answer one approval ask (AC 16): the value slot is the ApprovalResponse
 * payload (sessionId + approvalId + the verdict), echoing the frame's token.
 * The card settles from the broadcast approval/resolved frame - this returns
 * only the carrier receipt so the card can react to a refusal.
 */
export async function answerApproval(input: {
  answerToken: string;
  sessionId: string;
  approvalId: string;
  outcome: ApprovalVerdict;
}): Promise<RespondResult> {
  return relayRespond({
    answerToken: input.answerToken,
    result: {
      ok: true,
      value: { sessionId: input.sessionId, approvalId: input.approvalId, outcome: input.outcome },
    },
  });
}

/**
 * Answer a whole question batch (AC 17): the value slot is the QuestionResponse
 * payload (sessionId + the answer). One ask is answered as a batch, never split
 * per question; a `bad-response` refusal surfaces as `rejected` and the card
 * stays answerable (never dead).
 */
export async function answerQuestions(input: {
  answerToken: string;
  sessionId: string;
  answers: { id: string; selected: string[]; custom?: string }[];
}): Promise<RespondResult> {
  return relayRespond({
    answerToken: input.answerToken,
    result: {
      ok: true,
      value: { sessionId: input.sessionId, answer: { answers: input.answers } },
    },
  });
}

/** Refuse a question batch (dismiss): the answer is a cancelled client-response. */
export async function cancelQuestion(input: { answerToken: string }): Promise<RespondResult> {
  return relayRespond({
    answerToken: input.answerToken,
    result: { ok: false, code: "cancelled", message: "dismissed in the web surface" },
  });
}

"use server";

/**
 * The session page's `/` roster (story #152 task #153 commit 5): what the
 * host recognizes, asked of the host.
 *
 * `skill.list` is addressed by SESSION ID, not by path: the carrier's own
 * contract is that "the session's header cwd resolves to the canonical
 * project root host-side - the client never submits a raw path". That is why
 * this door needs no fence (the browser names a session it was already
 * allowed to load, and the roots are the host's to resolve) and why it is the
 * full-truth surface: whatever the host scans - `.dsh/skills`,
 * `.agents/skills`, custom dirs, the user-level roots, bundled entries, flat
 * Markdown - arrives here in the host's own root-rank order, where home's
 * folder read sees one directory and nothing above it.
 *
 * The bridge is server-only (ADR-0010), so the lookup rides a server action
 * exactly like `session-references.ts` rather than reaching the socket from
 * the browser.
 *
 * Failure is REPORTED, never folded into an empty roster: non-ok (any code,
 * including an unknown session), a bridge that cannot be reached, or a call
 * that throws all answer `ok: false` with the reason, so the menu can say the
 * roster could not be read instead of implying the project has no skills
 * (AC 6). What the composer keeps either way is its vendored commands -
 * listing is a suggestion, invocation is host-routed, so no send depends on
 * this call.
 */
import { SessionId } from "@deepseek-ai/dsh-session/types";
import { getActionBridgeClient } from "./bridge";

/** One roster row: the name a user types, and the host's own description. */
export type SessionSkill = { name: string; description: string };

/** The read's outcome: the host's roster (possibly empty), or the refusal. */
export type SessionSkillsResult =
  | { ok: true; skills: SessionSkill[] }
  | { ok: false; reason: string };

/**
 * List the skills the host recognizes for `sessionId`, in the order it
 * returns them - the host's root-rank order, which the menu must not
 * re-sort (AC 1).
 */
export async function fetchSessionSkills(sessionId: string): Promise<SessionSkillsResult> {
  try {
    // The route's string id enters the wire vocabulary through the host's own
    // brand factory, exactly as chat-send and the page fetch brand it - the
    // carrier validates non-emptiness there, and this door submits no paths.
    const response = await getActionBridgeClient().skills.list({
      sessionId: SessionId(sessionId),
    });
    if (!response.result.ok) {
      const { code, message } = response.result.error;
      console.error(`[session-skills] skill.list failed: ${code} ${message}`);
      return { ok: false, reason: `skill.list refused: ${code}` };
    }
    // `whenToUse` is not rendered (one description line per row; story #152
    // non-goal) and `modelInvocable` is no filter - the command-only skills
    // are the ones a user types. The rows are already the host's verdict that
    // a skill is user-invocable, so this map is a projection, not a policy.
    return {
      ok: true,
      skills: response.result.value.skills.map((entry) => ({
        name: entry.name,
        description: entry.description,
      })),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[session-skills] skill.list failed:", error);
    return { ok: false, reason: `the dsh bridge call failed: ${message}` };
  }
}

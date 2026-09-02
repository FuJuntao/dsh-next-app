/**
 * Session-reference mention tokens, client-side (story #117 task #124).
 *
 * The reference grammar is owned by the host's `dsh-session-reference`
 * package; this module mirrors its canonical encoding so a composer insert
 * parses back exactly as the host formats it: a Markdown mention
 * `@[label](dsh-session:<payload>)` whose payload is base64url over the
 * UTF-8 JSON string of the session id, and whose label escapes only
 * backslash and `]`. The unit tests pin this implementation against vectors
 * produced by the real dsh package - the format drift guard for the side
 * that does not ship the dependency.
 */

/** URI scheme reserved for DeepSeek Harness session snapshots. */
const SESSION_REFERENCE_SCHEME = "dsh-session:";

/**
 * Encode a session id as the canonical `dsh-session:` URI
 * (base64url of the JSON string, no padding).
 */
export function encodeSessionReferenceUri(sessionId: string): string {
  const bytes = new TextEncoder().encode(JSON.stringify(sessionId));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const payload = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
  return SESSION_REFERENCE_SCHEME + payload;
}

/** Escape a display label the way the host's mention format does (`\` and `]`). */
function escapeLabel(label: string): string {
  return label.replace(/[\\\]]/gu, (match) => "\\" + match);
}

/**
 * Render the Markdown mention carrying the canonical URI - the exact text
 * a composer inserts for a chosen session reference.
 */
export function formatSessionReferenceMention(reference: {
  sessionId: string;
  label?: string | undefined;
}): string {
  const label = reference.label ?? reference.sessionId;
  return `@[${escapeLabel(label)}](${encodeSessionReferenceUri(reference.sessionId)})`;
}

/**
 * User-side preferences channel (client-safe core).
 *
 * One namespaced cookie (dsh-next-app.prefs) carries a small, versioned JSON
 * object; the server reads it in the shell provider so the first HTML paint
 * already reflects stored preferences (no flash), and client components
 * write it on every change. The value is URL-encoded JSON:
 * encodeURIComponent output is entirely within the cookie-octet set, so no
 * escaping is lost on the wire.
 *
 * The cookie itself is parsed and serialized with the `cookie` package
 * (jshttp) - the same parser the server ecosystem uses - instead of
 * hand-rolled document.cookie string surgery.
 *
 * Validation is deliberate: the schema sanitizes the value (invalid
 * fields and unknown keys are dropped, valid ones survive - autofix), so
 * a hand-edited or stale cookie can never break the shell - an absent
 * field simply leaves the shell on its CSS/component default.
 * (Signing/tamper protection and schema growth are a dedicated story.)
 *
 * This module is shared with the client bundle (the resize handle writes
 * through updatePreferences), so it must not import server-only APIs. The
 * server-side read lives in preferences-server.ts (next/headers).
 *
 * The width constraints (minimum, center-column minimum, resize step) are
 * NOT here: they are CSS variables in globals.css, the single source the
 * resize handle clamps against and the layout caps with. The default width
 * is the shadcn Sidebar's own --sidebar-width (16rem), applied whenever no
 * width preference exists.
 *
 * The fold state lives here too: the shell's controlled client provider
 * (shell-sidebar-provider.tsx) seeds it from the prefs cookie for the
 * first paint (no flash) and persists every toggle through
 * updatePreferences - the only observer the Sidebar offers for its open
 * state. The stock sidebar_state cookie is never read.
 */

import Schema from "@deepseek-ai/schemastery";
import { parse, serialize } from "cookie";

/**
 * The preferences schema (schemastery - the same library the bundle's
 * cordis config is validated with). Validation runs with autofix: an
 * invalid object property is removed instead of failing the whole value,
 * so a hand-edited or stale cookie keeps its valid fields (the sanitize
 * contract). Unknown keys are dropped by the parser's destructuring.
 */
const PreferencesSchema = Schema.object({
  layout: Schema.object({
    width: Schema.number().min(1),
    folded: Schema.boolean(),
  }),
});

/** The cookie carrying the preferences object. */
export const PREFERENCES_COOKIE = "dsh-next-app.prefs";

/** Layout prefs consumed by the shell (AppShell). */
export interface LayoutPreferences {
  /** The side nav width in px; absent = the CSS default styles the shell. */
  width?: number;
  /** Whether the side nav is folded away; absent = open by default. */
  folded?: boolean;
}

/** The preferences object; add namespaced sections as features need them. */
export interface Preferences {
  layout: LayoutPreferences;
}

/**
 * Serialize preferences for the cookie value: URL-encoded JSON, so the value
 * stays within the legal cookie-octet set on both write (document.cookie)
 * and read (Cookie header) paths.
 */
export function encodePreferences(prefs: Preferences): string {
  return encodeURIComponent(JSON.stringify(prefs));
}

/**
 * Parse and validate a raw cookie value into preferences. A missing or
 * unparsable value reports undefined; a parsable one is sanitized by the
 * schema: invalid fields and unknown keys are dropped, the valid fields
 * survive, so an absent or malformed field falls back to the
 * component/CSS default instead of a made-up value (and cannot break the
 * shell). The parser behind readPreferences() (preferences-server.ts);
 * callers normally use that instead of reading the cookie themselves.
 */
export function parsePreferences(raw: string | undefined): Preferences | undefined {
  if (raw === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(raw));
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object") return undefined;
  try {
    // autofix removes invalid object properties; destructuring strips
    // unknown keys from the sanitized layout.
    const { width, folded } = PreferencesSchema(parsed as never, { autofix: true }).layout;
    return {
      layout: {
        ...(width !== undefined && { width }),
        ...(folded !== undefined && { folded }),
      },
    };
  } catch {
    return undefined;
  }
}

/** The current document cookie value for the preferences cookie (client). */
function readDocumentCookie(): string | undefined {
  return parse(document.cookie)[PREFERENCES_COOKIE];
}

/**
 * Merge a patch into the stored preferences and write the cookie (client
 * only). Writers merge so layout fields never clobber each other.
 */
export async function updatePreferences(patch: Preferences): Promise<void> {
  try {
    const current = parsePreferences(readDocumentCookie());
    const prefs: Preferences = { layout: { ...current?.layout, ...patch.layout } };
    document.cookie = serialize(PREFERENCES_COOKIE, encodePreferences(prefs), {
      path: "/",
      maxAge: 31536000,
      sameSite: "lax",
    });
  } catch {
    // Storage unavailable: the in-memory state still applies.
  }
}

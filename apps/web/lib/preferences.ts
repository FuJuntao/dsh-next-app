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
 * The cookie transport is hand-rolled and deliberately minimal: the value
 * is URL-encoded JSON, which never contains "; " or "=", so a prefix scan
 * and a plain attribute string are exact for our own writes; the value
 * itself is guarded by the schema below.
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
import type { SessionViewPreferences } from "./session-view";

/**
 * The preferences schema (schemastery - the same library the bundle's
 * cordis config is validated with). Validation runs with autofix: an
 * invalid object property is removed instead of failing the whole value,
 * so a hand-edited or stale cookie keeps its valid fields (the sanitize
 * contract). Unknown keys are dropped by the parser's destructuring.
 *
 * The sessions section carries the nav's view state (story #109): enum
 * unions drop an out-of-vocabulary value wholesale. A stale cookie whose
 * sort names a retired mode (e.g. "manual") therefore sanitizes back to
 * the recency default instead of failing.
 */
const PreferencesSchema = Schema.object({
  layout: Schema.object({
    width: Schema.number().min(1),
    folded: Schema.boolean(),
  }),
  sessions: Schema.object({
    group: Schema.union(["workspace", "none"]),
    sort: Schema.union(["recency", "title"]),
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

/**
 * Sessions-nav view prefs (story #109), re-exported from the pure view
 * module that owns their semantics; the cookie stores them verbatim.
 */
export type { SessionGroupMode, SessionSortMode, SessionViewPreferences } from "./session-view";

/** The preferences object; add namespaced sections as features need them. */
export interface Preferences {
  layout: LayoutPreferences;
  sessions?: SessionViewPreferences;
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
    // unknown keys from the sanitized sections. A retired vocabulary value
    // (e.g. a stale "manual") drops exactly like any other invalid field.
    const parsedPrefs = PreferencesSchema(parsed as never, { autofix: true });
    const { width, folded } = parsedPrefs.layout;
    const { group, sort } = parsedPrefs.sessions ?? {};
    const sessions = {
      ...(group === "workspace" || group === "none" ? { group } : {}),
      ...(sort === "recency" || sort === "title" ? { sort } : {}),
    };
    return {
      layout: {
        ...(width !== undefined && { width }),
        ...(folded !== undefined && { folded }),
      },
      ...((sessions.group !== undefined || sessions.sort !== undefined) && {
        sessions,
      }),
    };
  } catch {
    return undefined;
  }
}

/** The current document cookie value for the preferences cookie (client). */
function readDocumentCookie(): string | undefined {
  // Our value (URL-encoded JSON) never contains "; " or "=", so the
  // prefix scan is exact; see the module comment.
  return document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(PREFERENCES_COOKIE + "="))
    ?.slice(PREFERENCES_COOKIE.length + 1);
}

/**
 * The patch shape for updatePreferences: any subset of sections, each
 * itself partial, so writers touch only the fields they change.
 */
export type PreferencesPatch = {
  [K in keyof Preferences]?: Partial<Preferences[K]>;
};

/**
 * Merge a patch into the stored preferences and write the cookie (client
 * only). Writers merge section-wise - every top-level section spreads over
 * the stored one independently, so layout fields never clobber sessions
 * fields (and vice versa).
 */
export async function updatePreferences(patch: PreferencesPatch): Promise<void> {
  try {
    const current = parsePreferences(readDocumentCookie());
    const prefs: Preferences = {
      layout: { ...current?.layout, ...patch.layout },
      ...(patch.sessions !== undefined && {
        sessions: { ...current?.sessions, ...patch.sessions },
      }),
    };
    document.cookie =
      PREFERENCES_COOKIE + "=" + encodePreferences(prefs) + ";path=/;max-age=31536000;samesite=lax";
  } catch {
    // Storage unavailable: the in-memory state still applies.
  }
}

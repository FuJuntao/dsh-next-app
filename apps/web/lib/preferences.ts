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
import type { SessionGroupMode, SessionSortMode } from "./session-view";


/**
 * The preferences schema (schemastery - the same library the bundle's
 * cordis config is validated with). Validation runs with autofix: an
 * invalid object property is removed instead of failing the whole value,
 * so a hand-edited or stale cookie keeps its valid fields (the sanitize
 * contract). Unknown keys are dropped by the parser's destructuring.
 *
 * The value shape is flat with per-feature prefixes (review of this PR):
 * layout* keys belong to the shell, session* keys carry the nav's view
 * state (story #109). Flat keys keep writers one Partial away from a merge
 * and need no section bookkeeping when features grow. Enum unions drop an
 * out-of-vocabulary value wholesale, so a stale cookie naming a retired
 * mode sanitizes back to the recency default instead of failing. Cookies
 * written before the flattening used nested sections; parsePreferences
 * maps that legacy shape onto the flat keys once (writes are always flat).
 */
const PreferencesSchema = Schema.object({
  layoutWidth: Schema.number().min(1),
  layoutFolded: Schema.boolean(),
  sessionGroup: Schema.union(["workspace", "none"]),
  sessionSort: Schema.union(["recency", "title"]),
});

/** The cookie carrying the preferences object. */
export const PREFERENCES_COOKIE = "dsh-next-app.prefs";

/**
 * Sessions-nav view prefs (story #109), re-exported from the pure view
 * module that owns their semantics; the cookie stores their group/sort
 * fields under the flat session* keys.
 */
export type { SessionGroupMode, SessionSortMode, SessionViewPreferences } from "./session-view";

/**
 * The preferences object: one flat record of prefixed keys (see the schema
 * comment). A feature adds its prefix's keys here as it needs them.
 */
export interface Preferences {
  /** The side nav width in px; absent = the CSS default styles the shell. */
  layoutWidth?: number;
  /** Whether the side nav is folded away; absent = open by default. */
  layoutFolded?: boolean;
  /** The sessions nav grouping mode; absent = flat ("none"). */
  sessionGroup?: SessionGroupMode;
  /** The sessions nav sorting mode; absent = recency. */
  sessionSort?: SessionSortMode;
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
    // Cookies written before the flat-key migration carry nested sections
    // ({layout:{width,folded}, sessions:{group,sort,order?}}); map them onto
    // the flat keys so an existing browser upgrades in place instead of
    // losing its width/fold on the next write. The retired order array and
    // any unknown key drop out through the schema's autofix below.
    const legacy = parsed as {
      layout?: { width?: unknown; folded?: unknown };
      sessions?: { group?: unknown; sort?: unknown };
    };
    const normalized =
      typeof legacy.layout === "object" && legacy.layout !== null
        ? {
            ...parsed,
            layoutWidth: legacy.layout.width,
            layoutFolded: legacy.layout.folded,
            sessionGroup: legacy.sessions?.group,
            sessionSort: legacy.sessions?.sort,
          }
        : parsed;
    // autofix removes invalid object properties; destructuring strips
    // unknown keys. A retired vocabulary value drops exactly like any other
    // invalid field.
    const parsedPrefs = PreferencesSchema(normalized as never, { autofix: true });
    const prefs: Preferences = {
      ...(parsedPrefs.layoutWidth !== undefined && { layoutWidth: parsedPrefs.layoutWidth }),
      ...(parsedPrefs.layoutFolded !== undefined && { layoutFolded: parsedPrefs.layoutFolded }),
      ...((parsedPrefs.sessionGroup === "workspace" || parsedPrefs.sessionGroup === "none") && {
        sessionGroup: parsedPrefs.sessionGroup,
      }),
      ...((parsedPrefs.sessionSort === "recency" || parsedPrefs.sessionSort === "title") && {
        sessionSort: parsedPrefs.sessionSort,
      }),
    };
    return Object.keys(prefs).length > 0 ? prefs : undefined;
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
 * Merge a patch into the stored preferences and write the cookie (client
 * only). With flat keys a writer is just Partial<Preferences>, and the
 * merge spreads field-wise over the stored record - writers touch only the
 * fields they name, never each other's.
 */
export async function updatePreferences(patch: Partial<Preferences>): Promise<void> {
  try {
    const current = parsePreferences(readDocumentCookie());
    const prefs: Preferences = { ...current, ...patch };
    document.cookie =
      PREFERENCES_COOKIE + "=" + encodePreferences(prefs) + ";path=/;max-age=31536000;samesite=lax";
  } catch {
    // Storage unavailable: the in-memory state still applies.
  }
}

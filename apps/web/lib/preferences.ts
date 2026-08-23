/**
 * User-side preferences channel (minimal version).
 *
 * One namespaced cookie (dsh-next-app.prefs) carries a small, versioned JSON
 * object; the server reads it in layouts so the first HTML paint already
 * reflects stored preferences (no flash), and client components write it on
 * every change. The value is URL-encoded JSON: encodeURIComponent output is
 * entirely within the cookie-octet set, so no escaping is lost on the wire.
 *
 * Validation is deliberate and strict: unknown keys are dropped and any
 * malformed value falls back to the defaults, so a hand-edited or stale
 * cookie can never break the shell. (Signing/tamper protection and schema
 * growth are a dedicated story.)
 */

/** The cookie carrying the preferences object. */
export const PREFERENCES_COOKIE = "dsh-next-app.prefs";

/** Layout prefs consumed by the shell (AppShell). */
export interface LayoutPreferences {
  /** The side nav width in px. */
  width: number;
  /** Whether the side nav is folded away. */
  folded: boolean;
}

/** The preferences object; add namespaced sections as features need them. */
export interface Preferences {
  layout: LayoutPreferences;
}

/** The default sidebar width, in px. */
export const DEFAULT_LAYOUT_WIDTH = 260;

/** The fallback preferences (also the SSR defaults without a cookie). */
export function defaultPreferences(): Preferences {
  return { layout: { width: DEFAULT_LAYOUT_WIDTH, folded: false } };
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
 * Parse and validate the raw cookie value into preferences. Any malformed
 * or unknown shape falls back to the defaults; the known keys are rebuilt
 * strictly (a finite positive width, a boolean folded flag).
 */
export function readPreferences(raw: string | undefined): Preferences {
  if (raw === undefined) return defaultPreferences();
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(raw));
  } catch {
    return defaultPreferences();
  }
  if (typeof parsed !== "object" || parsed === null) return defaultPreferences();
  const layout = (parsed as { layout?: unknown }).layout as
    | { width?: unknown; folded?: unknown }
    | undefined;
  const width = layout?.width;
  const folded = layout?.folded;
  if (typeof width !== "number" || !Number.isFinite(width) || width <= 0) {
    return defaultPreferences();
  }
  if (typeof folded !== "boolean") return defaultPreferences();
  return { layout: { width, folded } };
}

/**
 * User-side preferences channel.
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
 *
 * The fold state is deliberately not here: it rides the stock
 * sidebar_state cookie the shadcn Sidebar writes on its own toggle, so
 * the shell never needs a controlled provider to persist it (the layout
 * reads that cookie for the first paint too). This channel carries
 * shell-level preferences only - width today, more namespaced sections
 * as features need them.
 */

/** The cookie carrying the preferences object. */
export const PREFERENCES_COOKIE = "dsh-next-app.prefs";

/** Layout prefs consumed by the shell (AppShell). */
export interface LayoutPreferences {
  /** The side nav width in px. */
  width: number;
}

/** The preferences object; add namespaced sections as features need them. */
export interface Preferences {
  layout: LayoutPreferences;
}

/** The default sidebar width, in px. */
export const DEFAULT_LAYOUT_WIDTH = 260;

/** The narrowest sidebar the shell allows, in px. */
export const MIN_WIDTH = 216;

/** The narrowest center column, in px; caps the sidebar width. */
export const CENTER_MIN = 360;

/** The keyboard resize step, in px. */
export const RESIZE_STEP = 16;

/** The fallback preferences (also the SSR defaults without a cookie). */
export function defaultPreferences(): Preferences {
  return { layout: { width: DEFAULT_LAYOUT_WIDTH } };
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
 * strictly (a finite positive width). The render-time min() cap handles
 * the upper bound, and the layout floors the width at the shell's minimum,
 * so a hand-edited cookie can never overflow the shell.
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
  const layout = (parsed as { layout?: unknown }).layout as { width?: unknown } | undefined;
  const width = layout?.width;
  if (typeof width !== "number" || !Number.isFinite(width) || width <= 0) {
    return defaultPreferences();
  }
  return { layout: { width } };
}

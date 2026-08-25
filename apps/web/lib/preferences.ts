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
 * malformed value reports no preference at all, so a hand-edited or stale
 * cookie can never break the shell - the shell then falls back to the
 * component's own CSS defaults. (Signing/tamper protection and schema
 * growth are a dedicated story.)
 *
 * The width constraints (minimum, center-column minimum, resize step) are
 * NOT here: they are CSS variables in globals.css, the single source the
 * resize handle clamps against and the layout caps with. The default width
 * is the shadcn Sidebar's own --sidebar-width (16rem), applied whenever no
 * width preference exists.
 *
 * The fold state is deliberately not here either: it rides the stock
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

/**
 * Serialize preferences for the cookie value: URL-encoded JSON, so the value
 * stays within the legal cookie-octet set on both write (document.cookie)
 * and read (Cookie header) paths.
 */
export function encodePreferences(prefs: Preferences): string {
  return encodeURIComponent(JSON.stringify(prefs));
}

/**
 * Parse and validate the raw cookie value into preferences. A missing or
 * malformed value (including a non-positive or non-finite width) reports
 * undefined, so the caller can fall back to the CSS defaults instead of
 * rendering a made-up width.
 */
export function readPreferences(raw: string | undefined): Preferences | undefined {
  if (raw === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(raw));
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const layout = (parsed as { layout?: unknown }).layout as { width?: unknown } | undefined;
  const width = layout?.width;
  if (typeof width !== "number" || !Number.isFinite(width) || width <= 0) {
    return undefined;
  }
  return { layout: { width } };
}

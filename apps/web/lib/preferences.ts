/**
 * User-side preferences channel.
 *
 * One namespaced cookie (dsh-next-app.prefs) carries a small, versioned JSON
 * object; the server reads it in layouts so the first HTML paint already
 * reflects stored preferences (no flash), and client components write it on
 * every change. The value is URL-encoded JSON: encodeURIComponent output is
 * entirely within the cookie-octet set, so no escaping is lost on the wire.
 *
 * Validation is deliberate and strict: unknown keys are dropped and each
 * known field is rebuilt only when it parses, so a hand-edited or stale
 * cookie can never break the shell - an absent field simply leaves the
 * shell on its CSS/component default. (Signing/tamper protection and
 * schema growth are a dedicated story.)
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
 * unparsable value reports undefined; a parsable one keeps exactly the
 * fields that validate (a finite positive width, a boolean folded flag)
 * and drops everything else, so an absent field falls back to the
 * component/CSS default instead of a made-up value. Server callers
 * (layouts) pass the request cookie value here; client callers use
 * readPreferences().
 */
export function parsePreferences(raw: string | undefined): Preferences | undefined {
  if (raw === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(raw));
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const layout = (parsed as { layout?: unknown }).layout as
    | { width?: unknown; folded?: unknown }
    | undefined;
  if (layout === undefined) return { layout: {} };
  const prefs: LayoutPreferences = {};
  if (typeof layout.width === "number" && Number.isFinite(layout.width) && layout.width > 0) {
    prefs.width = layout.width;
  }
  if (typeof layout.folded === "boolean") {
    prefs.folded = layout.folded;
  }
  return { layout: prefs };
}

/**
 * Read the preferences from the current document cookie (client only).
 * Client callers use this instead of threading the raw cookie value
 * around; the server layout parses the request cookie with
 * parsePreferences instead.
 */
export function readPreferences(): Preferences | undefined {
  const raw = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(PREFERENCES_COOKIE + "="))
    ?.slice(PREFERENCES_COOKIE.length + 1);
  return parsePreferences(raw);
}

/**
 * Merge a patch into the stored preferences and write the cookie (client
 * only). Writers merge so layout fields never clobber each other.
 */
export function updatePreferences(patch: Preferences): void {
  try {
    const current = readPreferences();
    const prefs: Preferences = { layout: { ...current?.layout, ...patch.layout } };
    document.cookie =
      PREFERENCES_COOKIE + "=" + encodePreferences(prefs) + ";path=/;max-age=31536000;samesite=lax";
  } catch {
    // Storage unavailable: the in-memory state still applies.
  }
}

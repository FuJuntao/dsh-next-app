/**
 * The sidebar width preference (minimal channel).
 *
 * One small cookie (dsh-next-app.sidebar-width) carries the user's sidebar
 * width; the server reads it in the layout so the first HTML paint already
 * renders the stored width (no flash), and the resize handle writes it on
 * every change. Validation is strict: a missing or malformed value falls
 * back to the default, and the stored value is floored at the shell's
 * minimum - the render-time min() cap (against the viewport) handles the
 * upper bound, so a hand-edited cookie can never overflow the shell.
 */

/** The cookie carrying the sidebar width. */
export const WIDTH_COOKIE = "dsh-next-app.sidebar-width";

/** The default sidebar width, in px. */
export const DEFAULT_WIDTH = 260;

/** The narrowest sidebar the shell allows, in px. */
export const MIN_WIDTH = 216;

/** The narrowest center column, in px; caps the sidebar width. */
export const CENTER_MIN = 360;

/** The keyboard resize step, in px. */
export const RESIZE_STEP = 16;

/** Parse and validate the stored width cookie into px. */
export function parseStoredWidth(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_WIDTH;
  const width = Number(raw);
  if (!Number.isFinite(width) || width <= 0) return DEFAULT_WIDTH;
  return Math.max(MIN_WIDTH, width);
}

/**
 * The single dsh version this release is tested against (ADR-0006).
 * Bump procedure: bump dsh -> run contract tests -> diff installed
 * .d.ts schemas -> update this pin and the README in the same change.
 */
export const SUPPORTED_DSH_VERSION = "0.1.0-rc.7";

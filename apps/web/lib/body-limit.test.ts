/**
 * The attachment-defaults drift guard (review system-design finding #8).
 *
 * `HOST_DEFAULT_IMAGE_LIMITS` is a MIRROR of the numbers the host's
 * attachment service ships, restated as literals because `next.config.ts`
 * imports them and the staged build carries config + this module only. That
 * makes it a second source of a fact the host package tracks, so it is pinned
 * mechanically here rather than by review opinion: this test - which is free
 * to reach the host package, being dev-only - imports the shipped defaults
 * and asserts equality. A host default bump therefore fails the suite instead
 * of silently mis-sizing the server-action wall (too small: Next 413s
 * legitimate sends; too large: the wall stops being a backstop).
 *
 * Precedent for the shape: `vendored-grammar.test.ts` and the catalog drift
 * guard in `transcript.test.ts` pin against the pinned carrier the same way.
 */
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MAX_IMAGES_PER_MESSAGE,
  DEFAULT_MAX_IMAGE_BYTES,
  DEFAULT_MAX_IMAGE_DIMENSION,
  DEFAULT_MAX_IMAGE_PIXELS,
  DEFAULT_MAX_MESSAGE_IMAGE_BYTES,
} from "@deepseek-ai/dsh-attachment-local";
import {
  BODY_SIZE_LIMIT_CEILING_BYTES,
  HOST_DEFAULT_IMAGE_LIMITS,
  deriveBodySizeLimit,
} from "./body-limit";

describe("HOST_DEFAULT_IMAGE_LIMITS mirrors the pinned host (finding #8)", () => {
  it("matches every default @deepseek-ai/dsh-attachment-local ships", () => {
    expect({
      maxImageBytes: HOST_DEFAULT_IMAGE_LIMITS.maxImageBytes,
      maxImagesPerMessage: HOST_DEFAULT_IMAGE_LIMITS.maxImagesPerMessage,
      maxMessageImageBytes: HOST_DEFAULT_IMAGE_LIMITS.maxMessageImageBytes,
      maxImagePixels: HOST_DEFAULT_IMAGE_LIMITS.maxImagePixels,
      maxImageDimension: HOST_DEFAULT_IMAGE_LIMITS.maxImageDimension,
    }).toEqual({
      maxImageBytes: DEFAULT_MAX_IMAGE_BYTES,
      maxImagesPerMessage: DEFAULT_MAX_IMAGES_PER_MESSAGE,
      maxMessageImageBytes: DEFAULT_MAX_MESSAGE_IMAGE_BYTES,
      maxImagePixels: DEFAULT_MAX_IMAGE_PIXELS,
      maxImageDimension: DEFAULT_MAX_IMAGE_DIMENSION,
    });
  });

  it("keeps the media-type list the intake and the attachment route share", () => {
    // The host keeps its own accepted-type list internal (no export), so this
    // is the one fact here that cannot be pinned from the outside. What IS
    // pinned is that the app holds exactly one copy of it: both the pre-check
    // and the attachment read route read `mediaTypes` from this object.
    expect(new Set(HOST_DEFAULT_IMAGE_LIMITS.mediaTypes)).toEqual(
      new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]),
    );
  });
});

describe("the derived wall stays a backstop (finding #8)", () => {
  it("sizes the shipped defaults with headroom and under the ceiling", () => {
    const derived = deriveBodySizeLimit(HOST_DEFAULT_IMAGE_LIMITS);
    const mib = Number(derived.replace("mb", ""));
    expect(derived).toMatch(/^\d+mb$/);
    expect(mib * 1024 * 1024).toBeLessThanOrEqual(BODY_SIZE_LIMIT_CEILING_BYTES);
    // At least the raw base64 payload it must admit, and no more than 1.5x
    // that - a wall far above the need is a wall that guards nothing.
    const need =
      HOST_DEFAULT_IMAGE_LIMITS.maxImagesPerMessage * HOST_DEFAULT_IMAGE_LIMITS.maxImageBytes;
    expect(mib * 1024 * 1024).toBeGreaterThanOrEqual(need);
    expect(mib * 1024 * 1024).toBeLessThanOrEqual(need * 1.5);
  });

  it("clamps an absurd mirror and says so, rather than shipping a wide-open wall", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const derived = deriveBodySizeLimit({
        ...HOST_DEFAULT_IMAGE_LIMITS,
        maxImageBytes: 1024 * 1024 * 1024,
        maxImagesPerMessage: 1024,
      });
      expect(Number(derived.replace("mb", ""))).toBe(1024);
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      warn.mockRestore();
    }
  });
});

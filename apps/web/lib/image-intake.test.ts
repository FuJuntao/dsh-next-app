/**
 * Unit tests for the image intake rules (task #135 commit 9; AC 18/19's
 * "the body-limit derivation is unit-tested" clause of AC 27).
 */
import { describe, expect, it } from "vitest";
import {
  deriveBodySizeLimit,
  refuseImageIntake,
  reserveImageBudget,
  type ImageAttachmentLimits,
  type ImageCandidate,
} from "./image-intake";

const LIMITS: ImageAttachmentLimits = {
  maxImageBytes: 5 * 1024 * 1024,
  maxImagesPerMessage: 4,
  maxMessageImageBytes: 10 * 1024 * 1024,
  maxImagePixels: 4_000_000,
  maxImageDimension: 2048,
  mediaTypes: ["image/png", "image/jpeg"],
};

const img = (over: Partial<ImageCandidate> = {}): ImageCandidate => ({
  name: "a.png",
  mediaType: "image/png",
  bytes: 1000,
  width: 100,
  height: 100,
  ...over,
});

describe("refuseImageIntake (AC 18)", () => {
  it("skips every pre-check when the projection is absent (no attachment service)", () => {
    expect(
      refuseImageIntake(undefined, [], img({ mediaType: "image/bmp", bytes: 1e9 })),
    ).toBeNull();
  });

  it("refuses unsupported media types, oversize bytes, and over-pixel images", () => {
    expect(refuseImageIntake(LIMITS, [], img({ mediaType: "image/tiff" }))).toMatch(
      /unsupported image type/,
    );
    expect(refuseImageIntake(LIMITS, [], img({ bytes: 6 * 1024 * 1024 }))).toMatch(/per image/);
    expect(refuseImageIntake(LIMITS, [], img({ width: 3000, height: 2000 }))).toMatch(/pixels/);
  });

  it("refuses over-cap count and over-cap running total", () => {
    const four = [img(), img(), img(), img()];
    expect(refuseImageIntake(LIMITS, four, img())).toMatch(/at most 4/);
    expect(
      refuseImageIntake(LIMITS, [img({ bytes: 9 * 1024 * 1024 })], img({ bytes: 2 * 1024 * 1024 })),
    ).toMatch(/per message/);
  });

  it("admits a clean candidate", () => {
    expect(refuseImageIntake(LIMITS, [img()], img())).toBeNull();
  });
});

describe("reserveImageBudget (spec #19 race fix)", () => {
  it("refuses the second concurrent reservation that crosses maxImagesPerMessage together", () => {
    // Two quick paste batches against an empty committed set: each folds its
    // claim into the SAME running budget synchronously, so the second one is
    // evaluated at usedCount = 4, not at the stale committed 0..3.
    const budget = { usedCount: 3, usedBytes: 3 * 1000 };
    expect(reserveImageBudget(LIMITS, budget, 1000)).toBeNull();
    budget.usedCount += 1;
    budget.usedBytes += 1000;
    expect(reserveImageBudget(LIMITS, budget, 1000)).toMatch(/at most 4/);
  });

  it("refuses the second concurrent reservation that crosses maxMessageImageBytes together", () => {
    const budget = { usedCount: 1, usedBytes: 9 * 1024 * 1024 };
    expect(reserveImageBudget(LIMITS, budget, 1024 * 1024)).toBeNull();
    budget.usedCount += 1;
    budget.usedBytes += 1024 * 1024;
    expect(reserveImageBudget(LIMITS, budget, 2 * 1024 * 1024)).toMatch(/per message/);
  });

  it("a released reservation frees its slot and bytes for the next intake", () => {
    const budget = { usedCount: 4, usedBytes: 8 * 1024 * 1024 };
    expect(reserveImageBudget(LIMITS, budget, 1000)).toMatch(/at most 4/);
    // The batch turns out unmeasurable/refused: release returns the claim...
    budget.usedCount -= 1;
    budget.usedBytes -= 1000;
    expect(reserveImageBudget(LIMITS, budget, 1000)).toBeNull();
    // ...and the byte release reopens room under the total cap too.
    const tight = { usedCount: 0, usedBytes: 10 * 1024 * 1024 };
    expect(reserveImageBudget(LIMITS, tight, 1)).toMatch(/per message/);
    tight.usedBytes -= 2 * 1024 * 1024; // remove() gave two MB back
    expect(reserveImageBudget(LIMITS, tight, 1024 * 1024)).toBeNull();
  });

  it("skips the pre-check when the projection is absent (AC 18 unchanged)", () => {
    expect(reserveImageBudget(undefined, { usedCount: 999, usedBytes: 1e12 }, 1e12)).toBeNull();
  });

  it("mirrors refuseImageIntake's refusal copy for count and total crossings", () => {
    // Same wording as the committed-set check so the two rules never disagree.
    const three = [img(), img(), img()];
    expect(reserveImageBudget(LIMITS, { usedCount: 3, usedBytes: 3000 }, 1000)).toBe(
      refuseImageIntake(LIMITS, three, img()),
    );
    const heavy = [img({ bytes: 9 * 1024 * 1024 })];
    expect(
      reserveImageBudget(LIMITS, { usedCount: 1, usedBytes: 9 * 1024 * 1024 }, 2 * 1024 * 1024),
    ).toBe(refuseImageIntake(LIMITS, heavy, img({ bytes: 2 * 1024 * 1024 })));
  });
});

describe("deriveBodySizeLimit (AC 19)", () => {
  it("derives maxImagesPerMessage x maxImageBytes x 1.37 with KiB rounding", () => {
    // 4 x 5MiB x 1.37 = 28776038.4 -> 28102 KiB -> 28 mb
    expect(deriveBodySizeLimit(LIMITS)).toBe("28mb");
  });

  it("rounds small results to whole KiB", () => {
    expect(deriveBodySizeLimit({ ...LIMITS, maxImagesPerMessage: 1, maxImageBytes: 100_000 })).toBe(
      "134kb",
    ); // 137000 bytes -> 133.79 KiB -> ceil to whole KiB
  });

  it("falls back to a conservative floor when no attachment service is composed", () => {
    expect(deriveBodySizeLimit(undefined)).toBe("8mb");
  });
});

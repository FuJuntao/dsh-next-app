"use client";

/**
 * Image intake (story #134 task #135 commit 9; AC 18).
 *
 * An image gets in three ways - paste (the island forwards clipboard files),
 * the picker button, and drag-drop - all landing in `acceptFiles`. Each
 * candidate is MEASURED (bytes, intrinsic pixels via createImageBitmap) and
 * pre-checked against the host's `imageLimits` projection through the pure
 * rule in lib/image-intake.ts; a refusal is shown before submit and the
 * image is never taken. Previews are removable until the send succeeds.
 * When the projection is absent (no attachment service composed) there is
 * no pre-check and the host answers at admission. No camera affordance -
 * files only.
 *
 * Bytes travel as canonical base64 to the send action (AC 19's payload);
 * object URLs back the previews and are revoked on removal/send.
 */
import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from "react";
import { RiCloseLine, RiImageAddLine } from "@remixicon/react";

import type { PromptImage } from "@/lib/chat-send";
import {
  refuseImageIntake,
  reserveImageBudget,
  type ImageAttachmentLimits,
  type ImageCandidate,
} from "@/lib/image-intake";

/** One staged image: the measured candidate plus its preview and base64. */
interface StagedImage extends ImageCandidate {
  base64: string;
  previewUrl: string;
}

/** Imperative handle the transcript island drives. */
export interface ImageIntakeHandle {
  /** Clipboard/drop files -> staged (or refused). */
  acceptFiles(files: readonly File[]): void;
  /** The image parts for the next send (non-destructive). */
  pending(): PromptImage[];
  /** Clear staged images after an accepted send. */
  clear(): void;
  count(): number;
}

/** base64 of bytes without blowing the call stack on big images. */
function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function stage(file: File): Promise<StagedImage | null> {
  if (!file.type.startsWith("image/")) return null;
  const buffer = await file.arrayBuffer();
  let width = 0;
  let height = 0;
  try {
    const bitmap = await createImageBitmap(file);
    width = bitmap.width;
    height = bitmap.height;
    bitmap.close();
  } catch {
    // undecodable bytes: the pre-check skips the pixel rules it cannot
    // measure (dimensions 0) and the host verifies decoding at admission.
  }
  return {
    name: file.name === "" ? "pasted-image.png" : file.name,
    mediaType: file.type === "" ? "image/png" : file.type,
    bytes: buffer.byteLength,
    width,
    height,
    base64: base64FromBytes(new Uint8Array(buffer)),
    previewUrl: URL.createObjectURL(file),
  };
}

export const ImageIntake = forwardRef<
  ImageIntakeHandle,
  {
    limits: ImageAttachmentLimits | undefined;
    disabled?: boolean;
  }
>(function ImageIntake({ limits, disabled = false }, ref) {
  const [images, setImages] = useState<StagedImage[]>([]);
  const [refusal, setRefusal] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Ref mirror so acceptFiles (called from paste handlers) sees the latest
  // set while computing the running-total pre-check.
  const imagesRef = useRef<StagedImage[]>(images);
  imagesRef.current = images;
  // Spec #19: the synchronous budget. Measuring a file is async, and each
  // paste/drop fires an independent accept, so the committed array alone is
  // stale mid-batch: two quick batches would both pass the count/total
  // pre-check against the same `current` and land a combined set over the
  // caps. Every accepted image - in-flight or staged - holds a slot and its
  // bytes here, claimed BEFORE any await and released when it turns out to
  // be refused or unmeasurable; once committed it stays counted through
  // imagesRef (the visible set). The host still refuses at admission
  // (AC 18's backstop); this keeps the pre-check UX honest.
  const budgetRef = useRef<{ count: number; bytes: number }>({ count: 0, bytes: 0 });

  const acceptFiles = useCallback(
    (files: readonly File[]): void => {
      const candidates = files.filter((f) => f.type.startsWith("image/"));
      if (candidates.length === 0) return;
      // Claim the batch's SLOTS synchronously, before any await: measuring a
      // file is async and every paste/drop fires its own accept, so the
      // committed array alone is stale mid-batch - two quick batches would
      // both pre-check against the same `current` and land a combined set
      // over the count cap. Bytes join as each file is measured, and a
      // committed image stays counted here until it is dropped, so THIS
      // ledger - never `images` alone - is what a pre-check reads.
      budgetRef.current.count += candidates.length;
      void (async () => {
        const staged: StagedImage[] = [];
        let settled = 0; // candidates this loop has accounted for, one way or another
        const releaseUnaccounted = (): void => {
          // A candidate this batch abandoned without reaching its own check
          // still holds a slot. Give all of them back, or a refusal leaks
          // budget permanently and the picker starts refusing images that
          // were never attached.
          budgetRef.current.count -= candidates.length - settled;
          settled = candidates.length;
        };
        for (const file of candidates) {
          const next = await stage(file);
          settled += 1;
          if (next === null) {
            budgetRef.current.count -= 1; // undecodable: its slot was never used
            continue;
          }
          // Per-candidate rules run against the committed set plus this
          // batch's own staged prefix (the in-batch running total).
          const others: ImageCandidate[] = [
            ...imagesRef.current.map(({ name, mediaType, bytes, width, height }) => ({
              name,
              mediaType,
              bytes,
              width,
              height,
            })),
            ...staged,
          ];
          const reason =
            refuseImageIntake(limits, others, {
              name: next.name,
              mediaType: next.mediaType,
              bytes: next.bytes,
              width: next.width,
              height: next.height,
            }) ??
            // The cross-batch half, read off the synchronous ledger. Note the
            // deliberate asymmetry that the slot claim above buys: this
            // candidate's SLOT is already counted (so it is subtracted here
            // and added back by the helper), but its BYTES are not - they
            // join only once it is admitted, below - so usedBytes is the
            // ledger exactly as it stands.
            reserveImageBudget(
              limits,
              { usedCount: budgetRef.current.count - 1, usedBytes: budgetRef.current.bytes },
              next.bytes,
            );
          if (reason !== null) {
            setRefusal(reason); // visible refusal BEFORE submit (AC 18)
            // The batch withdraws together (the contract here from the
            // start): this candidate's slot, the staged prefix's slots AND
            // bytes, and anything the unread tail still holds.
            budgetRef.current.count -= 1 + staged.length;
            budgetRef.current.bytes -= staged.reduce((sum, s) => sum + s.bytes, 0);
            staged.forEach((s) => URL.revokeObjectURL(s.previewUrl));
            releaseUnaccounted();
            return;
          }
          budgetRef.current.bytes += next.bytes; // measured: hold the real bytes
          staged.push(next);
        }
        releaseUnaccounted();
        if (staged.length > 0) {
          setRefusal(null);
          setImages((prev) => {
            const nextImages = [...prev, ...staged];
            imagesRef.current = nextImages;
            return nextImages;
          });
        }
      })();
    },
    [limits],
  );

  useImperativeHandle(
    ref,
    () => ({
      acceptFiles,
      pending: () =>
        images.map(({ mediaType, base64, name }) => ({ mediaType, data: base64, name })),
      clear: () => {
        images.forEach((img) => URL.revokeObjectURL(img.previewUrl));
        // Dropping committed images returns their slots/bytes (spec #19):
        // pending claims stay reserved because they are not being dropped.
        budgetRef.current.count -= images.length;
        budgetRef.current.bytes -= images.reduce((sum, img) => sum + img.bytes, 0);
        imagesRef.current = [];
        setImages([]);
        setRefusal(null);
      },
      count: () => images.length,
    }),
    [acceptFiles, images],
  );

  const remove = (index: number): void => {
    setImages((prev) => {
      const dropped = prev[index];
      const next = prev.filter((_, i) => i !== index);
      if (dropped !== undefined) {
        URL.revokeObjectURL(dropped.previewUrl);
        // The removed image leaves the committed set, so give its budget back.
        budgetRef.current.count -= 1;
        budgetRef.current.bytes -= dropped.bytes;
      }
      imagesRef.current = next;
      return next;
    });
    setRefusal(null);
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        className="hidden"
        onChange={(event) => {
          acceptFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      {images.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2" data-testid="intake-previews">
          {images.map((image, index) => (
            <div key={image.previewUrl} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- blob preview of local bytes */}
              <img
                src={image.previewUrl}
                alt={image.name}
                className="h-16 w-16 rounded-none border border-border/60 object-cover"
              />
              <button
                type="button"
                aria-label={`Remove ${image.name}`}
                onClick={() => remove(index)}
                // AC 25: the hit target must reach 44px. The shared `xs`
                // preset is sized for dense dialogs, so the bump is scoped
                // here: an h-11 w-11 flex box centers the same size-3 icon
                // and overhangs the thumb by ~12px on top/right only — the
                // visible mark stays small, the touch area does not.
                className="absolute -right-3 -top-3 flex h-11 w-11 items-center justify-center rounded-none text-muted-foreground hover:text-foreground"
              >
                <span className="flex size-5 items-center justify-center rounded-none border border-border bg-background p-0.5">
                  <RiCloseLine className="size-3" />
                </span>
              </button>
            </div>
          ))}
        </div>
      )}
      {refusal !== null && (
        <p className="mb-2 text-xs text-destructive" data-testid="intake-refusal">
          {refusal}
        </p>
      )}
      <button
        type="button"
        aria-label="Add image"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="rounded-none p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
      >
        <RiImageAddLine className="size-4" />
      </button>
    </>
  );
});

ImageIntake.displayName = "ImageIntake";

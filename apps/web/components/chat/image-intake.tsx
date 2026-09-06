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

  const acceptFiles = useCallback(
    (files: readonly File[]): void => {
      const candidates = files.filter((f) => f.type.startsWith("image/"));
      if (candidates.length === 0) return;
      void (async () => {
        const staged: StagedImage[] = [];
        for (const file of candidates) {
          const next = await stage(file);
          if (next === null) continue;
          const reason = refuseImageIntake(
            limits,
            [
              ...imagesRef.current.map(({ name, mediaType, bytes, width, height }) => ({
                name,
                mediaType,
                bytes,
                width,
                height,
              })),
              ...staged,
            ].map((c) => c as ImageCandidate),
            {
              name: next.name,
              mediaType: next.mediaType,
              bytes: next.bytes,
              width: next.width,
              height: next.height,
            },
          );
          if (reason !== null) {
            setRefusal(reason); // visible refusal BEFORE submit (AC 18)
            staged.forEach((s) => URL.revokeObjectURL(s.previewUrl));
            return;
          }
          staged.push(next);
        }
        if (staged.length > 0) {
          setRefusal(null);
          setImages((prev) => {
            imagesRef.current = [...prev, ...staged];
            return imagesRef.current;
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
      const next = prev.filter((_, i) => i !== index);
      URL.revokeObjectURL(prev[index]?.previewUrl ?? "");
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
                className="h-16 w-16 rounded-md border border-border/60 object-cover"
              />
              <button
                type="button"
                aria-label={`Remove ${image.name}`}
                onClick={() => remove(index)}
                className="absolute -right-1.5 -top-1.5 rounded-full border border-border bg-background p-0.5 text-muted-foreground hover:text-foreground"
              >
                <RiCloseLine className="size-3" />
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
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
      >
        <RiImageAddLine className="size-4" />
      </button>
    </>
  );
});

ImageIntake.displayName = "ImageIntake";

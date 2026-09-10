"use client";

/**
 * The live downlink subscription (story #134 task #135 commit 6; ADR-0003
 * resubscribe + re-sync, AC 10/11/12).
 *
 * One page-scoped streaming fetch to /api/events drives the transcript's
 * live growth: each re-emitted mux frame folds into the SAME transcript
 * state the first paint built (lib/transcript.ts), so streamed
 * `assistant/chunk` deltas extend the in-flight bubble and the finalized
 * `assistant/message` settles over it (AC 10). The browser speaks
 * streaming fetch, not EventSource (which cannot carry the fence's Basic
 * auth on every engine), and not the envelope (which never crosses the
 * boundary - ADR-0001).
 *
 * Recovery is the single ADR-0003 path: any end of the body - the server
 * closing, a proxy idle-out, the bridge dropping, a laptop waking - is
 * "the stream is over", answered by showing the distinct `reconnecting`
 * state, then re-opening with backoff and RE-FETCHING the tail. A re-sync
 * is also forced from inside the stream: a `session/subscribed.lastSeq`
 * below the rendered tail means the fresh subscription missed durable
 * events (the host replays only still-pending asks), so the tail is
 * refetched too. Everything lands through the fold's seq-dedupe and
 * shadow memory, so whatever crossed the gap appears exactly once (AC 12).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { MuxFrame } from "@deepseek-ai/dsh-host-apiproxy/api";

import type { DownlinkEvent } from "@/lib/downlink";
import { refreshSessionTail } from "@/lib/session-history-action";
import { setNavTitle } from "@/lib/nav-live";
import {
  foldDownlinkEvent,
  foldFrame,
  foldHistoryPage,
  seedProjections,
  type TranscriptState,
} from "@/lib/transcript";

export type LiveStatus = "live" | "reconnecting" | "down";

export interface UseSessionLiveArgs {
  sessionId: string;
  /** The transcript fold this subscription appends into (shared identity;
   * null until the island's first render builds it). */
  foldRef: { readonly current: TranscriptState | null };
  /** Called after any fold change so the island re-renders. */
  sync: () => void;
  /** Called when the title projection updates (header liveness, AC 11). */
  onTitle: (title: string) => void;
}

/** Read SSE `data:` records off a streaming body, newest framing per ADR-0003. */
async function readSse(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: DownlinkEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const record = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const dataLines = record
          .split("\n")
          .filter((line) => line.startsWith("data: "))
          .map((line) => line.slice("data: ".length));
        if (dataLines.length === 0) continue; // a comment record (heartbeat)
        try {
          onEvent(JSON.parse(dataLines.join("")) as DownlinkEvent);
        } catch {
          // One malformed record must not kill the subscription; the next
          // frame or the resync path recovers whatever it carried.
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // released by a cancel already (abort path)
    }
  }
}

export function useSessionLive({ sessionId, foldRef, sync, onTitle }: UseSessionLiveArgs) {
  const [status, setStatus] = useState<LiveStatus>("live");
  const abortRef = useRef<AbortController | null>(null);
  const stoppedRef = useRef(false);
  const resyncRef = useRef<() => Promise<void>>(async () => {});

  const applyEvent = useCallback(
    (event: DownlinkEvent): void => {
      const fold = foldRef.current;
      if (fold === null) return;
      const frame = event.frame;
      foldDownlinkEvent(fold, frame, event.answerToken);
      // Header + nav liveness (AC 11): a title projection settles both.
      if (frame.type === "session/projection" && frame.key === "title") {
        const cell = fold.projections["title"];
        if (cell !== undefined && typeof cell.value === "string" && cell.value !== "") {
          onTitle(cell.value);
          setNavTitle(sessionId, cell.value);
        }
      }
      // Gap check (AC 10/12): ANY mismatch between the subscription's
      // watermark and the rendered tail means events crossed a window the
      // stream did not carry - the RSC tail was fetched before this
      // subscription opened (host emitted in between: lastSeq > tail), or a
      // re-sync arrived below already-applied seqs (lastSeq < tail). Equal
      // seqs are the steady state: nothing was missed, wait for frames.
      if (frame.type === "session/subscribed" && frame.lastSeq !== fold.lastSeq) {
        void resyncRef.current();
      }
      sync();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resync is defined below and captured lazily via ref.
    [foldRef, onTitle, sessionId, sync],
  );

  const resync = useCallback(async (): Promise<void> => {
    const result = await refreshSessionTail(sessionId);
    if (!result.ok) {
      setStatus("down");
      return;
    }
    const fold = foldRef.current;
    if (fold === null) return;
    // Re-fold the fresh tail into a scratch state and merge: foldHistory
    // skips seqs already seen (dedupe) and the shadow memory prevents a
    // re-fetched older event from resurrecting a compacted row. Projections
    // re-seed (a newer registry cut wins).
    foldHistoryPage(fold, result.window.entries, { hasMore: result.window.hasMore });
    seedProjections(
      fold,
      result.window.projections
        ? {
            asOfSeq: result.window.projections.asOfSeq,
            values: { ...result.window.projections.values },
          }
        : undefined,
    );
    const titleCell = fold.projections["title"];
    if (titleCell !== undefined && typeof titleCell.value === "string" && titleCell.value !== "") {
      onTitle(titleCell.value);
      setNavTitle(sessionId, titleCell.value);
    }
    sync();
  }, [sessionId, foldRef, onTitle, sync]);
  resyncRef.current = resync;

  useEffect(() => {
    stoppedRef.current = false;
    let backoff = 1_000;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const open = async (): Promise<void> => {
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const response = await fetch(`/api/events?sessionId=${encodeURIComponent(sessionId)}`, {
          method: "GET",
          headers: { accept: "text/event-stream" },
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok || response.body === null) {
          throw new Error(`downlink ${String(response.status)}`);
        }
        backoff = 1_000;
        attempt = 0;
        setStatus("live");
        await readSse(response.body, applyEvent, controller.signal);
        // The body ended (host closed it, or a stream-level drop). Treat as
        // a disconnect: reconnect + resync, unless we are tearing down.
        if (stoppedRef.current) return;
        await resyncRef.current();
        scheduleReopen();
      } catch (error) {
        if (stoppedRef.current || controller.signal.aborted) return;
        console.error("[live] downlink failed:", error);
        scheduleReopen();
      }
    };

    const scheduleReopen = (): void => {
      if (stoppedRef.current) return;
      attempt += 1;
      setStatus("reconnecting");
      timer = setTimeout(() => void open(), backoff);
      backoff = Math.min(backoff * 2, 15_000);
    };

    void open();
    return () => {
      stoppedRef.current = true;
      if (timer !== undefined) clearTimeout(timer);
      abortRef.current?.abort();
    };
  }, [sessionId, applyEvent]);

  return { status };
}

/** Fold a raw mux frame the caller received OUT of band (kept for commit
 * 8's card flows that may inject a frame directly). */
export function foldRawFrame(state: TranscriptState, frame: MuxFrame): void {
  foldFrame(state, frame);
}

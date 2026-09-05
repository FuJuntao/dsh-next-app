"use client";

/**
 * The session transcript island (story #134 task #135 commit 4: read path;
 * commit 6 adds the live downlink, commit 7-8 the tail overlays).
 *
 * It owns one fold (lib/transcript.ts) built from the RSC-delivered tail
 * page - server and client run the identical pure fold over the identical
 * raw entries, the session-view pattern, so the hydrated rows match the
 * first paint exactly (AC 1: no client fetch before content is visible).
 *
 * Read-path behavior owned here:
 *   - newest content at the bottom; scrolled to the bottom on first paint;
 *   - Load older (AC 8): fetches the page before the oldest loaded seq via
 *     the server action and PREPENDS it with scroll preservation - the
 *     viewport keeps pointing at the same row across the insertion (no
 *     jump), and the control disappears when the fold reports no more;
 *   - blank session: a quiet "no conversation yet" surface, shell intact.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { HistoryEntry, SessionProjectionsBlock } from "@deepseek-ai/dsh-host-apiproxy/api";

import { TranscriptRow } from "@/components/chat/transcript-rows";
import { Button } from "@/components/ui/button";
import { loadOlderHistory } from "@/lib/session-history-action";
import {
  createTranscript,
  foldHistoryPage,
  prependHistoryPage,
  seedProjections,
  type TranscriptItem,
  type TranscriptState,
} from "@/lib/transcript";

export interface SessionTranscriptProps {
  sessionId: string;
  initialEntries: HistoryEntry[];
  initialHasMore: boolean;
  initialProjections?: SessionProjectionsBlock;
  /** True while no turn has run (session.list blank bit). */
  blank: boolean;
}

/** Build the fold once from the server-delivered tail page. */
function initialFold(props: SessionTranscriptProps): TranscriptState {
  const state = createTranscript();
  foldHistoryPage(state, props.initialEntries, { hasMore: props.initialHasMore });
  seedProjections(
    state,
    props.initialProjections
      ? {
          asOfSeq: props.initialProjections.asOfSeq,
          values: { ...props.initialProjections.values },
        }
      : undefined,
  );
  return state;
}

/** Lowest seq across the loaded window (the beforeSeq for Load older). */
function oldestSeq(state: TranscriptState): number | null {
  let min: number | null = null;
  for (const item of state.items) {
    if (item.seq !== null && (min === null || item.seq < min)) min = item.seq;
  }
  return min;
}

export function SessionTranscript(props: SessionTranscriptProps) {
  const { sessionId, blank } = props;
  const foldRef = useRef<TranscriptState | null>(null);
  foldRef.current ??= initialFold(props);
  const [items, setItems] = useState<TranscriptItem[]>(() => [...foldRef.current!.items]);
  const [hasMore, setHasMore] = useState(props.initialHasMore);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const stickBottom = useRef(true);

  const sync = useCallback((): void => {
    const fold = foldRef.current;
    if (fold === null) return;
    setItems([...fold.items]);
    setHasMore(fold.hasMore);
  }, []);

  // First paint: newest at the bottom (AC 1).
  useEffect(() => {
    const el = scrollerRef.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, []);

  const onScroll = useCallback((): void => {
    const el = scrollerRef.current;
    if (el === null) return;
    stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  }, []);

  const loadOlder = useCallback(async (): Promise<void> => {
    const fold = foldRef.current;
    if (fold === null || loadingOlder) return;
    const oldest = oldestSeq(fold);
    if (oldest === null) return;
    setLoadingOlder(true);
    setOlderError(null);
    const el = scrollerRef.current;
    const before = el !== null ? { height: el.scrollHeight, top: el.scrollTop } : null;
    const result = await loadOlderHistory(sessionId, oldest);
    if (result.ok) {
      prependHistoryPage(fold, result.entries, { hasMore: result.hasMore });
      sync();
      // Scroll preservation: keep the viewport anchored to the row it was
      // showing - the prepended content grows above, the reader stays put
      // (AC 8 "in place without a scroll jump").
      if (el !== null && before !== null) {
        el.scrollTop = before.top + (el.scrollHeight - before.height);
      }
    } else {
      setOlderError(
        result.reason === "not-found"
          ? "this session no longer exists"
          : "the bridge is unavailable",
      );
    }
    setLoadingOlder(false);
  }, [sessionId, loadingOlder, sync]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto px-4 py-3 sm:px-6"
        data-testid="transcript-scroll"
      >
        {items.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">
              {blank
                ? "No conversation yet - send the first message below."
                : "Nothing loaded yet."}
            </p>
          </div>
        )}
        {hasMore && (
          <div className="mb-2 flex justify-center">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void loadOlder()}
              disabled={loadingOlder}
            >
              {loadingOlder ? "Loading…" : "Load older"}
            </Button>
          </div>
        )}
        {olderError !== null && (
          <div className="mb-2 text-center text-xs text-destructive">{olderError}</div>
        )}
        <div className="mx-auto flex w-full max-w-3xl flex-col">
          {items.map((item) => (
            <TranscriptRow key={item.id} item={item} />
          ))}
        </div>
      </div>
    </div>
  );
}

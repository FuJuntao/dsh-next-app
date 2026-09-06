"use client";

/**
 * The session transcript island (story #134 task #135; commit 4 built the
 * read path, commit 6 the live island).
 *
 * It owns one fold (lib/transcript.ts) - built server-render-consistently
 * from the RSC-delivered tail page, then grown LIVE by the page-scoped
 * downlink (use-session-live): streamed chunks extend the in-flight
 * bubble, finalized messages settle over it, projections update the page
 * header AND the side nav row (AC 11), and a dropped stream reconnects
 * with backoff + a tail re-fetch (AC 12). Server and client run the
 * identical pure fold over identical raw entries, so the hydrated rows
 * match the first paint exactly (AC 1: no client fetch precedes content).
 *
 * Read + scroll behavior owned here:
 *   - newest content at the bottom; the view follows new content while the
 *     reader is at the bottom, ANY manual scroll-up releases the follow,
 *     and one floating pill restores it ("Jump to latest", counting unseen
 *     rows while away; AC 9);
 *   - Load older (AC 8): the page before the oldest loaded seq, fetched
 *     through the server action and PREPENDED with scroll preservation -
 *     the viewport keeps pointing at the same row across the insertion -
 *     gone when the fold reports no more;
 *   - the distinct `reconnecting` state while the downlink is between
 *     attempts (AC 12), and the blank-session surface (AC 23).
 *
 * The floating pill is one slot by priority: an off-screen approval (AC
 * 16, commit 8) will outrank the jump control, which outranks the
 * reconnect notice.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { HistoryEntry, SessionProjectionsBlock } from "@deepseek-ai/dsh-host-apiproxy/api";

import { ImageIntake, type ImageIntakeHandle } from "@/components/chat/image-intake";
import { ApprovalCard, QuestionCard } from "@/components/chat/pending-cards";
import { TranscriptRow } from "@/components/chat/transcript-rows";
import type { ImageAttachmentLimits } from "@/lib/image-intake";
import { searchFileReferences } from "@/lib/file-discovery";
import { searchSessionReferences } from "@/lib/session-references";
import type { ComposerEntry, ComposerSearch } from "@/components/session-composer";
import { useSessionLive } from "@/components/chat/use-session-live";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SessionComposer } from "@/components/session-composer";
import { SLASH_MENU_ENTRIES } from "@/lib/slash-commands";
import { cancelTurn, sendPrompt } from "@/lib/chat-send";
import { navTitleOf, setNavTitle } from "@/lib/nav-live";
import { loadOlderHistory } from "@/lib/session-history-action";
import {
  reconcileProvisional,
  createTranscript,
  foldHistoryPage,
  markProvisional,
  prependHistoryPage,
  seedProjections,
  withdrawProvisional,
  type PendingCard,
  type QueuedItem,
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
  /** Header meta from session.list (title rides the live projection). */
  meta: { cwd?: string; updatedAt: number } | null;
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

function titleFrom(fold: TranscriptState): string | null {
  const cell = fold.projections["title"];
  return typeof cell?.value === "string" && cell.value !== "" ? cell.value : null;
}

function formatDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
}

export function SessionTranscript(props: SessionTranscriptProps) {
  const { sessionId, blank, meta } = props;
  const foldRef = useRef<TranscriptState | null>(null);
  foldRef.current ??= initialFold(props);
  const fold = foldRef.current;
  const [items, setItems] = useState<TranscriptItem[]>(() => [...fold.items]);
  const [hasMore, setHasMore] = useState(props.initialHasMore);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(() => titleFrom(fold));
  // Scroll follow (AC 9): stick-to-bottom + an unseen count while away.
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const stickBottom = useRef(true);
  const lastHeight = useRef(0);
  const [unseen, setUnseen] = useState(0);
  const [atBottom, setAtBottom] = useState(true);

  const [running, setRunning] = useState<boolean>(() => fold.runningTurn !== null);
  const [queue, setQueue] = useState<QueuedItem[]>(() => [...fold.queue]);
  const [pending, setPending] = useState<PendingCard[]>(() => [...fold.pending]);
  const intakeRef = useRef<ImageIntakeHandle | null>(null);

  // The `@` trigger mounts BOTH sources on a session page (AC 21): file
  // candidates from the session-cwd discovery walk first, then the
  // session.search hits home already offers. Either source failing yields
  // its empty half - the draft and the send never wait on discovery.
  const referenceSearch = useCallback(
    async (query: string): Promise<ComposerSearch> => {
      const [files, sessions] = await Promise.all([
        searchFileReferences(sessionId, query).catch(() => ({ ok: false }) as const),
        searchSessionReferences(query).catch(
          () => ({ ok: false, error: "search failed" }) as const,
        ),
      ]);
      const entries: ComposerEntry[] = [];
      if (files.ok) {
        for (const candidate of files.items.slice(0, 6)) {
          entries.push({
            kind: "file",
            label: candidate.path,
            description: candidate.kind === "directory" ? "Folder" : "File",
            key: `f:${candidate.path}`,
            insertText: candidate.mention,
          });
        }
      }
      if (sessions.ok) {
        for (const hit of sessions.items.slice(0, 4)) {
          entries.push({
            kind: "session",
            label: hit.label,
            description: hit.snippet,
            key: `s:${hit.sessionId}`,
            insertText: hit.mention,
          });
        }
      }
      return { entries };
    },
    [sessionId],
  );
  const [, setAttachmentCount] = useState(0); // render pulse only; the count itself is read via the handle
  const [sendError, setSendError] = useState<string | null>(null);

  const sync = useCallback((): void => {
    if (foldRef.current === null) return;
    setItems([...foldRef.current.items]);
    setHasMore(foldRef.current.hasMore);
    setRunning(foldRef.current.runningTurn !== null);
    setQueue([...foldRef.current.queue]);
    setPending([...foldRef.current.pending]);
  }, []);

  // The write flow (AC 13/15). The provisional row is minted with a temp
  // key, re-keyed to the prompt's rpcId when the action resolves (that is
  // what the durable user/message will carry), and withdrawn on refusal -
  // while the composer keeps the draft and the Alert shows the reason
  // (throwing back is what tells the composer the send failed).
  const handleSend = useCallback(
    async (text: string, mode: "steer" | "queue"): Promise<void> => {
      const state = foldRef.current;
      if (state === null) return;
      const tempKey = "tmp-" + Math.random().toString(36).slice(2);
      markProvisional(state, { rpcId: tempKey, text: text.trim(), time: Date.now() });
      sync();
      const images = intakeRef.current?.pending() ?? [];
      const result = await sendPrompt({
        sessionId,
        text,
        mode,
        ...(images.length > 0 ? { images } : {}),
        clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      if (result.ok) {
        reconcileProvisional(state, tempKey, result.rpcId);
        setSendError(null);
        intakeRef.current?.clear();
        setAttachmentCount(0);
      } else {
        withdrawProvisional(state, tempKey);
        setSendError(result.error);
        sync();
        throw new Error(result.error); // preserve the draft (composer contract)
      }
      sync();
    },
    [sessionId, sync],
  );

  const handleStop = useCallback((): void => {
    void cancelTurn(sessionId).then((result) => {
      if (!result.ok) setSendError(result.error);
    });
  }, [sessionId]);

  const onTitle = useCallback((next: string): void => setTitle(next), []);

  const { status } = useSessionLive({ sessionId, foldRef, sync, onTitle, enabled: true });

  // First paint: newest at the bottom (AC 1).
  useEffect(() => {
    const el = scrollerRef.current;
    if (el !== null) {
      el.scrollTop = el.scrollHeight;
      lastHeight.current = el.scrollHeight;
    }
  }, []);

  // Follow new content while pinned to the bottom; counting unseen while
  // the reader is away.
  useEffect(() => {
    const el = scrollerRef.current;
    if (el === null) return;
    const grew = el.scrollHeight > lastHeight.current;
    if (stickBottom.current) {
      el.scrollTop = el.scrollHeight;
    } else if (grew) {
      setUnseen((n) => n + 1);
    }
    lastHeight.current = el.scrollHeight;
  }, [items]);

  const onScroll = useCallback((): void => {
    const el = scrollerRef.current;
    if (el === null) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    stickBottom.current = bottom;
    setAtBottom(bottom);
    if (bottom) setUnseen(0);
  }, []);

  const jumpToLatest = useCallback((): void => {
    const el = scrollerRef.current;
    if (el !== null) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    stickBottom.current = true;
    setUnseen(0);
  }, []);

  // The nav row picks up the live title too (AC 11) - including a title
  // that was already projected when this page first painted.
  useEffect(() => {
    if (title !== null) setNavTitle(sessionId, title);
  }, [sessionId, title]);

  const loadOlder = useCallback(async (): Promise<void> => {
    const state = foldRef.current;
    if (state === null || loadingOlder) return;
    const oldest = oldestSeq(state);
    if (oldest === null) return;
    setLoadingOlder(true);
    setOlderError(null);
    const el = scrollerRef.current;
    const before = el !== null ? { height: el.scrollHeight, top: el.scrollTop } : null;
    const result = await loadOlderHistory(sessionId, oldest);
    if (result.ok) {
      prependHistoryPage(state, result.entries, { hasMore: result.hasMore });
      sync();
      // Scroll preservation: the viewport stays anchored to the row it was
      // showing (AC 8 "in place without a scroll jump").
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

  // One floating pill slot by priority: an unanswered approval (AC 16's
  // jump affordance) > new content > reconnect.
  const awaitingApproval = pending.some(
    (card) => card.kind === "approval" && card.state === "pending",
  );
  const pill =
    !atBottom && awaitingApproval ? (
      <button
        type="button"
        onClick={jumpToLatest}
        data-testid="approval-jump"
        className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-amber-500/50 bg-amber-500/15 px-3 py-1 text-xs text-amber-700 shadow-sm backdrop-blur dark:text-amber-400"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        Approval waiting
      </button>
    ) : !atBottom ? (
      <button
        type="button"
        onClick={jumpToLatest}
        data-testid="jump-to-latest"
        className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full border border-border bg-background/95 px-3 py-1 text-xs shadow-sm backdrop-blur"
      >
        {unseen > 0 ? `Jump to latest · ${unseen} new` : "Jump to latest"}
      </button>
    ) : status === "reconnecting" ? (
      <div
        data-testid="reconnecting"
        className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs text-amber-600 dark:text-amber-500"
      >
        Reconnecting…
      </div>
    ) : null;

  return (
    <>
      <header className="flex flex-col gap-0.5 border-b border-border/60 px-4 py-3 sm:px-6">
        <h1 className="truncate text-base font-medium">
          {title ?? navTitleOf(sessionId) ?? "New Session"}
        </h1>
        <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
          {meta?.cwd !== undefined && <span className="truncate font-mono">{meta.cwd}</span>}
          {meta !== null && <span>Updated {formatDate(meta.updatedAt)}</span>}
          <span className="font-mono opacity-60">
            {sessionId.slice("session-".length, 8 + "session-".length)}
          </span>
        </div>
      </header>
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
              <TranscriptRow key={item.id} item={item} sessionId={sessionId} />
            ))}
            {/* The queued strip (AC 14): pending `queued` items at the tail,
                muted, read-only - an item leaves when the agent claims it. */}
            {queue.length > 0 && (
              <div className="mt-2 flex flex-col gap-1 border-t border-dashed border-border/60 pt-2">
                {queue.map((q) => (
                  <div key={q.id} className="truncate text-xs text-muted-foreground italic">
                    {q.text.split("\n")[0]}
                  </div>
                ))}
              </div>
            )}
            {/* Answerable cards (AC 16/17): approvals and question batches at
                the tail, settling from their resolved frames - including when
                another client answered. */}
            {pending.map((card) =>
              card.kind === "approval" ? (
                <ApprovalCard key={card.id} card={card} />
              ) : (
                <QuestionCard key={card.id} card={card} />
              ),
            )}
          </div>
        </div>
        {pill}
      </div>
      {/* The composer (island of its own chrome): steer/queue gestures, the
          stop control while a turn runs, and the inline send Alert (AC 13's
          failure keeps the draft). */}
      <div className="border-t border-border/60 px-4 py-3 sm:px-6">
        <div className="mx-auto w-full max-w-3xl space-y-2">
          {sendError !== null && (
            <Alert variant="destructive">
              <AlertDescription>{sendError}</AlertDescription>
            </Alert>
          )}
          {/* Image intake (AC 18): paste/drop forward to the same staged set
              the picker button opens; limits ride the imageLimits projection
              (absent = no pre-check, the host answers). */}
          <div
            onPasteCapture={(event) => {
              const files = Array.from(event.clipboardData?.files ?? []);
              if (files.some((f) => f.type.startsWith("image/"))) {
                event.preventDefault();
                event.stopPropagation();
                intakeRef.current?.acceptFiles(files);
                setAttachmentCount(intakeRef.current?.count() ?? 0);
              }
            }}
            onDrop={(event) => {
              const files = Array.from(event.dataTransfer?.files ?? []);
              if (files.some((f) => f.type.startsWith("image/"))) {
                event.preventDefault();
                intakeRef.current?.acceptFiles(files);
                setAttachmentCount(intakeRef.current?.count() ?? 0);
              }
            }}
            onDragOver={(event) => {
              if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
            }}
          >
            <ImageIntake
              ref={intakeRef}
              limits={
                foldRef.current?.projections["imageLimits"]?.value as
                  | ImageAttachmentLimits
                  | undefined
              }
            />
          </div>
          <SessionComposer
            hasAttachments={() => (intakeRef.current?.count() ?? 0) > 0}
            referenceSearch={referenceSearch}
            referenceHint="@ files & sessions"
            commands={[...SLASH_MENU_ENTRIES]}
            references={[]}
            sendModes
            running={running}
            onStop={handleStop}
            onSubmit={handleSend}
          />
        </div>
      </div>
    </>
  );
}

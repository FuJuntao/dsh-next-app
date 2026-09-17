"use client";

/**
 * The handback controller (story #146 AC 1-6, AC 8; task #147 commit 4).
 *
 * A stopped session parks its steers and queued follow-ups in the host inbox
 * with nothing coming back for them (the abort throws out of `turn()` and the
 * driver never wakes). This hook is the surface's answer: whenever the host's
 * `session/queue` snapshot still holds human work while no turn is open, it
 * RELEASES that work back to the composer, one item at a time, through the
 * authoritative door - so resuming is the ordinary send gesture and no
 * Continue control has to exist (AC 7).
 *
 * The rules it enforces:
 *   - the trigger is the fold's host state (`runningTurn` + the snapshot),
 *     never a gesture: a Stop here, a reload, or a Stop from another client
 *     all land on the same effect (AC 1);
 *   - only an item the host actually released (`removed`) contributes text;
 *     `not-found` means the loop claimed it at a step boundary or another
 *     client won the remove race, so the transcript owns it and this returns
 *     nothing (AC 2, AC 8 - `handledRef` also stops a double `remove` from
 *     this page);
 *   - a transport failure leaves the item pending and says so in the caller's
 *     inline Alert, without pulling the rest of the batch (AC 2);
 *   - released text arrives as ONE draft, existing typing on top, blank-line
 *     separated (AC 3 - the ordering is `releasableWork`'s, the appending is
 *     the composer handle's);
 *   - image-bearing items never return (AC 4 - `releasableWork` drops them;
 *     the strip renders their residue in commit 5);
 *   - if the operator deletes a returned draft, its ids are acked per browser
 *     so no later drain re-inserts them - ids only, never content (AC 6).
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { removeQueueItem } from "@/lib/chat-send";
import { addDismissed, readDismissed, type AckStorage } from "@/lib/handback-ack";
import { releasableWork, type QueuedItem, type TranscriptState } from "@/lib/transcript";
import type { SessionComposerHandle } from "@/components/session-composer";

export interface UseHandbackArgs {
  sessionId: string;
  foldRef: { readonly current: TranscriptState | null };
  /** The queue mirror: each new host snapshot re-runs the drain predicate. */
  queue: readonly QueuedItem[];
  /** Whether a turn is open (AC 1's "no turn running" half of the trigger). */
  running: boolean;
  composerRef: RefObject<SessionComposerHandle | null>;
  /** The caller's inline Alert slot (the same one a refused send uses). */
  setAlert: (message: string) => void;
}

export interface HandbackApi {
  /** Wire to the composer's `onDraftChange`: tells a dismissed return from a sent one. */
  onDraftChange: (text: string) => void;
  /** The submit path calls this when a send is accepted: the tracked return ran. */
  markSent: () => void;
  /** The one stated line - how many messages returned; null while nothing has. */
  notice: string | null;
}

function storage(): AckStorage | undefined {
  return typeof window === "undefined" ? undefined : window.localStorage;
}

export function useHandback({
  sessionId,
  foldRef,
  queue,
  running,
  composerRef,
  setAlert,
}: UseHandbackArgs): HandbackApi {
  const [notice, setNotice] = useState<string | null>(null);
  // Ids already acked-dismissed by this browser (read once, then mirrored).
  const dismissedRef = useRef<Set<string> | null>(null);
  // Ids this page has already issued a `remove` for: AC 8's one-surface-per-
  // item rule needs the page to never ask twice, whatever the snapshot's
  // next replay or the stream's resync shows.
  const handledRef = useRef<Set<string>>(new Set());
  const inFlightRef = useRef(false);
  // The live return: the joined block sitting in the composer and the ids it
  // came from. Dismissal (the block vanishing without a send) acks the ids.
  const returnedRef = useRef<{ text: string; ids: string[] } | null>(null);

  // Everything above is SESSION-scoped, and the island carries no `key`, so
  // the router may reuse this component when the session param changes (the
  // fold under `foldRef` lives by the same assumption). Own the id and reset
  // when it changes: a stale `handled` set would never release the new
  // session's work, a stale `dismissed` set would silently suppress it, and a
  // stale `returned` block would ack the wrong ids on the next draft edit.
  const ownerRef = useRef(sessionId);
  if (ownerRef.current !== sessionId) {
    ownerRef.current = sessionId;
    handledRef.current = new Set();
    dismissedRef.current = null;
    returnedRef.current = null;
    inFlightRef.current = false;
    setNotice(null); // state adjusted during render (React's derived-state pattern)
  }

  useEffect(() => {
    if (running) return; // a turn is open: its work will be claimed, nothing strands
    const state = foldRef.current;
    if (state === null) return;
    const dismissed = (dismissedRef.current ??= readDismissed(storage(), sessionId));
    const items = releasableWork(state).filter(
      (item) => !dismissed.has(item.id) && !handledRef.current.has(item.id),
    );
    if (items.length === 0) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    void (async () => {
      const releasedIds: string[] = [];
      const texts: string[] = [];
      let transportFailed = false;
      for (const item of items) {
        const result = await removeQueueItem(sessionId, item.id);
        // The host's answer retires an id: `removed` (this page owns the text)
        // or `not-found` (the loop claimed it at a step boundary, or another
        // client released it first - either way the transcript owns it and
        // nothing returns to the composer: AC 2, AC 8).
        if (result.status === "removed" || result.status === "not-found") {
          handledRef.current.add(item.id);
        }
        if (result.status === "removed") {
          releasedIds.push(item.id);
          if (item.text.trim() !== "") texts.push(item.text);
        } else if (result.status !== "not-found") {
          // transport / refused: the item stays pending and UN-handled, so a
          // later snapshot (or a reload) can try again. Break: never pull the
          // rest of the batch past a failed door (AC 2).
          transportFailed = true;
          break;
        }
      }
      inFlightRef.current = false;
      if (releasedIds.length > 0) {
        const block = texts.join("\n\n");
        returnedRef.current = { text: block, ids: [...releasedIds] };
        if (block !== "") composerRef.current?.insertDraft(block);
        // One line, announced once (the live region must CHANGE to speak -
        // clear, then set on the next macrotask, per the Load older note).
        const line =
          releasedIds.length === 1
            ? "Returned 1 message to the composer."
            : `Returned ${String(releasedIds.length)} messages to the composer.`;
        setNotice(null);
        setTimeout(() => setNotice(line), 0);
      }
      if (transportFailed) {
        setAlert(
          "a message is still pending in the stopped session - it could not be returned (the dsh bridge is unavailable)",
        );
      }
    })();
  }, [running, queue, sessionId, foldRef, composerRef, setAlert]);

  const onDraftChange = useCallback(
    (text: string): void => {
      const returned = returnedRef.current;
      if (returned === null) return;
      if (!text.includes(returned.text)) {
        // The returned block left the draft without a send: that is a
        // dismissal. Ack the ids (never the content) so no later drain -
        // this page's next snapshot or the next reload - offers them again.
        addDismissed(storage(), sessionId, returned.ids);
        returnedRef.current = null;
        setNotice(null);
      }
    },
    [sessionId],
  );

  const markSent = useCallback((): void => {
    // The draft left through the send door, not the operator's delete: the
    // returned work is running, so its ids must not be recorded as dismissed.
    returnedRef.current = null;
  }, []);

  return { onDraftChange, markSent, notice };
}

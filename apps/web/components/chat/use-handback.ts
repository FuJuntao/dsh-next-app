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
  /** The submit path calls this when a send is accepted: the tracked return
   * ran, and the notice retires with it (cleared on dismissed or sent). */
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
  // The live return: one entry per released item - its id and the TRIMMED text
  // the draft should still contain. When an entry's text leaves the draft
  // without a send, that item alone was dismissed and its id alone is acked.
  const returnedRef = useRef<{ id: string; probe: string }[] | null>(null);

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
    // AC 2 makes `removed` the licence to write text back - which makes it also
    // the point of no return. Never cross it without a proven receiving end:
    // a null handle here means the composer is not mounted, so releasing would
    // splice the work out of the host with nowhere to put it (no strip residue,
    // no row, nothing). Leave it pending; the next snapshot retries.
    if (composerRef.current === null) return;
    inFlightRef.current = true;
    void (async () => {
      const returned: QueuedItem[] = [];
      // Which arm stopped the batch, for the one line the operator gets.
      let failure:
        | { kind: "transport" }
        | { kind: "refused"; code: string }
        | { kind: "unmounted" }
        | null = null;
      for (const item of items) {
        if (composerRef.current === null) {
          // The page changed under the batch: the ids already released are
          // named in the alert, and the rest stay pending and un-handled.
          failure = { kind: "unmounted" };
          break;
        }
        const result = await removeQueueItem(sessionId, item.id);
        // The host's answer retires an id: `removed` (this page owns the text)
        // or `not-found` (the loop claimed it at a step boundary, or another
        // client released it first - either way the transcript owns it and
        // nothing returns to the composer: AC 2, AC 8).
        if (result.status === "removed" || result.status === "not-found") {
          handledRef.current.add(item.id);
        }
        if (result.status === "removed") {
          returned.push(item);
        } else if (result.status === "transport") {
          failure = { kind: "transport" };
          break; // never pull the rest of the batch past a failed door (AC 2)
        } else if (result.status === "refused") {
          // Distinct from transport on purpose: the host ANSWERED, with a code.
          // Commit 1 exists to keep these apart, so the fold happens nowhere.
          failure = { kind: "refused", code: result.code };
          break;
        }
        // not-found: claimed or raced - nothing returns, keep going.
      }
      inFlightRef.current = false;

      const withText = returned.filter((item) => item.text.trim() !== "");
      if (withText.length > 0) {
        const block = withText.map((item) => item.text).join("\n\n");
        const handle = composerRef.current;
        if (handle === null) {
          // Released but nowhere to write: the work is gone from the host, so
          // say exactly that rather than let it vanish silently.
          failure = { kind: "unmounted" };
        } else {
          handle.insertDraft(block);
          // Recorded AFTER the insertion, on purpose: `insertDraft` fires the
          // draft-change event itself, and the composer reports that text
          // TRIMMED. Tracking the block beforehand would have that own event
          // read as "the operator deleted it" and ack every id on arrival.
          // Probes are trimmed for the same reason - compare like with like.
          returnedRef.current = withText.map((item) => ({
            id: item.id,
            probe: item.text.trim(),
          }));
          // One line, announced once (the live region must CHANGE to speak -
          // clear, then set on the next macrotask, per the Load older note).
          const line =
            withText.length === 1
              ? "Returned 1 message to the composer."
              : `Returned ${String(withText.length)} messages to the composer.`;
          setNotice(null);
          setTimeout(() => setNotice(line), 0);
        }
      }
      if (failure !== null) {
        setAlert(
          failure.kind === "transport"
            ? "a message is still pending in the stopped session - it could not be returned (the dsh bridge is unavailable)"
            : failure.kind === "refused"
              ? `the session would not release a pending message (${failure.code}) - it stays pending in the queue`
              : `the page changed mid-return - released messages could not be placed in the composer and are not recoverable here; check the session's queue`,
        );
      }
    })();
  }, [running, queue, sessionId, foldRef, composerRef, setAlert]);

  const onDraftChange = useCallback(
    (text: string): void => {
      const tracked = returnedRef.current;
      if (tracked === null) return;
      // Per item, not per block: an edit that removes one returned message must
      // ack that id alone and leave the others live. The probe is the item's
      // own trimmed text, which the draft reports in the same space.
      const keptIds: string[] = [];
      const gone: string[] = [];
      for (const entry of tracked) {
        (text.includes(entry.probe) ? keptIds : gone).push(entry.id);
      }
      if (gone.length > 0) {
        // A returned block left the draft without a send: that is a dismissal.
        // Ack the ids (never the content) so no later drain - this page's next
        // snapshot or the next reload - offers them again.
        addDismissed(storage(), sessionId, gone);
      }
      returnedRef.current =
        keptIds.length === 0 ? null : tracked.filter((entry) => keptIds.includes(entry.id));
      if (gone.length > 0) setNotice(null);
    },
    [sessionId],
  );

  const markSent = useCallback((): void => {
    // The draft left through the send door, not the operator's delete: the
    // returned work is running, so its ids must not be recorded as dismissed.
    returnedRef.current = null;
    // The send was accepted, so the notice's job is done - #146's packet
    // clears it "when the returned draft is dismissed or sent", and leaving
    // it up would claim a return that is no longer in the composer.
    setNotice(null);
  }, []);

  return { onDraftChange, markSent, notice };
}

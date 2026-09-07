/**
 * Transcript row renderers (story #134 task #135 commit 4; the read path,
 * then the markdown/tool-view pass, then the style pass that moved the
 * column off cards and onto the shared event row).
 *
 * These components turn a fold item into DOM; they read the model only
 * (lib/transcript.ts) and own no fetch. Layout discipline (AC 25): every
 * body that can carry long content is break-words / overflow-scrolled, so a
 * wide code block never pushes horizontal overflow at 390px.
 *
 * The style rule this file holds to: an event is ONE quiet line, and its
 * detail hangs under it on the rail (components/chat/event-row.tsx). Colour
 * is reserved for the two states that need an answer or a fix - running and
 * failed - so a fifty-row transcript stays scannable.
 */
import { useEffect, useState } from "react";
import {
  RiAlertLine,
  RiBrainLine,
  RiCheckboxCircleLine,
  RiCircleLine,
  RiEditLine,
  RiFileTextLine,
  RiGlobalLine,
  RiInboxLine,
  RiLoaderLine,
  RiSearchLine,
  RiServerLine,
  RiShieldCheckLine,
  RiStackLine,
  RiTerminalBoxLine,
  RiToolsLine,
} from "@remixicon/react";
import { Markdown } from "@/components/chat/markdown";
import {
  DetailBlock,
  EventRow,
  RAIL_BODY,
  RowIcon,
  type RowState,
} from "@/components/chat/event-row";
import { CallBody, ResultBody, toolHeadline } from "@/components/chat/tool-views";
import { cn } from "@/lib/utils";
import type {
  ApprovalRowItem,
  AssistantItem,
  CompactionItem,
  ContextItem,
  RequestItem,
  TodoFoldItem,
  ToolItem,
  TranscriptItem,
  TurnItem,
  UnsupportedItem,
  UserItem,
} from "@/lib/transcript";

/** `19:06` - the clock the built-in surface prints under a message. */
function clockOf(time: number): string {
  const d = new Date(time);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * The tool's mark, chosen from the render intent the host already computed
 * (never from the tool name): the presenter said what this call IS, so the
 * icon is a fact from the host rather than a lookup table that rots.
 */
function toolIcon(item: ToolItem) {
  const card = item.callView?.card ?? item.resultView?.card;
  // `kind` (the category the presenter chose) exists only on the generic
  // call card - a terminal or a diff says its own shape already.
  const kind = item.callView?.card === "generic" ? item.callView.kind : undefined;
  if (card === "terminal") return <RiTerminalBoxLine />;
  if (card === "diff") return <RiEditLine />;
  if (card === "search" || kind === "search") return <RiSearchLine />;
  if (card === "read" || kind === "read") return <RiFileTextLine />;
  if (card === "web" || kind === "fetch") return <RiGlobalLine />;
  if (kind === "edit") return <RiEditLine />;
  if (kind === "delete") return <RiAlertLine />;
  return <RiToolsLine />;
}

/** One transcript image via the attachment door (AC 20): the URL carries only
 * the opaque id + session; bytes arrive through the host's log-reference proof. */
export function AttachmentImage({
  sessionId,
  attachmentId,
  name,
}: {
  sessionId: string;
  attachmentId: string;
  name?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- transcript images are runtime attachments, not build-time known; next/image would need remote loader config for a same-origin dynamic route.
    <img
      src={`/api/attachment?sessionId=${encodeURIComponent(sessionId)}&attachmentId=${encodeURIComponent(attachmentId)}`}
      alt={name ?? "image"}
      loading="lazy"
      className="max-h-64 max-w-full rounded-none border border-border/60 object-contain"
    />
  );
}

/** A human prompt: the one bubble in the column, right-aligned like a reply. */
export function UserRow({ item, sessionId }: { item: UserItem; sessionId: string }) {
  return (
    <div className="group/row flex flex-col items-end gap-0.5 py-1.5">
      <div
        className={`max-w-[85%] whitespace-pre-wrap break-words rounded-none border px-3.5 py-2 text-sm leading-normal ${
          item.failed
            ? "border-destructive/40 bg-destructive/10"
            : "border-secondary/60 bg-secondary"
        } ${item.provisional ? "opacity-70" : ""}`}
      >
        {item.text}
        {item.images.length > 0 && (
          <div className="mt-1.5 flex flex-wrap justify-end gap-1">
            {item.images.map((image) => (
              <AttachmentImage
                key={image.attachmentId}
                sessionId={sessionId}
                attachmentId={image.attachmentId}
                {...(image.name !== undefined ? { name: image.name } : {})}
              />
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5 pr-1 text-2xs text-muted-foreground/60">
        {item.failed === true && <span className="text-destructive">Not sent</span>}
        {item.provisional === true && item.failed !== true && <span>Sending…</span>}
        <span className="font-mono">{clockOf(item.time)}</span>
      </div>
    </div>
  );
}

/**
 * An assistant message: plain prose on the rail, never a bubble - it is the
 * transcript's body text, and boxing it would put every word in chrome.
 * Reasoning rides its own collapsed line above the answer, because the
 * reader chooses whether to watch the thinking.
 */
export function AssistantRow({ item }: { item: AssistantItem }) {
  const reasoningFirst = item.reasoning.split("\n")[0] ?? "";
  return (
    <div className="py-1">
      {item.reasoning !== "" && (
        <EventRow
          icon={
            item.streaming && item.text === "" ? (
              <RiLoaderLine className="animate-spin" />
            ) : (
              <RiBrainLine />
            )
          }
          label="Thinking"
          detail={reasoningFirst.slice(0, 120)}
          state={item.streaming && item.text === "" ? "running" : "done"}
        >
          <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground italic">
            {item.reasoning}
          </div>
        </EventRow>
      )}
      {item.text !== "" && (
        // Flush with the row icons: the answer is top-level content, not a
        // child of the Thinking row above it.
        <div className="pl-2 pr-1">
          <Markdown text={item.text} streaming={item.streaming} />
        </div>
      )}
      {item.interrupted === true && (
        <div className="flex min-h-5 items-center pl-2">
          <span className="text-xs text-muted-foreground/70">Stopped mid-reply</span>
        </div>
      )}
    </div>
  );
}

/**
 * The tool card (AC 4): one line - the host's title, then the result's
 * title - and the call/result bodies on the rail below it. A FAILED row is
 * destructive-tinted and open, so the error needs no click; a row still
 * waiting on its result reads as running. Events carrying a host view
 * render it (tool-views.tsx); the rest fall back to the raw args and result.
 */
export function ToolRow({ item }: { item: ToolItem }) {
  const failed = item.error !== undefined || item.result?.isError === true;
  const running = item.result === undefined && item.error === undefined;
  const state: RowState = failed ? "failed" : running ? "running" : "done";
  const headline = toolHeadline(item.callView, item.resultView, item.name, item.arguments);
  return (
    <EventRow
      icon={
        running ? (
          <RiLoaderLine className="animate-spin motion-reduce:animate-none" />
        ) : (
          toolIcon(item)
        )
      }
      label={item.name}
      detail={headline}
      state={state}
      defaultOpen={failed}
    >
      <CallBody view={item.callView} rawArgs={item.arguments} />
      {item.result !== undefined && <ResultBody view={item.resultView} fold={item.result} />}
    </EventRow>
  );
}

/** The live checklist (AC 3): one row that opens onto the three-state list. */
export function TodoRow({ item }: { item: TodoFoldItem }) {
  const done = item.todos.filter((todo) => todo.status === "completed").length;
  return (
    <EventRow
      icon={<RiCheckboxCircleLine />}
      label="Tasks"
      detail={`${done} of ${item.todos.length} done`}
    >
      <ul className="space-y-0.5">
        {item.todos.map((todo, index) => (
          <li key={index} className="flex items-start gap-2 text-sm leading-5">
            <span
              aria-hidden
              className={`mt-[3px] flex h-4 w-4 shrink-0 items-center justify-center ${
                todo.status === "completed"
                  ? "text-primary"
                  : todo.status === "in_progress"
                    ? "text-muted-foreground"
                    : "text-muted-foreground/40"
              }`}
            >
              {todo.status === "completed" ? (
                <RiCheckboxCircleLine className="h-4 w-4" />
              ) : todo.status === "in_progress" ? (
                <RiLoaderLine className="h-4 w-4 animate-spin motion-reduce:animate-none" />
              ) : (
                <RiCircleLine className="h-4 w-4" />
              )}
            </span>
            <span
              className={todo.status === "completed" ? "text-muted-foreground line-through" : ""}
            >
              {todo.content}
            </span>
          </li>
        ))}
      </ul>
    </EventRow>
  );
}

/** The compaction divider (AC 3, AC 6): a rule with a labelled summary. */
export function CompactionRow({ item }: { item: CompactionItem }) {
  return (
    <div className="my-3">
      <div className="flex items-center gap-2 text-2xs tracking-wide text-muted-foreground/70">
        <span aria-hidden className="h-px flex-1 bg-border" />
        <span className="shrink-0 uppercase">Context compacted</span>
        <span aria-hidden className="shrink-0 font-mono">
          {item.shadowedCount} hidden
        </span>
        <span aria-hidden className="h-px flex-1 bg-border" />
      </div>
      <details className="group/row mt-1">
        <summary className="list-none cursor-pointer rounded-none px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted/60 [&::-webkit-details-marker]:hidden">
          Read the summary
        </summary>
        <div
          className={cn(
            RAIL_BODY,
            "text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap break-words",
          )}
        >
          {item.summary}
        </div>
      </details>
    </div>
  );
}

/** The request disclosure (AC 3): what was asked of the provider, in one line. */
export function RequestRow({ item }: { item: RequestItem }) {
  const model =
    item.context !== undefined ? `${item.context.provider}/${item.context.model}` : undefined;
  const window =
    item.context?.contextWindow !== undefined
      ? ` · ${Math.round(item.context.contextWindow / 1000)}k ctx`
      : "";
  return (
    <EventRow
      icon={<RiServerLine />}
      label="Request"
      detail={[item.header?.reason, model !== undefined ? model + window : undefined]
        .filter((part): part is string => part !== undefined)
        .join(" · ")}
      className="opacity-80"
    />
  );
}

/** A synthetic context injection (AGENTS.md, notices): a labelled line. */
export function ContextRow({ item }: { item: ContextItem }) {
  const label = item.summary ?? (item.form !== undefined ? item.form : item.source);
  return (
    <EventRow icon={<RiStackLine />} label="Context" detail={label} className="opacity-90">
      <div className="text-2xs font-medium uppercase tracking-wide text-muted-foreground/60">
        {item.source}
      </div>
      <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-none bg-muted/40 px-2.5 py-2 font-mono text-xs leading-normal">
        {item.text}
      </pre>
    </EventRow>
  );
}

/**
 * Turn boundary (AC 3). A completed turn needs no row - the assistant's
 * reply already says the work ended - so it renders as nothing; an
 * interrupted one says what stopped it, in the colour of the fact.
 */
export function TurnRow({ item }: { item: TurnItem }) {
  if (item.state === "completed") return null;
  if (item.state === "running") {
    return (
      <div className="flex items-center gap-2 py-1 pl-2 text-sm text-primary">
        <RowIcon state="running">
          <RiLoaderLine className="animate-spin motion-reduce:animate-none" />
        </RowIcon>
        Working
        <span
          aria-hidden
          className="h-1 w-1 animate-pulse rounded-full bg-primary motion-reduce:hidden"
        />
      </div>
    );
  }
  const label =
    item.state === "aborted"
      ? "Turn stopped"
      : item.state === "error"
        ? "Turn failed"
        : item.state === "max-tokens"
          ? "Turn hit the token limit"
          : item.state === "blocked"
            ? "Turn blocked"
            : "Turn interrupted";
  return (
    <EventRow
      icon={<RiAlertLine />}
      label={label}
      detail={item.detail}
      state={item.state === "error" ? "failed" : "notice"}
    />
  );
}

/** AC 7's fail-loud row: a record this build does not know how to render. */
export function UnsupportedRow({ item }: { item: UnsupportedItem }) {
  return (
    <EventRow icon={<RiAlertLine />} label="Unsupported record" detail={item.type} state="notice" />
  );
}

/** The durable approval audit pair (AC 16's history form). */
export function ApprovalRow({ item }: { item: ApprovalRowItem }) {
  const settled = item.outcome !== undefined;
  return (
    <EventRow
      icon={<RiShieldCheckLine />}
      label="Approval"
      detail={
        <>
          <span className="font-mono">{item.toolName}</span>
          {settled ? ` · ${item.outcome}` : " · waiting"}
          {item.reason !== undefined && item.reason !== "" ? ` — ${item.reason}` : ""}
        </>
      }
      state={item.outcome === "rejected" ? "notice" : "done"}
    />
  );
}

/**
 * The queued strip (AC 14): the pending `queued` items at the tail, muted
 * and read-only. One row of chrome over a list of first lines - an item
 * leaves when the agent claims it, so nothing here is editable.
 */
export function QueueStrip({ queue }: { queue: readonly { id: string; text: string }[] }) {
  if (queue.length === 0) return null;
  return (
    <div className="mt-2">
      <EventRow
        icon={<RiInboxLine />}
        label="Queued"
        detail={
          queue.length === 1
            ? "one message waiting for the turn"
            : `${queue.length} messages waiting for the turn`
        }
        state="idle"
        className="opacity-90"
      />
      {/* The items hang off the same rail an expanded row uses. */}
      <ul className={cn("space-y-0.5", RAIL_BODY)}>
        {queue.map((q) => (
          <li key={q.id} className="truncate text-xs text-muted-foreground/80">
            {q.text.split("\n")[0]}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The live tail line while a turn runs (this app's answer to the built-in
 * surface's "Deep diving... 4m 04s"). It appears only when nothing else in
 * the column is already saying HOW the turn is busy - a streaming bubble has
 * its own caret, an open tool row has its own spinner - so it reads as "the
 * agent is on it" rather than a third progress widget.
 *
 * The clock ticks inside this component alone: one interval re-renders one
 * line, never the whole transcript.
 */
export function TurnLive({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.round((now - since) / 1000));
  const elapsed =
    seconds < 60
      ? `${String(seconds)}s`
      : `${String(Math.floor(seconds / 60))}m ${String(seconds % 60).padStart(2, "0")}s`;
  return (
    <div className="flex items-center gap-2 py-1 pl-2 text-sm leading-5 text-primary">
      <RowIcon state="running">
        <RiLoaderLine className="animate-spin motion-reduce:animate-none" />
      </RowIcon>
      <span className="font-medium">Working</span>
      <span aria-hidden className="text-primary/40">
        ·
      </span>
      <span className="font-mono text-xs text-primary/70">{elapsed}</span>
    </div>
  );
}

/** Dispatch one fold item to its row component. */
export function TranscriptRow({ item, sessionId }: { item: TranscriptItem; sessionId: string }) {
  switch (item.kind) {
    case "user":
      return <UserRow item={item} sessionId={sessionId} />;
    case "assistant":
      return <AssistantRow item={item} />;
    case "tool":
      return <ToolRow item={item} />;
    case "todo":
      return <TodoRow item={item} />;
    case "compaction":
      return <CompactionRow item={item} />;
    case "request":
      return <RequestRow item={item} />;
    case "context":
      return <ContextRow item={item} />;
    case "turn":
      return <TurnRow item={item} />;
    case "unsupported":
      return <UnsupportedRow item={item} />;
    case "approval-row":
      return <ApprovalRow item={item} />;
    default:
      return null;
  }
}

/** Re-exported for the tool bodies, which render inside the same rail. */
export { DetailBlock };

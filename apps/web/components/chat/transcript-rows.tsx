/**
 * Transcript row renderers (story #134 task #135 commit 4: the read path;
 * commit 5 upgrades the text/tool bodies to markdown + Shiki + rich tool
 * views). These components turn a fold item into DOM; they read the model
 * only (lib/transcript.ts) and own no fetch. The commit-4 bodies render
 * plain text so the first paint is correct before the markdown pass lands.
 *
 * Layout discipline (AC 25): every body that can carry long content
 * (messages, code, tool args/results) is break-words / overflow-x-scrolled
 * so a wide code block never pushes horizontal overflow at 390px.
 */
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

/** A human prompt: right-aligned bubble, images as labelled chips (commit 9 renders them). */
export function UserRow({ item }: { item: UserItem }) {
  return (
    <div className="flex flex-col items-end gap-1 py-1">
      <div
        className={`max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm ${
          item.failed ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-foreground"
        } ${item.provisional ? "opacity-70" : ""}`}
      >
        {item.text}
        {item.images.length > 0 && (
          <span className="mt-1 block text-xs text-muted-foreground">
            {item.images.length} image{item.images.length > 1 ? "s" : ""}
          </span>
        )}
        {item.provisional === true && <span className="ml-2 text-xs text-muted-foreground">…</span>}
      </div>
    </div>
  );
}

/** An assistant bubble; `streaming` shows an open fence, commit 5 renders markdown. */
export function AssistantRow({ item }: { item: AssistantItem }) {
  return (
    <div className="py-1">
      {item.reasoning !== "" && (
        <details className="mb-1 text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">Thinking</summary>
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words font-mono">
            {item.reasoning}
          </pre>
        </details>
      )}
      <div className="whitespace-pre-wrap break-words text-sm">
        {item.text}
        {item.streaming && (
          <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-foreground/50 align-middle" />
        )}
        {item.interrupted === true && (
          <span className="ml-2 text-xs italic text-muted-foreground">(interrupted)</span>
        )}
      </div>
    </div>
  );
}

/** A collapsed generic tool card (AC 4): one summary line, expands to args + result. */
export function ToolRow({ item }: { item: ToolItem }) {
  const failed = item.error !== undefined || item.result?.isError === true;
  return (
    <details
      className={`my-1 rounded-md border text-sm ${failed ? "border-destructive/40 bg-destructive/5" : "border-border bg-muted/30"}`}
    >
      <summary className="flex cursor-pointer items-center gap-2 px-2 py-1 select-none">
        <span
          className={`h-1.5 w-1.5 rounded-full ${item.result === undefined ? "bg-amber-400" : failed ? "bg-destructive" : "bg-emerald-500"}`}
        />
        <span className="font-mono text-xs">{item.name}</span>
        <span className="truncate text-xs text-muted-foreground">
          {item.result?.text.split("\n")[0]?.slice(0, 80) ?? item.arguments.slice(0, 80)}
        </span>
      </summary>
      <div className="space-y-2 border-t border-border/60 px-2 py-2">
        <div>
          <div className="mb-0.5 text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">
            Arguments
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-background/60 p-2 font-mono text-xs">
            {item.arguments}
          </pre>
        </div>
        {item.result !== undefined && (
          <div>
            <div className="mb-0.5 text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">
              Result
            </div>
            <pre
              className={`max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-background/60 p-2 font-mono text-xs ${item.result.isError ? "text-destructive" : ""}`}
            >
              {item.result.text}
            </pre>
          </div>
        )}
      </div>
    </details>
  );
}

/** The live checklist (AC 3): three-state todo snapshot. */
export function TodoRow({ item }: { item: TodoFoldItem }) {
  return (
    <div className="my-2 rounded-md border border-border bg-card p-3">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Tasks
      </div>
      <ul className="space-y-1">
        {item.todos.map((todo, index) => (
          <li key={index} className="flex items-center gap-2 text-sm">
            <span
              aria-hidden
              className={`flex h-4 w-4 items-center justify-center rounded-full border ${
                todo.status === "completed"
                  ? "border-emerald-500 bg-emerald-500 text-white"
                  : todo.status === "in_progress"
                    ? "border-amber-500"
                    : "border-muted-foreground/40"
              }`}
            >
              {todo.status === "completed" ? "✓" : todo.status === "in_progress" ? "◐" : ""}
            </span>
            <span
              className={todo.status === "completed" ? "text-muted-foreground line-through" : ""}
            >
              {todo.content}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The compaction divider (AC 3, AC 6): a rule with a labelled summary disclosure. */
export function CompactionRow({ item }: { item: CompactionItem }) {
  return (
    <div className="my-3 flex flex-col items-center gap-1">
      <div className="flex w-full items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        <details className="rounded-full border border-border px-2 py-0.5">
          <summary className="cursor-pointer select-none whitespace-nowrap">
            Context compacted ({item.shadowedCount})
          </summary>
          <pre className="mt-2 max-h-64 max-w-full overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-2 text-left font-mono text-xs">
            {item.summary}
          </pre>
        </details>
        <span className="h-px flex-1 bg-border" />
      </div>
    </div>
  );
}

/** The request disclosure (AC 3): collapsed header/context metadata. */
export function RequestRow({ item }: { item: RequestItem }) {
  return (
    <details className="my-1 rounded border border-dashed border-border/60 text-xs text-muted-foreground">
      <summary className="cursor-pointer select-none px-2 py-1">
        Request {item.header !== undefined ? `(${item.header.reason})` : ""}
        {item.context !== undefined ? ` · ${item.context.provider}/${item.context.model}` : ""}
      </summary>
      <div className="px-2 pb-1.5">
        {item.context !== undefined && (
          <div className="font-mono">
            {item.context.provider} / {item.context.model}
            {item.context.contextWindow !== undefined ? ` · ctx ${item.context.contextWindow}` : ""}
          </div>
        )}
      </div>
    </details>
  );
}

/** A synthetic context injection (AGENTS.md, notices): a quiet labelled line. */
export function ContextRow({ item }: { item: ContextItem }) {
  const label = item.summary ?? (item.form !== undefined ? item.form : item.source);
  return (
    <details className="my-1 rounded border-l-2 border-border/60 pl-2 text-xs text-muted-foreground">
      <summary className="cursor-pointer select-none">{label}</summary>
      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words">{item.text}</pre>
    </details>
  );
}

/** Turn boundary; failed/aborted are marked visibly (AC 3). */
export function TurnRow({ item }: { item: TurnItem }) {
  if (item.state === "completed") return <hr className="my-2 border-border/50" />;
  if (item.state === "running")
    return <div className="my-1 text-xs text-muted-foreground">turn running…</div>;
  const label =
    item.state === "aborted" ? "stopped" : item.state === "error" ? "failed" : item.state;
  return (
    <div
      className={`my-2 rounded px-2 py-1 text-xs ${item.state === "error" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}
    >
      Turn {label}
      {item.detail !== undefined && <span className="ml-1 opacity-80">— {item.detail}</span>}
    </div>
  );
}

/** AC 7's fail-loud row. */
export function UnsupportedRow({ item }: { item: UnsupportedItem }) {
  return (
    <div className="my-1 rounded border border-amber-500/40 bg-amber-500/5 px-2 py-1 text-xs text-amber-600 dark:text-amber-500">
      Unsupported record: <span className="font-mono">{item.type}</span>
    </div>
  );
}

/** A durable approval audit pair (AC 16's history form). */
export function ApprovalRow({ item }: { item: ApprovalRowItem }) {
  return (
    <div className="my-1 flex items-center gap-2 rounded border border-border bg-muted/30 px-2 py-1 text-xs">
      <span className="font-mono">{item.toolName}</span>
      <span className="text-muted-foreground">
        approval {item.outcome !== undefined ? item.outcome : "requested"}
      </span>
    </div>
  );
}

/** Dispatch one fold item to its row component. */
export function TranscriptRow({ item }: { item: TranscriptItem }) {
  switch (item.kind) {
    case "user":
      return <UserRow item={item} />;
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

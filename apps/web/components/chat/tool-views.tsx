"use client";

/**
 * Tool view card bodies (story #134 task #135 commit 5, AC 4).
 *
 * The host computes a render intent (ToolCallView / ToolResultView - a
 * card-tagged union from dsh-tools' presentation vocabulary) alongside a
 * tool event; this module is the app's mapping of those cards. A tool
 * event WITHOUT a view is not special-cased here - the transcript's
 * generic collapsed card (transcript-rows.tsx) is the documented default,
 * expanding to raw args and result.
 *
 * Every card degrades one notch: an unknown `card` tag (the union grows
 * beside this file) falls through to the raw text, never to a blank or a
 * crash - the same fail-visible posture as the fold's unknown-record row.
 */
import type { ToolCallView, ToolResultView } from "@deepseek-ai/dsh-host-apiproxy/api";
import type { ToolResultFold } from "@/lib/transcript";
import { Markdown } from "@/components/chat/markdown";

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** The one-line summary for a collapsed card (call view first, result title after). */
export function toolHeadline(
  callView: ToolCallView | undefined,
  resultView: ToolResultView | undefined,
  name: string,
  args: string,
): string {
  const resultTitle =
    resultView !== undefined ? str((resultView as { title?: unknown }).title) : "";
  if (resultTitle !== "") return resultTitle;
  if (callView !== undefined) return callView.title;
  const first = args.split("\n")[0] ?? "";
  return first.length > 0 ? `${name} ${first.slice(0, 90)}` : name;
}

function DiffBlock({
  diffs,
}: {
  diffs: { path: string; oldText: string | null; newText: string }[];
}) {
  return (
    <div className="space-y-2">
      {diffs.map((diff, index) => (
        <div key={index} className="overflow-hidden rounded-md border border-border/60">
          <div className="border-b border-border/60 bg-muted/40 px-2 py-1 font-mono text-xs">
            {diff.path}
          </div>
          <div className="grid grid-cols-1 font-mono text-xs sm:grid-cols-2">
            <pre
              className={`overflow-x-auto whitespace-pre-wrap break-words p-2 ${diff.oldText === null ? "" : "bg-destructive/10"}`}
            >
              {diff.oldText ?? (diffs.length > 0 ? "(new file)" : "")}
            </pre>
            <pre className="overflow-x-auto whitespace-pre-wrap break-words border-t border-border/40 p-2 bg-emerald-500/10 sm:border-t-0 sm:border-l">
              {diff.newText}
            </pre>
          </div>
        </div>
      ))}
    </div>
  );
}

function Blocks({ blocks }: { blocks: unknown[] }) {
  // View content blocks: text renders through markdown, images stay chips
  // (structured transcript images belong to messages, not views).
  return (
    <>
      {blocks.map((block, index) => {
        if (block === null || typeof block !== "object") return null;
        const b = block as Record<string, unknown>;
        if (b["type"] === "text") return <Markdown key={index} text={str(b["text"])} />;
        if (b["type"] === "code" || b["type"] === "terminal")
          return (
            <pre
              key={index}
              className="my-1 overflow-x-auto rounded bg-muted/60 p-2 font-mono text-xs whitespace-pre"
            >
              {str(b["text"]) + str(b["content"])}
            </pre>
          );
        return null;
      })}
    </>
  );
}

/** The expanded call body for the view kind (or the raw args when none). */
export function CallBody({ view, rawArgs }: { view: ToolCallView | undefined; rawArgs: string }) {
  if (view === undefined) {
    return (
      <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-background/60 p-2 font-mono text-xs">
        {rawArgs}
      </pre>
    );
  }
  switch (view.card) {
    case "terminal":
      return (
        <div className="space-y-1">
          {view.description !== undefined && (
            <div className="text-xs text-muted-foreground">{view.description}</div>
          )}
          <div className="font-mono text-xs">{`$ ${view.title}`}</div>
          {view.cwd !== undefined && (
            <div className="font-mono text-[0.7rem] text-muted-foreground">cwd {view.cwd}</div>
          )}
        </div>
      );
    case "diff":
      return <DiffBlock diffs={view.diffs} />;
    case "generic":
      return (
        <div className="space-y-2">
          {view.content !== undefined && <Blocks blocks={[...view.content]} />}
          {view.rawInput !== undefined && (
            <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-background/60 p-2 font-mono text-xs">
              {typeof view.rawInput === "string"
                ? view.rawInput
                : JSON.stringify(view.rawInput, null, 2)}
            </pre>
          )}
          {view.content === undefined && view.rawInput === undefined && (
            <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-background/60 p-2 font-mono text-xs">
              {rawArgs}
            </pre>
          )}
        </div>
      );
    default:
      return (
        <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-background/60 p-2 font-mono text-xs">
          {rawArgs}
        </pre>
      );
  }
}

/** The expanded result body for the view kind (or the folded raw result). */
export function ResultBody({
  view,
  fold,
}: {
  view: ToolResultView | undefined;
  fold: ToolResultFold;
}) {
  if (view === undefined) {
    return (
      <pre
        className={`max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-background/60 p-2 font-mono text-xs ${fold.isError ? "text-destructive" : ""}`}
      >
        {fold.text}
      </pre>
    );
  }
  switch (view.card) {
    case "terminal":
      return (
        <div className="space-y-1">
          {typeof view.exitCode === "number" && (
            <div
              className={`text-xs ${view.exitCode === 0 ? "text-emerald-600" : "text-destructive"}`}
            >
              exit {view.exitCode}
              {view.signal !== undefined ? ` (signal ${view.signal})` : ""}
            </div>
          )}
          {view.output !== undefined ? (
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-background/60 p-2 font-mono text-xs">
              {view.output}
            </pre>
          ) : fold.text !== "" ? (
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-background/60 p-2 font-mono text-xs">
              {fold.text}
            </pre>
          ) : null}
        </div>
      );
    case "diff":
      return <DiffBlock diffs={view.diffs} />;
    case "read":
      return (
        <div>
          <div className="mb-1 font-mono text-xs text-muted-foreground">
            {view.path} · lines {view.offset}&ndash;{view.offset + view.lines.length - 1} of{" "}
            {view.totalLines}
          </div>
          <pre className="max-h-80 overflow-auto rounded bg-background/60 p-2 font-mono text-xs">
            {view.lines
              .map((line) => `${String(line.number).padStart(4, " ")}  ${line.text}`)
              .join("\n")}
          </pre>
        </div>
      );
    case "search": {
      if (view.shape === "paths") {
        return (
          <div className="font-mono text-xs">
            {view.paths.map((path, index) => (
              <div key={index}>{path}</div>
            ))}
            {view.truncated && (
              <div className="text-muted-foreground">… {view.total} total (capped)</div>
            )}
          </div>
        );
      }
      return (
        <div className="space-y-1 text-xs">
          {view.files.map((file, index) => (
            <div key={index}>
              <div className="font-mono">{file.path}</div>
              {file.matches.map((match, mi) => (
                <div key={mi} className="pl-3 font-mono text-muted-foreground">
                  <span className="opacity-60">{match.lineNumber}: </span>
                  {match.line}
                </div>
              ))}
            </div>
          ))}
          {view.truncated && (
            <div className="text-muted-foreground">… {view.total} total (capped)</div>
          )}
        </div>
      );
    }
    case "web":
      if (view.kind === "fetch") {
        return (
          <div className="space-y-1 text-xs">
            <div className="font-mono">
              <a
                className="text-primary underline underline-offset-2"
                href={view.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {view.url}
              </a>{" "}
              <span
                className={view.statusCode >= 400 ? "text-destructive" : "text-muted-foreground"}
              >
                {view.statusCode}
                {view.truncated ? " · truncated" : ""}
              </span>
            </div>
            {fold.text !== "" && (
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-background/60 p-2 font-mono text-xs">
                {fold.text}
              </pre>
            )}
          </div>
        );
      }
      return (
        <div className="space-y-1 text-xs">
          {view.answer !== undefined && <Markdown text={view.answer} />}
          {view.sources.map((source, index) => (
            <div key={index} className="font-mono">
              <a
                className="text-primary underline underline-offset-2"
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {source.title ?? source.url}
              </a>
            </div>
          ))}
        </div>
      );
    case "generic":
      return view.content !== undefined ? (
        <Blocks blocks={[...view.content]} />
      ) : (
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-background/60 p-2 font-mono text-xs">
          {fold.text}
        </pre>
      );
    default:
      return null;
  }
}

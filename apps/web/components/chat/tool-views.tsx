"use client";

/**
 * Tool view card bodies (story #134 task #135 commit 5, AC 4; restyled in
 * the style pass so every body hangs off the event row's rail instead of
 * carrying its own boxes).
 *
 * The host computes a render intent (ToolCallView / ToolResultView - a
 * card-tagged union from dsh-tools' presentation vocabulary) alongside a
 * tool event; this module is the app's mapping of those cards. A tool event
 * WITHOUT a view is not special-cased here - the transcript's generic row
 * (transcript-rows.tsx) is the documented default, expanding to raw args and
 * result.
 *
 * Every card degrades one notch: an unknown `card` tag (the union grows
 * beside this file) falls through to the raw text, never to a blank or a
 * crash - the same fail-visible posture as the fold's unknown-record row.
 */
import type { ToolCallView, ToolResultView } from "@deepseek-ai/dsh-host-apiproxy/api";
import type { ToolResultFold } from "@/lib/transcript";
import { DetailBlock } from "@/components/chat/event-row";
import { Markdown } from "@/components/chat/markdown";

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** The one-line summary for a collapsed row (call title, then result title). */
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

/** A side-by-side change; the two columns collapse to one on a phone. */
function DiffBlock({
  diffs,
}: {
  diffs: { path: string; oldText: string | null; newText: string }[];
}) {
  return (
    <div className="mb-2 space-y-2 last:mb-0">
      {diffs.map((diff, index) => (
        <div key={index} className="overflow-hidden rounded-md border border-border/60">
          <div className="truncate bg-muted/50 px-2.5 py-1 font-mono text-[0.72rem] text-muted-foreground">
            {diff.path}
          </div>
          <div className="grid grid-cols-1 font-mono text-[0.72rem] leading-[1.5] sm:grid-cols-2">
            <pre
              className={`overflow-x-auto whitespace-pre-wrap break-words p-2.5 ${
                diff.oldText === null ? "" : "bg-destructive/8"
              }`}
            >
              {diff.oldText ?? "(new file)"}
            </pre>
            <pre className="overflow-x-auto whitespace-pre-wrap break-words border-t border-border/40 bg-emerald-500/8 p-2.5 sm:border-t-0 sm:border-l">
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
            <DetailBlock key={index} mono>
              {str(b["text"]) + str(b["content"])}
            </DetailBlock>
          );
        return null;
      })}
    </>
  );
}

/** The expanded call body for the view kind (or the raw args when none). */
export function CallBody({ view, rawArgs }: { view: ToolCallView | undefined; rawArgs: string }) {
  if (view === undefined) {
    if (rawArgs === "") return null;
    return (
      <DetailBlock label="Input" mono>
        {rawArgs}
      </DetailBlock>
    );
  }
  switch (view.card) {
    case "terminal":
      return (
        <div className="mb-2 space-y-1 last:mb-0">
          {view.description !== undefined && view.description !== "" && (
            <div className="text-[0.8rem] text-muted-foreground">{view.description}</div>
          )}
          <DetailBlock mono>
            <span aria-hidden className="text-muted-foreground select-none">
              $
            </span>{" "}
            {view.title}
          </DetailBlock>
          {view.cwd !== undefined && (
            <div className="truncate font-mono text-[0.7rem] text-muted-foreground/70">
              in {view.cwd}
            </div>
          )}
        </div>
      );
    case "diff":
      return <DiffBlock diffs={view.diffs} />;
    case "generic":
      return (
        <>
          {view.content !== undefined && <Blocks blocks={[...view.content]} />}
          {view.rawInput !== undefined && (
            <DetailBlock label="Input" mono>
              {typeof view.rawInput === "string"
                ? view.rawInput
                : JSON.stringify(view.rawInput, null, 2)}
            </DetailBlock>
          )}
          {view.content === undefined && view.rawInput === undefined && rawArgs !== "" && (
            <DetailBlock label="Input" mono>
              {rawArgs}
            </DetailBlock>
          )}
        </>
      );
    default:
      return rawArgs === "" ? null : (
        <DetailBlock label="Input" mono>
          {rawArgs}
        </DetailBlock>
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
  const tone = fold.isError ? "error" : "plain";
  if (view === undefined) {
    if (fold.text === "") return null;
    return (
      <DetailBlock label="Result" mono tone={tone}>
        {fold.text}
      </DetailBlock>
    );
  }
  switch (view.card) {
    case "terminal": {
      const output = view.output ?? fold.text;
      return (
        <div className="mb-2 space-y-1 last:mb-0">
          {typeof view.exitCode === "number" && (
            <div
              className={`font-mono text-[0.72rem] ${
                view.exitCode === 0 ? "text-muted-foreground/70" : "text-destructive"
              }`}
            >
              exit {view.exitCode}
              {view.signal !== undefined ? ` · signal ${view.signal}` : ""}
            </div>
          )}
          {output !== "" && (
            <DetailBlock label="Output" mono tone={tone}>
              {output}
            </DetailBlock>
          )}
        </div>
      );
    }
    case "diff":
      return <DiffBlock diffs={view.diffs} />;
    case "read":
      return (
        <DetailBlock label="Result" mono>
          <div className="mb-1 text-muted-foreground/70">
            {view.path} · lines {view.offset}&ndash;{view.offset + view.lines.length - 1} of{" "}
            {view.totalLines}
          </div>
          {view.lines
            .map((line) => `${String(line.number).padStart(4, " ")}  ${line.text}`)
            .join("\n")}
        </DetailBlock>
      );
    case "search": {
      if (view.shape === "paths") {
        return (
          <DetailBlock label="Paths" mono>
            {view.paths.join("\n")}
            {view.truncated && (
              <div className="text-muted-foreground/70">… {view.total} total (capped)</div>
            )}
          </DetailBlock>
        );
      }
      return (
        <DetailBlock label="Matches" mono>
          {view.files.map((file, index) => (
            <div key={index} className="mb-1.5 last:mb-0">
              <div className="text-foreground/80">{file.path}</div>
              {file.matches.map((match, mi) => (
                <div key={mi} className="pl-3 text-muted-foreground">
                  <span className="opacity-60">{match.lineNumber}: </span>
                  {match.line}
                </div>
              ))}
            </div>
          ))}
          {view.truncated && (
            <div className="text-muted-foreground/70">… {view.total} total (capped)</div>
          )}
        </DetailBlock>
      );
    }
    case "web":
      if (view.kind === "fetch") {
        return (
          <div className="mb-2 space-y-1.5 last:mb-0">
            <div className="flex min-w-0 items-baseline gap-2 text-[0.78rem]">
              <a
                className="min-w-0 truncate font-mono text-primary underline-offset-2 hover:underline"
                href={view.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {view.url}
              </a>
              <span
                className={`shrink-0 font-mono text-[0.72rem] ${
                  view.statusCode >= 400 ? "text-destructive" : "text-muted-foreground/70"
                }`}
              >
                {view.statusCode}
                {view.truncated ? " · truncated" : ""}
              </span>
            </div>
            {fold.text !== "" && (
              <DetailBlock label="Body" mono tone={tone}>
                {fold.text}
              </DetailBlock>
            )}
          </div>
        );
      }
      return (
        <div className="mb-2 space-y-1.5 last:mb-0">
          {view.answer !== undefined && view.answer !== "" && <Markdown text={view.answer} />}
          <ul className="space-y-0.5">
            {view.sources.map((source, index) => (
              <li key={index} className="flex min-w-0 items-baseline gap-2 text-[0.78rem]">
                <a
                  className="min-w-0 truncate text-primary underline-offset-2 hover:underline"
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {source.title ?? source.url}
                </a>
                {source.snippet !== undefined && (
                  <span className="hidden min-w-0 truncate text-muted-foreground sm:inline">
                    {source.snippet}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      );
    case "generic":
      return view.content !== undefined ? (
        <Blocks blocks={[...view.content]} />
      ) : fold.text === "" ? null : (
        <DetailBlock label="Result" mono tone={tone}>
          {fold.text}
        </DetailBlock>
      );
    default:
      return null;
  }
}

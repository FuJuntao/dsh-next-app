"use client";

/**
 * The column every row's TEXT starts on: 6px of row padding + the 16px icon
 * well + the 8px gap. Assistant prose and any free-standing line use it so
 * the whole transcript shares one left edge for words and one for marks.
 */
export const RAIL_TEXT = "pl-8";

/** The rail's hairline: the vertical rule a detail hangs off, at the icon's
 * own centre (8px padding + 8px to the middle of the 16px well = ml-4). */
export const RAIL_BODY = "ml-4 border-l border-border/70 py-1 pl-4 pr-1";

/**
 * The event row (the transcript's one shared line shape).
 *
 * Reference: the built-in dsh web surface renders every session event as a
 * single quiet line - icon, name, a middot, a muted summary - and never as a
 * box. That is the right instinct for a transcript: the reader is scanning a
 * sequence, not reading cards, so the shape that repeats must cost the eye
 * nothing. This is that shape, in this app's tokens.
 *
 * The signature here is the RAIL. A collapsed row is one line; expanding it
 * does not open a card, it continues the line downward behind a hairline
 * that starts exactly where the row's icon sits. The detail is always
 * visibly *under* the event it belongs to, which is what a boxed card keeps
 * forgetting.
 *
 * State is carried by the icon's colour, never by a border or a dot:
 * `running` rides the brand, `failed` the destructive, `notice` the amber,
 * and a settled row is plain muted - so a long transcript stays quiet and
 * the two rows that need attention are the only coloured things in the
 * column.
 */
import type { ReactNode } from "react";
import { RiArrowDownSLine } from "@remixicon/react";
import { cn } from "@/lib/utils";

/** What a row's icon colour says about the event. */
export type RowState = "idle" | "running" | "done" | "failed" | "notice";

const STATE_CLASS: Record<RowState, string> = {
  idle: "text-muted-foreground/70",
  running: "text-primary",
  done: "text-muted-foreground/70",
  failed: "text-destructive",
  notice: "text-warning",
};

/** The 16px icon well: every row's mark lands on the same vertical line. */
export function RowIcon({
  children,
  state = "idle",
  className,
}: {
  children: ReactNode;
  state?: RowState;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "mt-[3px] flex h-4 w-4 shrink-0 items-center justify-center [&>svg]:h-4 [&>svg]:w-4",
        STATE_CLASS[state],
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * One transcript line: icon, name, a middot, a muted summary. With
 * `children` it is a disclosure (the rail grows under it); without, it is a
 * plain row that keeps the same rhythm.
 *
 * The chevron lives at the END of the line and only shows on hover, focus,
 * or when the row is already open. A leading chevron would push every row's
 * text right of the icons and break the single left edge the column shares
 * with the assistant's prose - which is exactly what makes the built-in
 * surface read as one trace instead of a stack of widgets.
 */
export function EventRow({
  icon,
  label,
  detail,
  state = "done",
  time,
  defaultOpen = false,
  children,
  className,
}: {
  icon: ReactNode;
  label: ReactNode;
  detail?: ReactNode;
  state?: RowState;
  /** Right-aligned clock, shown on hover so the column stays clean. */
  time?: string;
  defaultOpen?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  const line = (
    <>
      <RowIcon state={state}>{icon}</RowIcon>
      <span
        className={cn(
          "shrink-0 font-medium",
          state === "failed" ? "text-destructive" : "text-foreground/85",
        )}
      >
        {label}
      </span>
      {detail !== undefined && detail !== "" && (
        <>
          <span aria-hidden className="shrink-0 text-muted-foreground/40">
            ·
          </span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{detail}</span>
        </>
      )}
      <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-2">
        {time !== undefined && (
          <span className="font-mono text-2xs text-muted-foreground/50 opacity-0 transition-opacity group-hover/row:opacity-100">
            {time}
          </span>
        )}
        {children !== undefined && (
          <RiArrowDownSLine
            aria-hidden
            className="mt-0.5 h-3.5 w-3.5 text-muted-foreground/45 opacity-0 transition-all group-hover/row:opacity-100 group-focus-within/row:opacity-100 group-open/row:opacity-100 group-open/row:rotate-180"
          />
        )}
      </span>
    </>
  );

  const lineClass = "flex min-w-0 items-start gap-2 rounded-none px-2 py-2 text-sm leading-5";

  if (children === undefined) {
    return <div className={cn("group/row", lineClass, className)}>{line}</div>;
  }

  return (
    <details className={cn("group/row", className)} {...(defaultOpen ? { open: true } : {})}>
      <summary
        className={cn(
          lineClass,
          "list-none cursor-pointer select-none transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 [&::-webkit-details-marker]:hidden",
        )}
      >
        {line}
      </summary>
      {/* The rail: the detail hangs off the row's own icon column. */}
      <div className={RAIL_BODY}>{children}</div>
    </details>
  );
}

/**
 * The detail block inside a row: a label over content, quiet by default.
 * `mono` is for raw payloads (args, output) - the only place this app keeps
 * monospace in prose, because that content IS code.
 */
export function DetailBlock({
  label,
  mono = false,
  tone = "plain",
  children,
}: {
  label?: string;
  mono?: boolean;
  tone?: "plain" | "error";
  children: ReactNode;
}) {
  return (
    <div className="mb-2 last:mb-0">
      {label !== undefined && (
        <div className="mb-0.5 text-2xs font-medium uppercase tracking-wide text-muted-foreground/60">
          {label}
        </div>
      )}
      <div
        className={cn(
          "max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-none bg-muted/40 px-2.5 py-2 text-xs leading-normal",
          mono && "font-mono",
          tone === "error" && "bg-destructive/10 text-destructive",
        )}
      >
        {children}
      </div>
    </div>
  );
}

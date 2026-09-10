"use client";

/**
 * The session header slot (story #134, the style pass).
 *
 * The session's identity - title, model, cwd, updated, short id - belongs in
 * the app shell's top bar, not in a second header the page stacks under it.
 * But the shell renders above the page in the tree and the live title arrives
 * from the transcript's downlink, so the page cannot hand it up as a prop.
 * This context is that hand-up: the transcript publishes its header info, the
 * shell's bar renders it, and both stay one component tree deep.
 *
 * The info clears on unmount, so navigating away from a session leaves the
 * bar with just the fold toggle (home and settings own no session header).
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { RiFolderLine, RiTimeLine } from "@remixicon/react";

export interface SessionHeaderInfo {
  /** The resolved display title (projection, nav cache, or "New Session"). */
  title: string;
  /** `provider/model` from the latest request context, when one landed. */
  model?: string;
  contextWindow?: number;
  cwd?: string;
  updatedAt?: number;
  /** The session id's first 8 chars, prefix stripped. */
  shortId: string;
}

interface SessionHeaderContextValue {
  info: SessionHeaderInfo | null;
  setInfo: (info: SessionHeaderInfo | null) => void;
}

const SessionHeaderContext = createContext<SessionHeaderContextValue | null>(null);

export function SessionHeaderProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<SessionHeaderInfo | null>(null);
  const value = useMemo(() => ({ info, setInfo }), [info]);
  return <SessionHeaderContext.Provider value={value}>{children}</SessionHeaderContext.Provider>;
}

/** The transcript's side of the seam: publish/clear the session header. */
export function useSessionHeaderPublisher() {
  const ctx = useContext(SessionHeaderContext);
  if (ctx === null) throw new Error("useSessionHeaderPublisher outside the provider");
  return ctx.setInfo;
}

function formatDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
}

/**
 * The shell header's side of the seam: the session identity, inline in the
 * top bar. The title and model carry (the reader's "which session, which
 * model"); the cwd and updated time are secondary and drop out first as the
 * bar narrows, and the short id stays - it is what a second tab or a bug
 * report points at.
 */
export function SessionHeaderSlot() {
  const ctx = useContext(SessionHeaderContext);
  const info = ctx?.info;
  if (info === undefined || info === null) return null;
  return (
    <div className="flex min-w-0 flex-1 items-baseline gap-2">
      <h1 className="min-w-0 truncate text-sm font-medium">{info.title}</h1>
      {info.model !== undefined && (
        <span className="shrink-0 font-mono text-2xs text-muted-foreground/60">
          {info.model}
          {info.contextWindow !== undefined
            ? ` · ${Math.round(info.contextWindow / 1000)}k ctx`
            : ""}
        </span>
      )}
      <span className="ml-auto hidden shrink-0 items-baseline gap-2 text-xs text-muted-foreground/60 md:flex">
        {info.cwd !== undefined && (
          <span className="flex max-w-[24ch] items-baseline gap-1 truncate font-mono">
            <RiFolderLine aria-hidden className="size-3 shrink-0 self-center opacity-60" />
            {info.cwd}
          </span>
        )}
        {info.updatedAt !== undefined && (
          <span className="flex items-baseline gap-1 whitespace-nowrap">
            <RiTimeLine aria-hidden className="size-3 shrink-0 self-center opacity-60" />
            {formatDate(info.updatedAt)}
          </span>
        )}
      </span>
      <span className="shrink-0 font-mono text-xs text-muted-foreground/50">{info.shortId}</span>
    </div>
  );
}

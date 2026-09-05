import type { Metadata } from "next";
import Link from "next/link";

import { SessionTranscript } from "@/components/chat/session-transcript";
import { SessionComposerIsland } from "@/components/session-composer-island";
import { buttonVariants } from "@/components/ui/button";
import { fetchSessionPage, type SessionPageData } from "@/lib/session-page-data";
import type { SessionProjectionsBlock } from "@deepseek-ai/dsh-host-apiproxy/api";

export const metadata: Metadata = {
  title: "Session",
  description: "A dsh session",
};

/**
 * Title cell of the projections block. The "title" UNIT is declared by the
 * host's session-title package (invisible to this app's view of the
 * projection map), so the slot is read structurally - same as the side
 * nav's toSession (lib/sessions.ts); null means no title yet.
 */
function titleOf(projections: SessionProjectionsBlock | undefined): string | null {
  const values = projections?.values as Record<string, unknown> | undefined;
  const value = values?.["title"];
  return typeof value === "string" && value !== "" ? value : null;
}

/** Human, deterministic date for the meta line (server-rendered, no Intl drift). */
function formatDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
}

function Header({
  data,
  sessionId,
}: {
  data: Extract<SessionPageData, { status: "ok" }>;
  sessionId: string;
}) {
  const title = titleOf(data.window.projections) ?? "New Session";
  return (
    <header className="flex flex-col gap-0.5 border-b border-border/60 px-4 py-3 sm:px-6">
      <h1 className="truncate text-base font-medium">{title}</h1>
      <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
        {data.meta?.cwd !== undefined && (
          <span className="truncate font-mono">{data.meta.cwd}</span>
        )}
        {data.meta !== null && <span>Updated {formatDate(data.meta.updatedAt)}</span>}
        <span className="font-mono opacity-60">
          {sessionId.slice("session-".length, 8 + "session-".length)}
        </span>
      </div>
    </header>
  );
}

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // AC 1: the tail window is awaited server-side - the first paint carries
  // real content, no client fetch precedes it. AC 23: unknown/unreadable id
  // and a down bridge each get a distinct render, and the shell/nav (the
  // root layout's own fetch) keep working around them.
  const data = await fetchSessionPage(id);

  if (data.status === "unavailable") {
    return (
      <section className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-base font-medium">Can&apos;t reach the dsh host</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          The session bridge is not answering. The rest of the surface keeps working; reload once
          the host is back.
        </p>
        <Link href="/" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Back to sessions
        </Link>
      </section>
    );
  }

  if (data.status === "not-found") {
    return (
      <section className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-base font-medium">Unknown session</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          No session log answers to <span className="font-mono">{id}</span> on this host.
        </p>
        <Link href="/" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Back to sessions
        </Link>
      </section>
    );
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <Header data={data} sessionId={id} />
      <SessionTranscript
        sessionId={id}
        initialEntries={data.window.entries}
        initialHasMore={data.window.hasMore}
        {...(data.window.projections !== undefined
          ? { initialProjections: data.window.projections }
          : {})}
        blank={data.blank}
      />
      <div className="border-t border-border/60 px-4 py-3 sm:px-6">
        <div className="mx-auto w-full max-w-3xl">
          <SessionComposerIsland />
        </div>
      </div>
    </section>
  );
}

import type { Metadata } from "next";
import Link from "next/link";

import { SessionTranscript } from "@/components/chat/session-transcript";
import { buttonVariants } from "@/components/ui/button";
import { fetchSessionPage } from "@/lib/session-page-data";

export const metadata: Metadata = {
  title: "Session",
  description: "A dsh session",
};

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
      <SessionTranscript
        sessionId={id}
        initialEntries={data.window.entries}
        initialHasMore={data.window.hasMore}
        {...(data.window.projections !== undefined
          ? { initialProjections: data.window.projections }
          : {})}
        blank={data.blank}
        meta={
          data.meta === null
            ? null
            : {
                updatedAt: data.meta.updatedAt,
                ...(data.meta.cwd !== undefined ? { cwd: data.meta.cwd } : {}),
              }
        }
      />
    </section>
  );
}

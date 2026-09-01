import type { Metadata } from "next";

import { SessionComposerIsland } from "@/components/session-composer-island";

export const metadata: Metadata = {
  title: "Session",
  description: "A dsh session",
};

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <section className="flex h-full flex-col gap-6 p-6">
      <h1 className="text-lg font-medium">Session {id}</h1>
      <div className="flex flex-1 flex-col justify-end">
        <SessionComposerIsland />
      </div>
      <p className="text-xs text-muted-foreground">
        Shared composer with stand-in / command and @ reference data. The hydrated chat island
        (ADR-0001) over SSE downlinks (ADR-0003) lands with the chat story.
      </p>
    </section>
  );
}

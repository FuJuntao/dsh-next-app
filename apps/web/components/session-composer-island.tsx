"use client";

import { useState } from "react";

import { SessionComposer } from "@/components/session-composer";
import { SLASH_MENU_ENTRIES } from "@/lib/slash-commands";

// The composer is a client boundary (ADR-0001 island) that server-renders its
// static surface - shell, placeholder, send button - and hydrates into the
// full editor. Lexical owns the editable DOM imperatively after hydration, so
// there is no server/client markup to reconcile inside it; the typeahead
// portals render client-side only (their anchors do not exist on the server).
//
// The `/` source is the REAL vendored roster (a session page has a real host
// context; completing a fabricated command would send a prompt the host
// answers unknown-command). `@` stays unmounted - no references, no search -
// until the chat story brings the session's file context: an absent trigger
// beats a fake one (packet: no faked liveness).
export function SessionComposerIsland() {
  const [lastSent, setLastSent] = useState<string | null>(null);
  return (
    <div className="flex w-full max-w-2xl flex-col gap-2">
      <SessionComposer
        commands={SLASH_MENU_ENTRIES}
        references={[]}
        onSubmit={async (text) => {
          // Display-only stub: the session send action (session.prompt over the
          // bridge) lands with the chat story.
          setLastSent(text);
        }}
      />
      {lastSent !== null && (
        <p className="text-xs text-muted-foreground">
          Display-only stub, not sent over the session uplink:{" "}
          <span className="text-foreground">{lastSent}</span>
        </p>
      )}
    </div>
  );
}

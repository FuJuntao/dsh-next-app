"use client";

import { useState } from "react";

import { STAND_IN_COMMANDS, STAND_IN_REFERENCES } from "@/components/composer-fixtures";
import { SessionComposer } from "@/components/session-composer";

// The composer is a client boundary (ADR-0001 island) that server-renders its
// static surface - shell, placeholder, send button - and hydrates into the
// full editor. Lexical owns the editable DOM imperatively after hydration, so
// there is no server/client markup to reconcile inside it; the typeahead
// portals render client-side only (their anchors do not exist on the server).
export function SessionComposerIsland() {
  const [lastSent, setLastSent] = useState<string | null>(null);
  return (
    <div className="flex w-full max-w-2xl flex-col gap-2">
      <SessionComposer
        commands={STAND_IN_COMMANDS}
        references={STAND_IN_REFERENCES}
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

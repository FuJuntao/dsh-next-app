"use client";

import { STAND_IN_COMMANDS } from "@/components/composer-fixtures";
import { SessionComposer } from "@/components/session-composer";

// The composer is a client boundary (ADR-0001 island) that server-renders its
// static surface - shell, placeholder, send button - and hydrates into the
// full editor. Lexical owns the editable DOM imperatively after hydration, so
// there is no server/client markup to reconcile inside it; the typeahead
// portals render client-side only (their anchors do not exist on the server).
export function HomeComposerIsland() {
  return (
    <div className="flex w-full flex-col gap-2">
      <SessionComposer
        commands={STAND_IN_COMMANDS}
        references={[]}
        placeholder="Describe what you want to build"
        onSubmit={async (text) => {
          // Display-only stub with a beat of delay so the pending state is
          // observable: the real startSession action lands with #119 and the
          // navigation with #120.
          await new Promise((resolve) => setTimeout(resolve, 600));
          console.log("[home] startSession lands with #119; draft was:", text);
        }}
      />
    </div>
  );
}

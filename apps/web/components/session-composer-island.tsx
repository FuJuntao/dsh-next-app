"use client";

import { useState } from "react";

import { SessionComposer, type ComposerEntry } from "@/components/session-composer";

// Session-surface trigger sources. These are the spike's mock lists standing
// in until the real ones land: slash commands become a vendored, version-pinned
// list (#123) and references become session references via session.search
// (#124). Home injects its own sources with its own submit action.
const MOCK_COMMANDS: ComposerEntry[] = [
  { label: "/compact", description: "Summarize the transcript to free context", kind: "command" },
  { label: "/clear", description: "Clear the session transcript", kind: "command" },
  { label: "/model", description: "Switch the session's model", kind: "command" },
  { label: "/review", description: "Review the last task diff", kind: "command" },
  { label: "/handoff", description: "Hand the session to another agent", kind: "command" },
];

const MOCK_REFERENCES: ComposerEntry[] = [
  {
    label: "apps/web/app/sessions/[id]/page.tsx",
    description: "route - session detail",
    kind: "file",
  },
  { label: "apps/web/components/AppShell.tsx", description: "component - app shell", kind: "file" },
  { label: "apps/web/app/globals.css", description: "styles - theme tokens", kind: "file" },
  { label: "packages/dsh-next-app/lib/index.ts", description: "bundle glue", kind: "file" },
  { label: "e2e/sessions-list.spec.ts", description: "e2e regression", kind: "file" },
  { label: "AGENTS.md", description: "repo guidance", kind: "file" },
];

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
        commands={MOCK_COMMANDS}
        references={MOCK_REFERENCES}
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

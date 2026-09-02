import type { ComposerEntry } from "@/components/session-composer";

// Stand-in trigger sources for the SESSION page until the chat story lands
// its real ones. Home has shipped to the real sources: the vendored,
// version-pinned command list (#123) and session references via
// session.search (#124 - file/directory references stay suppressed there).
export const STAND_IN_COMMANDS: ComposerEntry[] = [
  { label: "/compact", description: "Summarize the transcript to free context", kind: "command" },
  { label: "/clear", description: "Clear the session transcript", kind: "command" },
  { label: "/model", description: "Switch the session's model", kind: "command" },
  { label: "/review", description: "Review the last task diff", kind: "command" },
  { label: "/handoff", description: "Hand the session to another agent", kind: "command" },
];

export const STAND_IN_REFERENCES: ComposerEntry[] = [
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

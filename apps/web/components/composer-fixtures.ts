import type { ComposerEntry } from "@/components/session-composer";

// Stand-in trigger sources shared by the surface islands until the real ones
// land: slash commands become a vendored, version-pinned list (#123) and
// references become session references via session.search (#124). Home
// suppresses references entirely (#124: file/directory references are
// suppressed there - an empty source mounts no @ menu at all).
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

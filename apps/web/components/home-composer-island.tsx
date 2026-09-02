"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AgentPresetEntry } from "@deepseek-ai/dsh-host-apiproxy/api";

import { ComposerCwdChip } from "@/components/composer-cwd-chip";
import { ComposerPresetChip } from "@/components/composer-preset-chip";
import { STAND_IN_COMMANDS } from "@/components/composer-fixtures";
import { SessionComposer } from "@/components/session-composer";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { startSession } from "@/lib/start-session";

// The composer is a client boundary (ADR-0001 island) that server-renders its
// static surface - shell, placeholder, send button - and hydrates into the
// full editor. Lexical owns the editable DOM imperatively after hydration, so
// there is no server/client markup to reconcile inside it; the typeahead
// portals render client-side only (their anchors do not exist on the server).
export function HomeComposerIsland({ presets }: { presets: AgentPresetEntry[] }) {
  const router = useRouter();
  // The inline destructive Alert's text (story AC 4); null renders nothing.
  const [error, setError] = useState<string | null>(null);
  // The agentPreset selection (story AC 6); null means the deployment default.
  const [presetId, setPresetId] = useState<string | null>(null);
  // The cwd selection (story AC 7); null means the host default.
  const [cwd, setCwd] = useState<string | null>(null);
  return (
    <div className="flex w-full flex-col gap-2">
      <SessionComposer
        commands={STAND_IN_COMMANDS}
        references={[]}
        placeholder="Describe what you want to build"
        chips={
          <div className="flex min-w-0 items-center gap-1">
            {presets.length > 0 && (
              <ComposerPresetChip presets={presets} value={presetId} onChange={setPresetId} />
            )}
            <ComposerCwdChip value={cwd} onChange={setCwd} />
          </div>
        }
        onSubmit={async (text) => {
          setError(null);
          const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
          const result = await startSession({
            text,
            ...(presetId !== null && { agentPreset: presetId }),
            ...(cwd !== null && { cwd }),
            // The prompt contract: browser callers attach their IANA zone;
            // the host validates and records it.
            ...(timeZone !== "" && { clientTimeZone: timeZone }),
          });
          if (!result.ok) {
            setError(result.error);
            // Reject so the composer preserves the draft for retry (AC 4);
            // the Alert below is the visible failure surface.
            throw new Error(result.error);
          }
          // Story AC 2: land in the new session. refresh() re-runs the
          // layout's session fetch, so the sidebar lists it too (AC 5).
          router.push(`/sessions/${result.sessionId}`);
          router.refresh();
        }}
      />
      {error !== null && (
        <Alert variant="destructive">
          <AlertTitle>Could not start the session</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

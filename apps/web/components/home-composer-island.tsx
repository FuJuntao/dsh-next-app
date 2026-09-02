"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import type { AgentPresetEntry, ModelProviderGroup } from "@deepseek-ai/dsh-host-apiproxy/api";

import { ComposerCwdChip } from "@/components/composer-cwd-chip";
import { ComposerModelChip } from "@/components/composer-model-chip";
import { ComposerPresetChip } from "@/components/composer-preset-chip";
import { type ComposerEntry, SessionComposer } from "@/components/session-composer";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { searchSessionReferences } from "@/lib/session-references";
import { SLASH_MENU_ENTRIES } from "@/lib/slash-commands";
import { startSession, type StartSessionModel } from "@/lib/start-session";

// The composer is a client boundary (ADR-0001 island) that server-renders its
// static surface - shell, placeholder, send button - and hydrates into the
// full editor. Lexical owns the editable DOM imperatively after hydration, so
// there is no server/client markup to reconcile inside it; the typeahead
// portals render client-side only (their anchors do not exist on the server).
export function HomeComposerIsland({
  presets,
  models,
  hostDefault,
}: {
  presets: AgentPresetEntry[];
  models: ModelProviderGroup[];
  /** The deployment default model target (host.describe + settings); null when unknown. */
  hostDefault: { provider: string; model: string; reasoningEffort?: string } | null;
}) {
  const router = useRouter();
  // The inline destructive Alert's text (story AC 4); null renders nothing.
  const [error, setError] = useState<string | null>(null);
  // The agentPreset selection (story AC 6); null means the deployment default.
  const [presetId, setPresetId] = useState<string | null>(null);
  // The cwd selection (story AC 7); null means no choice yet - the composer
  // stays locked until one is made (the default itself is a choice).
  const [cwd, setCwd] = useState<string | null>(null);
  // The folder dialog is controlled: tapping the locked editor opens it.
  const [folderOpen, setFolderOpen] = useState(false);
  // The model selection (story AC 10); null means the deployment default.
  const [model, setModel] = useState<StartSessionModel | null>(null);
  // The `@` source (story AC 9): session references via session.search.
  // A failed search yields no options (never an empty-Enter trap: with an
  // empty list the menu simply does not open).
  const queryReferences = useCallback(async (query: string): Promise<ComposerEntry[]> => {
    const result = await searchSessionReferences(query);
    if (!result.ok) {
      return [];
    }
    return result.items.map((hit) => ({
      key: hit.sessionId,
      kind: "session" as const,
      label: hit.label,
      description: hit.snippet,
      insertText: hit.mention,
    }));
  }, []);
  return (
    <div className="flex w-full flex-col gap-2">
      {/* The actions live OUTSIDE the card, on top (dsh web's composer
          layout), and wrap onto more lines when they run out of width -
          mobile first: a phone gets one row per chip if it must. */}
      <div className="flex flex-wrap items-center gap-1">
        {presets.length > 0 && (
          <ComposerPresetChip presets={presets} value={presetId} onChange={setPresetId} />
        )}
        <ComposerCwdChip
          value={cwd}
          onChange={setCwd}
          open={folderOpen}
          onOpenChange={setFolderOpen}
        />
        {models.length > 0 && (
          <ComposerModelChip
            groups={models}
            hostDefault={hostDefault}
            value={model}
            onChange={setModel}
          />
        )}
      </div>
      <SessionComposer
        commands={SLASH_MENU_ENTRIES}
        references={[]}
        referenceSearch={queryReferences}
        placeholder="Describe what you want to build"
        enabled={cwd !== null}
        onLockedActivate={() => setFolderOpen(true)}
        onSubmit={async (text) => {
          setError(null);
          const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
          let result;
          try {
            result = await startSession({
              text,
              ...(presetId !== null && { agentPreset: presetId }),
              ...(cwd !== null && { cwd }),
              ...(model !== null && { model }),
              // The prompt contract: browser callers attach their IANA zone;
              // the host validates and records it.
              ...(timeZone !== "" && { clientTimeZone: timeZone }),
            });
          } catch (cause) {
            // The action call itself failed (transport/HMR staleness): the
            // result fold cannot report it, so surface it here - a send
            // that vanishes without a word is how "retry" becomes a
            // question. Rethrow to keep the draft (AC 4).
            const message = cause instanceof Error ? cause.message : String(cause);
            setError(message);
            throw cause;
          }
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
        <Alert variant="destructive" data-testid="send-error">
          <AlertTitle>Could not start the session</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

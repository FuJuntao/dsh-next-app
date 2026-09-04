"use client";

import { useEffect, useState } from "react";
import type { ModelProviderGroup } from "@deepseek-ai/dsh-host-apiproxy/api";
import { RiSparklingLine } from "@remixicon/react";

import type { StartSessionModel } from "@/lib/start-session";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { LABEL, META, PickerRow } from "@/components/picker-row";
import { cn } from "@/lib/utils";

/** The last picks, most-recent-first; localStorage is a browser cache, not truth. */
const RECENT_KEY = "dsh-nex…dels";
const RECENT_MAX = 3;

function readRecent(): StartSessionModel[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StartSessionModel[]).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

/**
 * The model picker chip (story #117 task #125, review + optimization
 * rounds): a DIALOG like the folder chip, over the session-independent
 * `llm.models` catalog fetched server-side, grouped by provider.
 *
 * The dialog is a find surface, so it got the find affordances: a
 * filter input narrows across providers and model names (a provider hit
 * keeps its whole roster); a Recent section (last 3 explicit picks,
 * localStorage) puts yesterday's model one tap away; provider headers
 * stick while the list scrolls; and the list is capped to the viewport
 * rather than a fixed 288px strip.
 *
 * The Default entry leads with "Default", then the provider (the same
 * LABEL font the group headers use) and the resolved target - model ·
 * thinking effort (META) - on their own lines. The effort resolves
 * through the truth the host itself applies: the configured
 * agent-default-model value first, then the adapter's declared default,
 * then the model alone.
 *
 * The collapsed chip renders MINIMAL text: model and effort, nothing
 * else - the provider is context the picker shows, not a label the
 * action row needs.
 *
 * Effort-bearing models DRILL: tapping swaps the dialog's content to
 * that model's effort list (adapter-default entry first) with a back
 * row, and the dialog's TITLE becomes the model's name - the drill
 * reads as navigation, not replacement. The committed selection rides
 * `startSession` into `session.selectModel` (best-effort per story AC 4).
 */
export function ComposerModelChip({
  groups,
  hostDefault,
  value,
  onChange,
}: {
  groups: ModelProviderGroup[];
  /** The deployment's default target (host.describe + agent-default-model
   * settings); null when unknown. */
  hostDefault: { provider: string; model: string; reasoningEffort?: string } | null;
  /** The chosen selection; null means the deployment default. */
  value: StartSessionModel | null;
  onChange: (value: StartSessionModel | null) => void;
}) {
  const [open, setOpen] = useState(false);
  // The drilled model (provider+id), or null on the list view.
  const [drill, setDrill] = useState<{ provider: string; model: string } | null>(null);
  const [filter, setFilter] = useState("");
  const [recent, setRecent] = useState<StartSessionModel[]>([]);

  // Hydrate the recent roster after mount (localStorage is client-only;
  // the island server-renders this component).
  useEffect(() => {
    setRecent(readRecent());
  }, []);

  // The default entry's concrete target: provider (LABEL) and resolved
  // model · effort (META) on their own lines.
  const defaultGroup =
    hostDefault === null ? undefined : groups.find((g) => g.id === hostDefault.provider);
  const defaultModel = defaultGroup?.models.find((m) => m.id === hostDefault?.model);
  const defaultProviderName =
    hostDefault === null ? undefined : (defaultGroup?.name ?? hostDefault.provider);
  const defaultEffortId = hostDefault?.reasoningEffort ?? defaultModel?.reasoning?.defaultEffort;
  const defaultEffortName =
    defaultModel?.reasoning?.efforts.find((e) => e.id === defaultEffortId)?.name ??
    (defaultEffortId !== undefined ? defaultEffortId : undefined);
  const defaultTarget =
    hostDefault === null || defaultModel === undefined
      ? undefined
      : defaultEffortName === undefined
        ? defaultModel.name
        : `${defaultModel.name} · ${defaultEffortName}`;

  // The chip's minimal label: model and effort only - no provider line.
  const selectedGroup = value === null ? undefined : groups.find((g) => g.id === value.provider);
  const selectedModel = selectedGroup?.models.find((m) => m.id === value?.model);
  const selectedEffortName =
    value?.reasoningEffort === undefined
      ? undefined
      : selectedModel?.reasoning?.efforts.find((e) => e.id === value.reasoningEffort)?.name;
  const chipTarget =
    value === null
      ? {
          model:
            defaultModel?.name ??
            (hostDefault === null ? undefined : `${hostDefault.provider}/${hostDefault.model}`),
          effort: defaultEffortName,
        }
      : { model: selectedModel?.name, effort: selectedEffortName };
  const label =
    chipTarget.model === undefined
      ? "Default model"
      : chipTarget.effort === undefined
        ? chipTarget.model
        : `${chipTarget.model} · ${chipTarget.effort}`;

  const pick = (next: StartSessionModel | null) => {
    onChange(next);
    // Explicit picks join the recent roster (Default is the absence of
    // a choice, not a habit).
    if (next !== null) {
      const merged = [
        next,
        ...recent.filter(
          (entry) =>
            entry.provider !== next.provider ||
            entry.model !== next.model ||
            entry.reasoningEffort !== next.reasoningEffort,
        ),
      ].slice(0, RECENT_MAX);
      setRecent(merged);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(merged));
      } catch {
        // A browser that refuses storage simply gets no recents.
      }
    }
    setOpen(false);
    setDrill(null);
    // A programmatic close never fires onOpenChange, so the reset lives
    // here too: the next open starts at the top of the catalog, filter
    // cleared, recents visible.
    setFilter("");
  };

  const needle = filter.trim().toLowerCase();

  // The filter narrows across providers and model names; a provider-name
  // hit keeps its whole roster (searching "deepseek" wants every model).
  const visibleGroups = groups
    .map((group) =>
      needle === "" || group.name.toLowerCase().includes(needle)
        ? { group, models: group.models }
        : { group, models: group.models.filter((m) => m.name.toLowerCase().includes(needle)) },
    )
    .filter((entry) => entry.models.length > 0);

  // Recents resolve against the live catalog; stale ids (model retired)
  // drop out silently rather than offering a dead row.
  const recentRows =
    needle === ""
      ? recent.flatMap((entry) => {
          const group = groups.find((g) => g.id === entry.provider);
          const model = group?.models.find((m) => m.id === entry.model);
          if (group === undefined || model === undefined) return [];
          const effort =
            entry.reasoningEffort === undefined
              ? undefined
              : model.reasoning?.efforts.find((e) => e.id === entry.reasoningEffort)?.name;
          return [{ entry, providerName: group.name, modelName: model.name, effort }];
        })
      : [];

  const drilledGroup = drill === null ? undefined : groups.find((g) => g.id === drill.provider);
  const drilledModel = drilledGroup?.models.find((m) => m.id === drill?.model);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setDrill(null);
          setFilter("");
        }
      }}
    >
      <DialogTrigger
        aria-label="Model"
        className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground aria-expanded:bg-accent aria-expanded:text-accent-foreground"
      >
        <RiSparklingLine className="size-3.5 shrink-0" />
        <span className="min-w-0 break-words text-left">{label}</span>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{drilledModel?.name ?? "Choose a model"}</DialogTitle>
          <DialogDescription>
            {drilledModel === undefined
              ? "The model the new session runs on."
              : "The thinking effort for this model."}
          </DialogDescription>
        </DialogHeader>
        {drilledModel === undefined && (
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter models"
            aria-label="Filter models"
          />
        )}
        <div className="max-h-[min(24rem,55vh)] overflow-y-auto">
          {drilledModel !== undefined && drilledGroup !== undefined && drill !== null ? (
            // Effort view: back row, the adapter-default choice, then the list.
            <div className="flex flex-col">
              <PickerRow
                selected={false}
                onSelect={() => setDrill(null)}
                primary={drilledModel.name}
                secondary="Back to models"
                leading="back"
              />
              <PickerRow
                selected={
                  value?.provider === drilledGroup.id &&
                  value.model === drilledModel.id &&
                  value.reasoningEffort === undefined
                }
                onSelect={() => pick({ provider: drilledGroup.id, model: drilledModel.id })}
                primary="Adapter default"
                {...(drilledModel.reasoning?.defaultEffort !== undefined && {
                  secondary: `default effort: ${drilledModel.reasoning.defaultEffort}`,
                })}
                leading="check"
              />
              <div className="my-1 h-px bg-input" />
              {(drilledModel.reasoning?.efforts ?? []).map((effort) => (
                <PickerRow
                  key={effort.id}
                  selected={
                    value?.provider === drilledGroup.id &&
                    value.model === drilledModel.id &&
                    value.reasoningEffort === effort.id
                  }
                  onSelect={() =>
                    pick({
                      provider: drilledGroup.id,
                      model: drilledModel.id,
                      reasoningEffort: effort.id,
                    })
                  }
                  primary={effort.name}
                  {...(effort.description !== undefined && { secondary: effort.description })}
                  leading="check"
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col">
              <PickerRow
                selected={value === null}
                onSelect={() => pick(null)}
                primary="Default"
                {...(defaultProviderName !== undefined && { label: defaultProviderName })}
                {...(defaultTarget !== undefined && { secondary: defaultTarget })}
                leading="check"
              />
              {recentRows.length > 0 && (
                <div className="flex flex-col">
                  <p className={cn("px-1.5 pt-2 pb-0.5", LABEL)}>Recent</p>
                  {recentRows.map(({ entry, providerName, modelName, effort }) => (
                    <PickerRow
                      key={`${entry.provider}/${entry.model}/${entry.reasoningEffort ?? ""}`}
                      selected={
                        value !== null &&
                        value.provider === entry.provider &&
                        value.model === entry.model &&
                        value.reasoningEffort === entry.reasoningEffort
                      }
                      onSelect={() => pick(entry)}
                      primary={effort === undefined ? modelName : `${modelName} · ${effort}`}
                      label={providerName}
                      leading="check"
                    />
                  ))}
                  <div className="my-1 h-px bg-input" />
                </div>
              )}
              {visibleGroups.map(({ group, models }) => (
                <div key={group.id} className="flex flex-col">
                  <p className={cn("sticky top-0 z-10 bg-popover px-1.5 pt-2 pb-0.5", LABEL)}>
                    {group.name}
                  </p>
                  {models.map((model) => {
                    const efforts = model.reasoning?.efforts ?? [];
                    const isSelected = value?.provider === group.id && value.model === model.id;
                    const selectedEffort =
                      value?.reasoningEffort === undefined
                        ? undefined
                        : model.reasoning?.efforts.find((e) => e.id === value.reasoningEffort)
                            ?.name;
                    return (
                      <PickerRow
                        key={model.id}
                        selected={isSelected && efforts.length === 0}
                        onSelect={() => {
                          if (efforts.length === 0) {
                            pick({ provider: group.id, model: model.id });
                            return;
                          }
                          setDrill({ provider: group.id, model: model.id });
                        }}
                        primary={model.name}
                        {...(isSelected &&
                          selectedEffort !== undefined && {
                            secondary: `effort: ${selectedEffort}`,
                          })}
                        leading={efforts.length === 0 ? "check" : undefined}
                        chevron={efforts.length > 0}
                      />
                    );
                  })}
                </div>
              ))}
              {visibleGroups.length === 0 && (
                <p className={cn("px-1.5 py-2", META)}>No models match “{filter}”.</p>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

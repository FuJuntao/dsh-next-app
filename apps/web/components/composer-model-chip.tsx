"use client";

import { useState } from "react";
import type { ModelProviderGroup } from "@deepseek-ai/dsh-host-apiproxy/api";
import {
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiCheckLine,
  RiSparklingLine,
} from "@remixicon/react";

import type { StartSessionModel } from "@/lib/start-session";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * The picker's type ladder - three roles, each with ONE style used
 * identically everywhere (the previous rounds mixed sizes/weights per
 * line and the rows read as noise):
 *
 * - PRIMARY: the tappable answer (model name, effort name, "Default").
 *   The dialog's own text-xs; a selected row's primary goes medium.
 * - LABEL: a provider's name - the group headers AND the Default row's
 *   provider line. Same role, same font: 11px medium muted.
 * - META: every other supporting line (the Default row's resolved
 *   target, effort descriptions, "Back to models"). 11px muted, and
 *   never heavier than the primary it sits under.
 */
const PRIMARY_SELECTED = "bg-accent/60 font-medium";
const LABEL = "block break-words text-[11px] leading-tight font-medium text-muted-foreground";
const META = "block break-words text-[11px] leading-tight text-muted-foreground";

/** One selectable row of the dialog list. */
function Row({
  selected,
  onSelect,
  primary,
  label,
  secondary,
  leading,
  chevron,
}: {
  selected: boolean;
  onSelect: () => void;
  primary: string;
  /** The provider line (LABEL role) - only the Default row carries one. */
  label?: string;
  /** The meta line under the primary (META role). */
  secondary?: string;
  leading?: "check" | "back" | "chevron" | undefined;
  chevron?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "flex w-full items-center gap-2 rounded-sm px-1.5 py-1.5 text-left text-xs outline-none hover:bg-accent focus-visible:bg-accent",
        selected && PRIMARY_SELECTED,
      )}
    >
      <span className="flex w-4 shrink-0 items-center justify-center">
        {leading === "check" && selected && <RiCheckLine className="size-3.5 shrink-0" />}
        {leading === "back" && <RiArrowLeftSLine className="size-3.5 shrink-0" />}
        {leading === "chevron" && <RiArrowRightSLine className="size-3.5 shrink-0" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block break-all">{primary}</span>
        {label !== undefined && <span className={LABEL}>{label}</span>}
        {secondary !== undefined && <span className={META}>{secondary}</span>}
      </span>
      {chevron === true && (
        <RiArrowRightSLine className="size-3.5 shrink-0 text-muted-foreground" />
      )}
    </button>
  );
}

/**
 * The model picker chip (story #117 task #125, review rounds): a DIALOG
 * like the folder chip (the whole action row opens dialogs - pickers
 * deserve the room, and a phone's popover kept clipping), over the
 * session-independent `llm.models` catalog fetched server-side, grouped
 * by provider.
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
 * row - never an inline expansion. The committed selection rides
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

  // The Default entry's concrete target: provider (LABEL) and resolved
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
    setOpen(false);
    setDrill(null);
  };

  const drilledGroup = drill === null ? undefined : groups.find((g) => g.id === drill.provider);
  const drilledModel = drilledGroup?.models.find((m) => m.id === drill?.model);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setDrill(null);
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
          <DialogTitle>Choose a model</DialogTitle>
          <DialogDescription>
            The model the new session runs on - the deployment default or any catalog entry.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-72 overflow-y-auto">
          {drilledModel !== undefined && drilledGroup !== undefined && drill !== null ? (
            // Effort view: back row, the adapter-default choice, then the list.
            <div className="flex flex-col">
              <Row
                selected={false}
                onSelect={() => setDrill(null)}
                primary={drilledModel.name}
                secondary="Back to models"
                leading="back"
              />
              <Row
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
                <Row
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
              <Row
                selected={value === null}
                onSelect={() => pick(null)}
                primary="Default"
                {...(defaultProviderName !== undefined && { label: defaultProviderName })}
                {...(defaultTarget !== undefined && { secondary: defaultTarget })}
                leading="check"
              />
              {groups.map((group) => (
                <div key={group.id} className="flex flex-col">
                  <p className={cn("px-1.5 pt-2 pb-0.5", LABEL)}>{group.name}</p>
                  {group.models.map((model) => {
                    const efforts = model.reasoning?.efforts ?? [];
                    const isSelected = value?.provider === group.id && value.model === model.id;
                    const selectedEffort =
                      value?.reasoningEffort === undefined
                        ? undefined
                        : model.reasoning?.efforts.find((e) => e.id === value.reasoningEffort)
                            ?.name;
                    return (
                      <Row
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
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

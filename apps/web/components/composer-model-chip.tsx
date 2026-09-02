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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** The small type for secondary lines (effort hints, resolved defaults). */
const SECONDARY = "block truncate text-[11px] leading-tight text-muted-foreground";

/** One selectable row of the popover list. */
function Row({
  selected,
  onSelect,
  primary,
  secondary,
  leading,
  chevron,
}: {
  selected: boolean;
  onSelect: () => void;
  primary: string;
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
        selected && "bg-accent/60 font-medium",
      )}
    >
      <span className="flex w-4 shrink-0 items-center justify-center">
        {leading === "check" && selected && <RiCheckLine className="size-3.5 shrink-0" />}
        {leading === "back" && <RiArrowLeftSLine className="size-3.5 shrink-0" />}
        {leading === "chevron" && <RiArrowRightSLine className="size-3.5 shrink-0" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{primary}</span>
        {secondary !== undefined && <span className={SECONDARY}>{secondary}</span>}
      </span>
      {chevron === true && (
        <RiArrowRightSLine className="size-3.5 shrink-0 text-muted-foreground" />
      )}
    </button>
  );
}

/**
 * The model picker chip (story #117 task #125, review rounds): a POPOVER
 * (a picker, not a command menu) over the session-independent
 * `llm.models` catalog fetched server-side, grouped by provider. The
 * default entry leads with "Default" on the first line and the concrete
 * model + thinking effort it resolves to (host.describe cross-referenced
 * with the catalog) in the smaller secondary line.
 *
 * Effort-bearing models DRILL: tapping one swaps the popover's content to
 * that model's effort list (adapter-default entry first) with a back row -
 * never an inline expansion, which on a phone's short screen pushed the
 * list past the popup's edges. The popover keeps one fixed, scrollable
 * size in both views. The committed selection rides `startSession` into
 * `session.selectModel` (best-effort per story AC 4).
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

  // The default entry's concrete target: name + effort. The effort source
  // order is the truth the host itself applies: the configured
  // agent-default-model value first, then the adapter's declared default;
  // neither -> the model alone (provider-internal default, not a secret).
  const defaultGroup =
    hostDefault === null ? undefined : groups.find((g) => g.id === hostDefault.provider);
  const defaultModel = defaultGroup?.models.find((m) => m.id === hostDefault?.model);
  const defaultEffortId = hostDefault?.reasoningEffort ?? defaultModel?.reasoning?.defaultEffort;
  const defaultEffortName =
    defaultModel?.reasoning?.efforts.find((e) => e.id === defaultEffortId)?.name ??
    (defaultEffortId !== undefined ? defaultEffortId : undefined);
  const defaultSecondary =
    hostDefault === null
      ? undefined
      : defaultModel === undefined
        ? `${hostDefault.provider}/${hostDefault.model}`
        : defaultEffortName === undefined
          ? defaultModel.name
          : `${defaultModel.name} · ${defaultEffortName}`;

  const selectedModel =
    value === null
      ? undefined
      : groups.find((g) => g.id === value.provider)?.models.find((m) => m.id === value.model);
  const selectedEffortName =
    value?.reasoningEffort === undefined
      ? undefined
      : selectedModel?.reasoning?.efforts.find((e) => e.id === value.reasoningEffort)?.name;
  const label =
    value === null
      ? (defaultSecondary ?? "Default model")
      : selectedModel === undefined
        ? "Default model"
        : selectedEffortName === undefined
          ? selectedModel.name
          : `${selectedModel.name} · ${selectedEffortName}`;

  const pick = (next: StartSessionModel | null) => {
    onChange(next);
    setOpen(false);
    setDrill(null);
  };

  const drilledGroup = drill === null ? undefined : groups.find((g) => g.id === drill.provider);
  const drilledModel = drilledGroup?.models.find((m) => m.id === drill?.model);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setDrill(null);
      }}
    >
      <PopoverTrigger
        aria-label="Model"
        className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground aria-expanded:bg-accent aria-expanded:text-accent-foreground"
      >
        <RiSparklingLine className="size-3.5 shrink-0" />
        <span className="max-w-40 truncate">{label}</span>
        <RiArrowRightSLine className="size-3.5 shrink-0 -rotate-90" />
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="max-h-72 w-60 overflow-y-auto sm:w-64">
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
              {...(defaultSecondary !== undefined && { secondary: defaultSecondary })}
              leading="check"
            />
            {groups.map((group) => (
              <div key={group.id} className="flex flex-col">
                <p className="px-1.5 pt-2 pb-0.5 font-medium text-muted-foreground">{group.name}</p>
                {group.models.map((model) => {
                  const efforts = model.reasoning?.efforts ?? [];
                  const isSelected = value?.provider === group.id && value.model === model.id;
                  const selectedEffort =
                    value?.reasoningEffort === undefined
                      ? undefined
                      : model.reasoning?.efforts.find((e) => e.id === value.reasoningEffort)?.name;
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
      </PopoverContent>
    </Popover>
  );
}

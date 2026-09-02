"use client";

import { useState } from "react";
import type { ModelProviderGroup } from "@deepseek-ai/dsh-host-apiproxy/api";
import { RiArrowDownSLine, RiSparklingLine } from "@remixicon/react";

import type { StartSessionModel } from "@/lib/start-session";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** The outer group's value meaning "name no model": the deployment default. */
const DEFAULT_VALUE = "__deployment_default__";
/** The effort group's value meaning "no explicit effort": the adapter default. */
const DEFAULT_EFFORT = "__adapter_default__";
/** NUL joins provider and model in the outer group's values. */
const SEP = "\u0000";

/** The display text for a provider/model/effort triple, from the catalog. */
function describeModel(
  groups: ModelProviderGroup[],
  target: { provider: string; model: string; reasoningEffort?: string | undefined },
): { name: string; effort: string | undefined } | null {
  const group = groups.find((g) => g.id === target.provider);
  const model = group?.models.find((m) => m.id === target.model);
  if (model === undefined) return null;
  const effort =
    target.reasoningEffort === undefined
      ? undefined
      : model.reasoning?.efforts.find((e) => e.id === target.reasoningEffort);
  return { name: model.name, effort: effort?.name };
}

/**
 * The model picker chip (story #117 task #125): the session-independent
 * catalog from `llm.models` (fetched server-side by the home page), grouped
 * by provider, with a reasoning-effort submenu where the adapter offers
 * one. The selection rides `startSession` into `session.selectModel`
 * (best-effort per story AC 4); omitting it keeps the deployment default.
 * Switching models resets the effort to the adapter default.
 *
 * The default entry names the real model and effort it resolves to (from
 * `host.describe` cross-referenced against the catalog), so "no selection"
 * reads as a concrete target rather than an abstract phrase.
 */
export function ComposerModelChip({
  groups,
  hostDefault,
  value,
  onChange,
}: {
  groups: ModelProviderGroup[];
  /** The deployment's default provider/model (host.describe); null when unknown. */
  hostDefault: { provider: string; model: string } | null;
  /** The chosen selection; null means the deployment default. */
  value: StartSessionModel | null;
  onChange: (value: StartSessionModel | null) => void;
}) {
  const selectedModel =
    value === null
      ? undefined
      : groups
          .find((group) => group.id === value.provider)
          ?.models.find((model) => model.id === value.model);
  const selectedEffort =
    value?.reasoningEffort === undefined
      ? undefined
      : selectedModel?.reasoning?.efforts.find((effort) => effort.id === value.reasoningEffort);

  // The default entry's resolved target: the model itself plus the adapter's
  // default effort (host.describe names no effort, so read the catalog's).
  const defaultCatalogModel =
    hostDefault === null
      ? undefined
      : groups
          .find((g) => g.id === hostDefault.provider)
          ?.models.find((m) => m.id === hostDefault.model);
  const defaultDescription =
    hostDefault === null
      ? null
      : describeModel(groups, {
          ...hostDefault,
          ...(defaultCatalogModel?.reasoning?.defaultEffort !== undefined && {
            reasoningEffort: defaultCatalogModel.reasoning.defaultEffort,
          }),
        });
  const defaultText =
    defaultDescription === null
      ? "Default model"
      : defaultDescription.effort === undefined
        ? defaultDescription.name
        : `${defaultDescription.name} · ${defaultDescription.effort}`;

  const label =
    value === null
      ? defaultText
      : selectedModel === undefined
        ? "Default model"
        : selectedEffort === undefined
          ? selectedModel.name
          : `${selectedModel.name} · ${selectedEffort.name}`;
  // Controlled root: a top-level pick closes the menu on its own, but an
  // effort picked from a submenu only closes the submenu - the chip owns
  // the dialog-level close so the page is never left under the menu's
  // inert backdrop.
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        aria-label="Model"
        className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground aria-expanded:bg-accent aria-expanded:text-accent-foreground"
      >
        <RiSparklingLine className="size-3.5 shrink-0" />
        <span className="max-w-40 truncate">{label}</span>
        <RiArrowDownSLine className="size-3.5 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-64">
        <DropdownMenuRadioGroup
          value={value === null ? DEFAULT_VALUE : `${value.provider}${SEP}${value.model}`}
          onValueChange={(next) => {
            const id = String(next);
            if (id === DEFAULT_VALUE) {
              onChange(null);
              setOpen(false);
              return;
            }
            const [provider = "", model = ""] = id.split(SEP);
            onChange({ provider, model });
            setOpen(false);
          }}
        >
          <DropdownMenuRadioItem value={DEFAULT_VALUE}>
            <span className="flex min-w-0 flex-col">
              <span>{defaultText}</span>
              <span className="text-muted-foreground">
                {hostDefault === null
                  ? "The provider default answers the session"
                  : "Deployment default"}
              </span>
            </span>
          </DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          {groups.map((group) => [
            <DropdownMenuLabel key={group.id + ":label"}>{group.name}</DropdownMenuLabel>,
            group.models.map((model) => {
              const itemValue = `${group.id}${SEP}${model.id}`;
              const efforts = model.reasoning?.efforts ?? [];
              if (efforts.length === 0) {
                return (
                  <DropdownMenuRadioItem key={itemValue} value={itemValue}>
                    {model.name}
                  </DropdownMenuRadioItem>
                );
              }
              return (
                <DropdownMenuSub key={itemValue}>
                  <DropdownMenuSubTrigger>{model.name}</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="min-w-40">
                    <DropdownMenuRadioGroup
                      value={
                        value !== null && value.provider === group.id && value.model === model.id
                          ? (value.reasoningEffort ?? DEFAULT_EFFORT)
                          : ""
                      }
                      onValueChange={(next) => {
                        const effort = String(next);
                        onChange({
                          provider: group.id,
                          model: model.id,
                          ...(effort !== DEFAULT_EFFORT && { reasoningEffort: effort }),
                        });
                        setOpen(false);
                      }}
                    >
                      <DropdownMenuRadioItem value={DEFAULT_EFFORT}>
                        <span className="flex min-w-0 flex-col">
                          <span>Default effort</span>
                          {model.reasoning?.defaultEffort !== undefined && (
                            <span className="text-muted-foreground">
                              Adapter default: {model.reasoning.defaultEffort}
                            </span>
                          )}
                        </span>
                      </DropdownMenuRadioItem>
                      <DropdownMenuSeparator />
                      {efforts.map((effort) => (
                        <DropdownMenuRadioItem key={effort.id} value={effort.id}>
                          <span className="flex min-w-0 flex-col">
                            <span>{effort.name}</span>
                            {effort.description !== undefined && (
                              <span className="text-muted-foreground">{effort.description}</span>
                            )}
                          </span>
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              );
            }),
          ])}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

"use client";

import type { AgentPresetEntry } from "@deepseek-ai/dsh-host-apiproxy/api";
import { RiArrowDownSLine, RiRocketLine } from "@remixicon/react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** The radio value meaning "name no preset": the deployment default applies. */
const DEFAULT_VALUE = "__deployment_default__";

/** Display label for one roster entry: its published name, else its id. */
function presetLabel(preset: AgentPresetEntry): string {
  return preset.name ?? preset.id;
}

/**
 * The agentPreset picker chip (story #117 task #121): the roster arrives
 * from `agentPreset.list` (fetched server-side by the home page), and the
 * selection reaches `session.create`'s agentPreset field through the
 * island's submit. A broken preset stays visible but unselectable - the
 * contract says surfaces must be able to show it, and offering it would
 * only defer its reason to a failed session start. A user-trust preset is
 * marked as such rather than presented as vetted.
 */
export function ComposerPresetChip({
  presets,
  value,
  onChange,
}: {
  presets: AgentPresetEntry[];
  /** The chosen preset id; null means the deployment default. */
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const selected = value === null ? undefined : presets.find((p) => p.id === value);
  const label = selected === undefined ? "Default agent" : presetLabel(selected);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Agent preset"
        className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground aria-expanded:bg-accent aria-expanded:text-accent-foreground"
      >
        <RiRocketLine className="size-3.5 shrink-0" />
        <span className="min-w-0 break-words text-left">{label}</span>
        <RiArrowDownSLine className="size-3.5 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-64">
        <DropdownMenuRadioGroup
          value={value ?? DEFAULT_VALUE}
          onValueChange={(next) => {
            const id = String(next);
            onChange(id === DEFAULT_VALUE ? null : id);
          }}
        >
          <DropdownMenuRadioItem value={DEFAULT_VALUE}>
            <span className="flex min-w-0 flex-col">
              <span>Default agent</span>
              <span className="text-muted-foreground">
                The deployment composes the session&apos;s agent
              </span>
            </span>
          </DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Presets</DropdownMenuLabel>
          {presets.map((preset) => (
            <DropdownMenuRadioItem
              key={preset.id}
              value={preset.id}
              disabled={preset.broken !== undefined}
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate">
                  {presetLabel(preset)}
                  {preset.trust === "user" ? " · local" : ""}
                </span>
                <span className="break-all text-muted-foreground">
                  {preset.broken ?? preset.description ?? preset.id}
                </span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

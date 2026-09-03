"use client";

import { useState } from "react";
import type { AgentPresetEntry } from "@deepseek-ai/dsh-host-apiproxy/api";
import { RiRocketLine } from "@remixicon/react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { PickerRow } from "@/components/picker-row";

/** The radio value meaning "name no preset": the deployment default applies. */
const DEFAULT_LABEL = "Default agent";

/** Display label for one roster entry: its published name, else its id. */
function presetLabel(preset: AgentPresetEntry): string {
  return preset.name ?? preset.id;
}

/**
 * The agentPreset picker chip (story #117 task #121; dialog per the
 * `## Design` packet - the whole action row opens dialogs): the roster
 * arrives from `agentPreset.list` (fetched server-side by the home page)
 * and the selection reaches `session.create`'s agentPreset field through
 * the island's submit. A broken preset stays VISIBLE, disabled, with the
 * host's reason on its meta line - a silently missing preset the user
 * expects is a mystery, a disabled one is an explanation. A user-trust
 * preset is marked "(local)" rather than presented as vetted. The
 * collapsed chip carries the value only.
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
  const [open, setOpen] = useState(false);
  const selected = value === null ? undefined : presets.find((p) => p.id === value);
  const label = selected === undefined ? DEFAULT_LABEL : presetLabel(selected);

  const pick = (next: string | null) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        aria-label="Agent preset"
        className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground aria-expanded:bg-accent aria-expanded:text-accent-foreground"
      >
        <RiRocketLine className="size-3.5 shrink-0" />
        <span className="min-w-0 break-words text-left">{label}</span>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Choose a preset</DialogTitle>
          <DialogDescription>How the session&apos;s agent is configured.</DialogDescription>
        </DialogHeader>
        <div className="max-h-72 overflow-y-auto">
          <div className="flex flex-col">
            <PickerRow
              selected={value === null}
              onSelect={() => pick(null)}
              primary={DEFAULT_LABEL}
              secondary="The deployment composes the session's agent"
              leading="check"
            />
            <div className="my-1 h-px bg-input" />
            {presets.map((preset) => (
              <PickerRow
                key={preset.id}
                selected={value === preset.id}
                onSelect={() => pick(preset.id)}
                disabled={preset.broken !== undefined}
                primary={
                  preset.trust === "user" ? `${presetLabel(preset)} (local)` : presetLabel(preset)
                }
                {...(preset.broken !== undefined
                  ? { secondary: preset.broken }
                  : preset.description !== undefined
                    ? { secondary: preset.description }
                    : { secondary: preset.id })}
                leading="check"
              />
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

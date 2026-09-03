"use client";

import { RiArrowLeftSLine, RiArrowRightSLine, RiCheckLine } from "@remixicon/react";

import { cn } from "@/lib/utils";

/**
 * The picker row system (story #117 `## Design` - Visual direction): the
 * type ladder and the one row that renders it, shared by every dialog
 * the composer's action row opens (model, preset; the folder tree keeps
 * its own row shape but uses these constants). Three roles, one style
 * each:
 *
 * - PRIMARY: the tappable answer (text-xs; medium when selected).
 * - LABEL: a provider's name - group headers and the Default row's
 *   provider line share it (11px medium muted).
 * - META: every other supporting line (11px muted, never heavier than
 *   the primary it sits under).
 */
export const PRIMARY_SELECTED = "bg-accent/60 font-medium";
export const LABEL = "block break-words text-[11px] leading-tight font-medium text-muted-foreground";
export const META = "block break-words text-[11px] leading-tight text-muted-foreground";

/** One selectable row of a picker dialog. */
export function PickerRow({
  selected,
  onSelect,
  primary,
  label,
  secondary,
  leading,
  chevron,
  disabled,
}: {
  selected: boolean;
  onSelect: () => void;
  primary: string;
  /** The provider line (LABEL role). */
  label?: string;
  /** The meta line under the primary (META role) - also carries a broken preset's reason. */
  secondary?: string;
  leading?: "check" | "back" | "chevron" | undefined;
  chevron?: boolean;
  /** A visible row that cannot be chosen (a broken preset): never silently missing. */
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        "flex w-full items-center gap-2 rounded-sm px-1.5 py-1.5 text-left text-xs outline-none hover:bg-accent focus-visible:bg-accent",
        selected && PRIMARY_SELECTED,
        disabled && "cursor-default text-muted-foreground hover:bg-transparent",
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

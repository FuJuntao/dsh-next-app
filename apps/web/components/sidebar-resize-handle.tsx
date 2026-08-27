"use client";

import { useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { useSidebar } from "@/components/ui/sidebar";
import { updatePreferences } from "../lib/preferences";
import "./sidebar-resize-handle.css";

/**
 * The sidebar drag-resize handle. The shadcn Sidebar sizes itself from
 * the --sidebar-width CSS variable (the docs' width channel), so the
 * handle needs no React state: it reads the variable off the
 * SidebarProvider wrapper and writes the new width into it while
 * dragging, then persists the result to the preferences cookie on
 * release. The wrapper's data-dragging attribute (this component's CSS)
 * disables the width transitions while dragging. The clamps
 * (--sidebar-min-width, --sidebar-center-min) and the keyboard step
 * (--sidebar-resize-step) are CSS variables in globals.css, the single
 * source for the shell's width constraints.
 */
/**
 * Fallbacks mirroring the shell's constraint variables - globals.css
 * :root: --sidebar-min-width (216px), --sidebar-center-min (360px),
 * --sidebar-resize-step (16px) - and the component's stock
 * --sidebar-width (16rem = 256px). The CSS variables are the single
 * source of truth; these literals only cover a stylesheet that fails to
 * load them, so they live in one named place instead of inline.
 */
const CSS_FALLBACKS = { min: 216, centerMin: 360, step: 16, width: 256 };

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

/** Resolve a theme constraint variable (globals.css) to px. */
function readThemeVar(name: string): number | null {
  const parsed = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(parsed) ? parsed : null;
}

/** The shell's width clamps, from CSS; fallbacks if the stylesheet is broken. */
function shellClamps(): { min: number; centerMin: number } {
  return {
    min: readThemeVar("--sidebar-min-width") ?? CSS_FALLBACKS.min,
    centerMin: readThemeVar("--sidebar-center-min") ?? CSS_FALLBACKS.centerMin,
  };
}

/** Persist the width to the preferences cookie the server renders from (no flash). */
function persistWidth(width: number): void {
  // Fire-and-forget: updatePreferences swallows storage failures itself.
  void updatePreferences({ layoutWidth: Math.round(width) });
}

export function SidebarResizeHandle() {
  const { isMobile, state } = useSidebar();
  // Fallbacks for the initial value; overwritten at pointerdown from CSS.
  const dragStart = useRef({
    x: 0,
    width: CSS_FALLBACKS.width,
    min: CSS_FALLBACKS.min,
    centerMin: CSS_FALLBACKS.centerMin,
  });
  // The provider wrapper the handle resizes; null while not dragging.
  const wrapperRef = useRef<HTMLElement | null>(null);

  const wrapperOf = (el: HTMLElement): HTMLElement | null =>
    el.closest("[data-slot='sidebar-wrapper']");

  const maxWidth = (min: number, centerMin: number): number =>
    Math.max(min, window.innerWidth - centerMin);

  // The sidebar's resolved width. --sidebar-width is a custom property:
  // computed style returns the raw expression (e.g. the layout's
  // max(min(...)) cap), not a px value, so parsing it would snap to the
  // fallback. The gap track resolves the variable in layout, so measure
  // it; CSS_FALLBACKS.width only covers a missing or zero-width track.
  const readWidth = (el: HTMLElement): number => {
    const rect = el.querySelector("[data-slot='sidebar-gap']")?.getBoundingClientRect();
    return rect !== undefined && rect.width > 0 ? rect.width : CSS_FALLBACKS.width;
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (isMobile) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const wrapper = wrapperOf(event.currentTarget);
    if (wrapper === null) return;
    wrapperRef.current = wrapper;
    dragStart.current = { x: event.clientX, width: readWidth(wrapper), ...shellClamps() };
    wrapper.setAttribute("data-dragging", "true");
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const wrapper = wrapperRef.current;
    if (wrapper === null) return;
    const { x, width, min, centerMin } = dragStart.current;
    const next = clamp(width + event.clientX - x, min, maxWidth(min, centerMin));
    wrapper.style.setProperty("--sidebar-width", next + "px");
  };

  const endDrag = (): void => {
    const wrapper = wrapperRef.current;
    if (wrapper === null) return;
    wrapperRef.current = null;
    wrapper.removeAttribute("data-dragging");
    persistWidth(readWidth(wrapper));
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    // While folded the gap track is 0, so the width would read as the
    // fallback and clobber the stored width; the handle is off-screen but
    // still tab-focusable (offcanvas keeps the nav in the tab order).
    if (state === "collapsed") return;
    const wrapper = wrapperOf(event.currentTarget);
    if (wrapper === null) return;
    const clamps = shellClamps();
    const step = readThemeVar("--sidebar-resize-step") ?? CSS_FALLBACKS.step;
    const next = clamp(
      readWidth(wrapper) + (event.key === "ArrowLeft" ? -step : step),
      clamps.min,
      maxWidth(clamps.min, clamps.centerMin),
    );
    wrapper.style.setProperty("--sidebar-width", next + "px");
    persistWidth(next);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      tabIndex={0}
      className="absolute inset-y-0 right-0 z-10 hidden w-2.5 cursor-col-resize touch-none select-none outline-hidden focus-visible:ring-1 focus-visible:ring-ring md:block"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={handleKeyDown}
    />
  );
}

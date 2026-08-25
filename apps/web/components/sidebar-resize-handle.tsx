"use client";

import { useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { useSidebar } from "@/components/ui/sidebar";
import { PREFERENCES_COOKIE, encodePreferences } from "../lib/preferences";

/**
 * The sidebar drag-resize handle. The shadcn Sidebar sizes itself from
 * the --sidebar-width CSS variable (the docs' width channel), so the
 * handle needs no React state: it reads the variable off the
 * SidebarProvider wrapper and writes the new width into it while
 * dragging, then persists the result to the preferences cookie on
 * release. The wrapper's data-dragging attribute arms the Tailwind
 * variants (group-data-[dragging=true]/sidebar-wrapper:transition-none)
 * on the stock gap/container elements (sidebar.tsx), so the width
 * transitions stay off while dragging. The clamps
 * (--sidebar-min-width, --sidebar-center-min) and the keyboard step
 * (--sidebar-resize-step) are CSS variables in globals.css, the single
 * source for the shell's width constraints.
 */
function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

/** Resolve a theme constraint variable (globals.css) to px. */
function readThemeVar(name: string): number | null {
  const parsed = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(parsed) ? parsed : null;
}

/** The shell's width clamps, from CSS; literal fallbacks if the stylesheet is broken. */
function shellClamps(): { min: number; centerMin: number } {
  return {
    min: readThemeVar("--sidebar-min-width") ?? 216,
    centerMin: readThemeVar("--sidebar-center-min") ?? 360,
  };
}

/** Persist the width to the preferences cookie the server renders from (no flash). */
function persistWidth(width: number): void {
  try {
    document.cookie =
      PREFERENCES_COOKIE +
      "=" +
      encodePreferences({ layout: { width: Math.round(width) } }) +
      ";path=/;max-age=31536000;samesite=lax";
  } catch {
    // Storage unavailable: the in-memory width still applies.
  }
}

export function SidebarResizeHandle() {
  const { isMobile } = useSidebar();
  // Fallbacks for the initial value; overwritten at pointerdown from CSS.
  const dragStart = useRef({ x: 0, width: 256, min: 216, centerMin: 360 });
  // The provider wrapper the handle resizes; null while not dragging.
  const wrapperRef = useRef<HTMLElement | null>(null);

  const wrapperOf = (el: HTMLElement): HTMLElement | null =>
    el.closest("[data-slot='sidebar-wrapper']");

  const maxWidth = (min: number, centerMin: number): number =>
    Math.max(min, window.innerWidth - centerMin);

  // The resolved width the CSS variable currently renders (a min()/max()
  // value resolves to px in computed style). The wrapper always carries
  // the variable: the component's own default (16rem) or the layout's cap.
  const readWidth = (el: HTMLElement): number => {
    const parsed = parseFloat(getComputedStyle(el).getPropertyValue("--sidebar-width"));
    return Number.isFinite(parsed) ? parsed : 256;
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
    const wrapper = wrapperOf(event.currentTarget);
    if (wrapper === null) return;
    const clamps = shellClamps();
    const step = readThemeVar("--sidebar-resize-step") ?? 16;
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

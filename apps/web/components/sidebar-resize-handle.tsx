"use client";

import { useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { useSidebar } from "@/components/ui/sidebar";
import {
  CENTER_MIN,
  DEFAULT_WIDTH,
  MIN_WIDTH,
  RESIZE_STEP,
  WIDTH_COOKIE,
} from "../lib/sidebar-width";

/**
 * The sidebar drag-resize handle. The shadcn Sidebar sizes itself from
 * the --sidebar-width CSS variable (the docs' width channel), so the
 * handle needs no React state: it reads the variable off the
 * SidebarProvider wrapper, writes the new width into it while dragging
 * (the wrapper's data-dragging attribute disables the width transitions,
 * globals.css), and persists the result to the width cookie on release.
 * Pointer and keyboard resize are clamped to the shell's minimum and the
 * center column's minimum.
 */
function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

/** Persist the width to the cookie the server renders from (no flash). */
function persistWidth(width: number): void {
  try {
    document.cookie =
      WIDTH_COOKIE + "=" + Math.round(width) + ";path=/;max-age=31536000;samesite=lax";
  } catch {
    // Storage unavailable: the in-memory width still applies.
  }
}

export function SidebarResizeHandle() {
  const { isMobile } = useSidebar();
  const dragStart = useRef({ x: 0, width: DEFAULT_WIDTH });
  // The provider wrapper the handle resizes; null while not dragging.
  const wrapperRef = useRef<HTMLElement | null>(null);

  const wrapperOf = (el: HTMLElement): HTMLElement | null =>
    el.closest("[data-slot='sidebar-wrapper']");

  const maxWidth = (): number => Math.max(MIN_WIDTH, window.innerWidth - CENTER_MIN);

  // The resolved width the CSS variable currently renders (a min() value
  // resolves to px in computed style).
  const readWidth = (el: HTMLElement): number => {
    const parsed = parseFloat(getComputedStyle(el).getPropertyValue("--sidebar-width"));
    return Number.isFinite(parsed) ? parsed : DEFAULT_WIDTH;
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (isMobile) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const wrapper = wrapperOf(event.currentTarget);
    if (wrapper === null) return;
    wrapperRef.current = wrapper;
    dragStart.current = { x: event.clientX, width: readWidth(wrapper) };
    wrapper.setAttribute("data-dragging", "true");
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const wrapper = wrapperRef.current;
    if (wrapper === null) return;
    const next = clamp(
      dragStart.current.width + event.clientX - dragStart.current.x,
      MIN_WIDTH,
      maxWidth(),
    );
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
    const next = clamp(
      readWidth(wrapper) + (event.key === "ArrowLeft" ? -RESIZE_STEP : RESIZE_STEP),
      MIN_WIDTH,
      maxWidth(),
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

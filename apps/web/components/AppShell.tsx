"use client";

import { useRef, useState } from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { RiCloseLine, RiSettings3Line } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/use-mobile";
import { DEFAULT_LAYOUT_WIDTH, PREFERENCES_COOKIE, encodePreferences } from "../lib/preferences";

/**
 * The app shell (story #97): header, resizable and foldable left side nav,
 * center content column — built on the shadcn Sidebar (Base UI) over the
 * preset's lyra theme. The Sidebar component supplies what it ships out of
 * the box: the desktop fold (offcanvas), the mobile overlay drawer (Sheet),
 * the toggle button, and the keyboard shortcut. This component adds only
 * what the component cannot express: the drag-resize handle, the
 * preferences cookie channel, and the SSR markers the first paint renders
 * from (no flash). The clamps and the overflow cap read the shell geometry
 * tokens (--shell-sidebar-min, --shell-center-min) and the breakpoint
 * (--breakpoint-md) from globals.css - the theme is the single source,
 * no magic constants.
 *
 * - Desktop (>= the md breakpoint): the side nav sits in flow; a drag
 *   handle resizes it; the always-visible header toggle folds it away
 *   (offcanvas).
 * - Below it: the side nav becomes a Sheet overlay drawer opened from the
 *   header toggle; it never pushes the content.
 */

/** Arrow-key resize step (interaction tuning, not a design token). */
const RESIZE_STEP = 16;

// Fallbacks mirror the globals.css defaults; the CSS custom properties
// (--shell-sidebar-min, --shell-center-min) are the source of truth.
const FALLBACK_SIDEBAR_MIN = 160;
const FALLBACK_CENTER_MIN = 360;

/** Read a shell geometry token as px; rem resolves against the initial
 *  font-size (16px), like media queries do. */
function shellVar(name: string, fallback: number): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return fallback;
  return raw.endsWith("rem") ? value * 16 : value;
}

/** The shell's clamps, read once from the theme (first call is a client
 *  event handler, so SSR never touches the document). */
let shellGeometry: { min: number; centerMin: number } | undefined;
function shellGeometryVars(): { min: number; centerMin: number } {
  shellGeometry ??= {
    min: shellVar("--shell-sidebar-min", FALLBACK_SIDEBAR_MIN),
    centerMin: shellVar("--shell-center-min", FALLBACK_CENTER_MIN),
  };
  return shellGeometry;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

/** Persist the shell prefs to the cookie the server renders from (no flash). */
function persistShell(width: number, folded: boolean): void {
  try {
    const prefs = encodePreferences({
      layout: { width: Math.round(width), folded },
    });
    document.cookie = `${PREFERENCES_COOKIE}=${prefs};path=/;max-age=31536000;samesite=lax`;
  } catch {
    // Storage unavailable: the in-memory state still applies.
  }
}

/** The mobile drawer's own close button (the Sheet hides its built-in one). */
function SidebarCloseButton() {
  const { toggleSidebar } = useSidebar();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Close navigation"
      className="self-start md:hidden"
      onClick={toggleSidebar}
    >
      <RiCloseLine />
    </Button>
  );
}

export function AppShell({
  children,
  initialWidth,
  initialFolded,
}: {
  children: ReactNode;
  initialWidth?: number;
  initialFolded?: boolean;
}) {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [width, setWidth] = useState(() =>
    Math.max(FALLBACK_SIDEBAR_MIN, Math.round(initialWidth ?? DEFAULT_LAYOUT_WIDTH)),
  );
  const [folded, setFolded] = useState(initialFolded ?? false);
  const [dragging, setDragging] = useState(false);
  const widthRef = useRef(width);

  widthRef.current = width;

  // The SidebarProvider owns the open state (desktop) and the drawer state
  // (mobile); desktop changes come back through onOpenChange so the folded
  // flag and the prefs cookie stay in sync with it.
  const handleOpenChange = (open: boolean): void => {
    setFolded(!open);
    persistShell(widthRef.current, !open);
  };

  const maxWidth = (): number =>
    Math.max(shellGeometryVars().min, window.innerWidth - shellGeometryVars().centerMin);

  const dragStart = useRef({ x: 0, width: DEFAULT_LAYOUT_WIDTH });

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (isMobile) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStart.current = { x: event.clientX, width: widthRef.current };
    setDragging(true);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!dragging) return;
    const next = clamp(
      dragStart.current.width + event.clientX - dragStart.current.x,
      shellGeometryVars().min,
      maxWidth(),
    );
    setWidth(next);
  };

  const handlePointerEnd = (): void => {
    if (!dragging) return;
    setDragging(false);
    persistShell(widthRef.current, folded);
  };

  const handleResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowLeft" ? -RESIZE_STEP : RESIZE_STEP;
    setWidth((current) => {
      const next = clamp(current + delta, shellGeometryVars().min, maxWidth());
      persistShell(next, folded);
      return next;
    });
  };

  // The stored width is capped against the center minimum in CSS (AC-5
  // no-overflow): the cap reads --shell-center-min from the theme, so the
  // invariant lives in globals.css, not here. It resolves against the
  // viewport (100vw), not the sidebar's own flex parent: a percentage
  // there is indefinite (auto-width ancestor) and would collapse the
  // in-flow column track to zero.
  const shellStyle = {
    "--sidebar-width": `min(${width}px, calc(100vw - var(--shell-center-min)))`,
  } as CSSProperties;

  return (
    <SidebarProvider
      // Controlled: onOpenChange (which persists the prefs cookie) makes the
      // provider controlled, so the open prop is the single source of truth.
      open={!folded}
      onOpenChange={handleOpenChange}
      style={shellStyle}
      data-folded={folded || undefined}
      data-dragging={dragging || undefined}
    >
      <Sidebar
        collapsible="offcanvas"
        // Folded on desktop the nav is off-screen; keep it out of the tab
        // order until it is opened again (the mobile drawer is a Sheet and
        // manages its own focus).
        inert={isMobile ? undefined : folded || undefined}
      >
        <div role="navigation" aria-label="Primary" className="flex size-full min-h-0 flex-col">
          <SidebarHeader>
            <SidebarCloseButton />
          </SidebarHeader>
          <SidebarContent />
          <SidebarSeparator />
          <SidebarFooter className="items-center">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Settings"
              onClick={() => router.push("/settings")}
            >
              <RiSettings3Line />
            </Button>
          </SidebarFooter>
        </div>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          tabIndex={0}
          className="absolute inset-y-0 right-0 z-10 hidden w-2.5 cursor-col-resize touch-none select-none outline-none md:block"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          onKeyDown={handleResizeKeyDown}
        />
      </Sidebar>
      <div className="relative flex w-full flex-1 flex-col bg-background">
        <header className="flex h-12 shrink-0 items-center gap-3 px-4">
          <SidebarTrigger
            aria-label="Toggle navigation"
            aria-expanded={isMobile ? undefined : !folded || undefined}
          />
        </header>
        <Separator />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-6 py-4">{children}</div>
        </main>
      </div>
    </SidebarProvider>
  );
}

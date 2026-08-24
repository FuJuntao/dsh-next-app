"use client";

import { useRef, useState } from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { RiCloseLine, RiSettings3Line } from "@remixicon/react";
import { DshHarnessChip, DshLogo, DshWordmark } from "./dsh-logo";
import { SESSIONS } from "../lib/sessions";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/use-mobile";
import { PREFERENCES_COOKIE, encodePreferences } from "../lib/preferences";

/**
 * The app shell (story #97): header, resizable and foldable left side nav,
 * center content column — built on the shadcn Sidebar (Base UI) over the
 * preset's lyra theme. The Sidebar component supplies what it ships out of
 * the box: the desktop fold (offcanvas), the mobile overlay drawer (Sheet),
 * the toggle button, and the keyboard shortcut. This component adds only
 * what the component cannot express: the drag-resize handle with its
 * clamps (160px minimum, 360px minimum center column), the preferences
 * cookie channel, and the SSR markers the first paint renders from (no
 * flash). The stored width is capped in CSS (min against the center-min)
 * so a hand-edited cookie can never overflow the shell.
 *
 * - Desktop (>= 768px, useIsMobile's breakpoint): the side nav sits in
 *   flow; a drag handle resizes it; the always-visible header toggle folds
 *   it away (offcanvas).
 * - Below 768px: the side nav becomes a Sheet overlay drawer opened from
 *   the header toggle; it never pushes the content.
 */

// The brand row (whale + "DeepSeek Harness" wordmark) is 188px plus
// the header padding, so the sidebar cannot narrow below 216px - the
// full logo always fits, nothing hides at the minimum.
const DEFAULT_WIDTH = 260;
const MIN_WIDTH = 216;
const CENTER_MIN = 360;
const RESIZE_STEP = 16;

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
      className="md:hidden"
      onClick={toggleSidebar}
    >
      <RiCloseLine />
    </Button>
  );
}

/**
 * The brand (story #104): exactly the two svgs from the built-in web app's
 * sidebar - the whale mark and the "DeepSeek" letterform wordmark, taken
 * verbatim (dsh-logo.tsx) - as a link to the home page. On mobile the row
 * sits in the drawer's header beside the close button, and navigating from
 * the drawer closes it first.
 */
function SidebarBrand() {
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <Link
      href="/"
      aria-label="DeepSeek Harness"
      onClick={() => {
        if (isMobile) setOpenMobile(false);
      }}
      // Inline brand row: the whale, the "DeepSeek" wordmark, and the
      // "harness" chip - at their intrinsic sizes with 8px gaps, flat (no
      // padding box), content-width. The sidebar's minimum width (216px)
      // fits the full row, so nothing hides or overflows.
      className="flex w-fit items-center gap-2 text-sidebar-foreground transition-colors hover:text-sidebar-accent-foreground"
    >
      <DshLogo className="shrink-0" />
      <DshWordmark className="shrink-0" />
      <DshHarnessChip className="shrink-0" />
    </Link>
  );
}

/**
 * The sessions list (story #104): one row per session linking to its
 * /sessions/[id] page, with the current session highlighted. The rows come
 * from lib/sessions.ts - the static stand-in for the bridge data channel
 * (ADR-0003) - so swapping the data source later never touches this chrome.
 */
function SessionsNav() {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Sessions</SidebarGroupLabel>
      <SidebarMenu>
        {SESSIONS.map((session) => (
          <SidebarMenuItem key={session.id}>
            <SidebarMenuButton
              isActive={pathname === `/sessions/${session.id}`}
              render={
                <Link
                  href={`/sessions/${session.id}`}
                  onClick={() => {
                    if (isMobile) setOpenMobile(false);
                  }}
                />
              }
            >
              <span className="truncate">{session.title}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}

/**
 * The settings entry at the bottom of the side nav: a footer menu group
 * with the gear icon and its label, active on /settings, closing the
 * mobile drawer on navigation like the sessions rows.
 */
function SettingsNav() {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          isActive={pathname === "/settings"}
          render={
            <Link
              href="/settings"
              onClick={() => {
                if (isMobile) setOpenMobile(false);
              }}
            />
          }
        >
          <RiSettings3Line />
          <span>Settings</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
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
  const isMobile = useIsMobile();
  const [width, setWidth] = useState(() =>
    Math.max(MIN_WIDTH, Math.round(initialWidth ?? DEFAULT_WIDTH)),
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

  const maxWidth = (): number => Math.max(MIN_WIDTH, window.innerWidth - CENTER_MIN);

  const dragStart = useRef({ x: 0, width: DEFAULT_WIDTH });

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
      MIN_WIDTH,
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
      const next = clamp(current + delta, MIN_WIDTH, maxWidth());
      persistShell(next, folded);
      return next;
    });
  };

  // The stored width is capped against the center minimum in CSS, so a
  // width from a wider screen (or a hand-edited prefs cookie) can never
  // overflow the shell (AC-5 no-overflow). The cap resolves against the
  // viewport (100vw), not the sidebar's own flex parent: a percentage
  // there is indefinite (auto-width ancestor) and would collapse the
  // in-flow column track to zero.
  const shellStyle = {
    "--sidebar-width": `min(${width}px, calc(100vw - ${CENTER_MIN}px))`,
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
            <div className="flex items-center justify-between gap-2">
              <SidebarBrand />
              <SidebarCloseButton />
            </div>
          </SidebarHeader>
          <SidebarContent>
            <SessionsNav />
          </SidebarContent>
          <SidebarFooter>
            <SettingsNav />
          </SidebarFooter>
        </div>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          tabIndex={0}
          className="absolute inset-y-0 right-0 z-10 hidden w-2.5 cursor-col-resize touch-none select-none outline-hidden focus-visible:ring-1 focus-visible:ring-ring md:block"
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
            aria-expanded={isMobile ? undefined : !folded}
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

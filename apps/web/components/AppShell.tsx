"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { RiSettings3Line } from "@remixicon/react";
import { DshHarnessChip, DshLogo, DshWordmark } from "./dsh-logo";
import { SESSIONS } from "../lib/sessions";
import { SidebarResizeHandle } from "./sidebar-resize-handle";
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
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";

/**
 * The app shell (story #97): side nav and content column, composed
 * entirely from the shadcn Sidebar (Base UI) over the preset's lyra
 * theme. The component supplies what it ships out of the box: the desktop
 * fold (offcanvas), the mobile overlay drawer (Sheet with its stock close
 * button), the toggle button, the keyboard shortcut, and the sidebar
 * width via the --sidebar-width CSS variable the layout declares. This
 * file only adds what the component cannot express: the brand row, the
 * sessions list, and the settings entry - small components that read the
 * layout's provider context through useSidebar.
 *
 * - Desktop (>= 768px, useIsMobile's breakpoint): the side nav sits in
 *   flow at the stored width, drag-resizable from the edge handle
 *   (sidebar-resize-handle.tsx); the always-visible header toggle folds
 *   it away (offcanvas).
 * - Below 768px: the side nav becomes a Sheet overlay drawer opened from
 *   the header toggle; it never pushes the content.
 */

/**
 * The brand (story #104): exactly the two svgs from the built-in web app's
 * sidebar - the whale mark and the "DeepSeek" letterform wordmark, taken
 * verbatim (dsh-logo.tsx) - as a link to the home page. On mobile the row
 * sits in the drawer's header, and navigating from the drawer closes it
 * first.
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
      // padding box), content-width. The sidebar's width (260px) fits the
      // full row, so nothing hides or overflows.
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

/**
 * The side nav, as the docs compose it: brand in the sticky header, the
 * sessions group in the scrollable content region, settings in the sticky
 * footer. The nav landmark wrapper is what the e2e suite's layout specs
 * address (and a real landmark for screen readers).
 */
export function AppSidebar() {
  return (
    <Sidebar collapsible="offcanvas">
      <div role="navigation" aria-label="Primary" className="flex size-full min-h-0 flex-col">
        <SidebarHeader>
          <SidebarBrand />
        </SidebarHeader>
        <SidebarContent>
          <SessionsNav />
        </SidebarContent>
        <SidebarFooter>
          <SettingsNav />
        </SidebarFooter>
      </div>
      <SidebarResizeHandle />
    </Sidebar>
  );
}

/**
 * The content column: the always-visible header with the fold toggle,
 * then the scrollable page area (max-width 48rem) under the separator.
 * The SidebarProvider lives in app/layout.tsx (the docs' usage pattern),
 * so this column needs no sidebar state of its own.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex w-full flex-1 flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-3 px-4">
        <SidebarTrigger aria-label="Toggle navigation" />
      </header>
      <Separator />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-4">{children}</div>
      </main>
    </div>
  );
}

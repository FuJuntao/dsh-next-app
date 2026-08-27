"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { RiCloseLine, RiSettings3Line } from "@remixicon/react";
import { DshHarnessChip, DshLogo, DshWordmark } from "./dsh-logo";
import type { SessionViewPreferences } from "../lib/preferences";
import type { SessionsResult } from "../lib/sessions";
import { SessionsNav } from "./sessions-nav";
import { SidebarResizeHandle } from "./sidebar-resize-handle";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
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
 * fold (offcanvas), the mobile overlay drawer (Sheet - its built-in close
 * stays hidden, the app renders its own in the drawer header), the toggle
 * button, the keyboard shortcut, and the sidebar width via the
 * --sidebar-width CSS variable the layout declares. This
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
 * The mobile drawer's own close button (the Sheet hides its built-in one).
 */
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
      // "harness" chip - at their intrinsic sizes with 8px gaps, padded
      // with p-2 on the brand itself (the header keeps its stock p-2, so
      // the row's box sits at the shell's 16px inset). The row fits the
      // shell's minimum sidebar width (--sidebar-min-width, globals.css),
      // so nothing hides or overflows at the narrowest setting.
      className="flex w-fit items-center gap-2 p-2 text-sidebar-foreground transition-colors hover:text-sidebar-accent-foreground"
    >
      <DshLogo className="shrink-0" />
      <DshWordmark className="shrink-0" />
      <DshHarnessChip className="shrink-0" />
    </Link>
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
 * address (and a real landmark for screen readers). The sessions list and
 * its view prefs arrive from the layout's server fetch and cookie read;
 * sessions-nav.tsx owns everything about rendering them.
 */
export function AppSidebar({
  sessions,
  sessionViewPreferences,
}: {
  sessions: SessionsResult;
  sessionViewPreferences: SessionViewPreferences;
}) {
  return (
    <Sidebar collapsible="offcanvas">
      <div role="navigation" aria-label="Primary" className="flex size-full min-h-0 flex-col">
        <SidebarHeader>
          <div className="flex items-center justify-between gap-2">
            <SidebarBrand />
            <SidebarCloseButton />
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SessionsNav sessions={sessions} sessionViewPreferences={sessionViewPreferences} />
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
 * The content column on the stock SidebarInset: the always-visible header
 * with the fold toggle, then the scrollable page area (max-width 48rem)
 * under the separator. The SidebarProvider lives in app/layout.tsx (the
 * docs' usage pattern), so this column needs no sidebar state of its own.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SidebarInset>
      {/* The header sits inside the inset's <main> column, so its implicit
          banner role would be lost (header->banner only outside main);
          the explicit role keeps the page landmark. */}
      <header role="banner" className="flex h-12 shrink-0 items-center gap-3 px-4">
        <SidebarTrigger aria-label="Toggle navigation" />
      </header>
      <Separator />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-4">{children}</div>
      </div>
    </SidebarInset>
  );
}

"use client";

import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { updatePreferences } from "../lib/preferences";

/**
 * The shell's controlled SidebarProvider: the single owner of the shell's
 * preference state. It is controlled, so the fold can ride the
 * preferences channel - the Sidebar itself only persists to its stock
 * sidebar_state cookie when uncontrolled, which the shell never reads -
 * and it declares the width preference through the docs' CSS-variable
 * channel: when a stored width exists the shell renders --sidebar-width
 * from it, floored and capped against the CSS constraint variables in
 * globals.css (a hand-edited cookie can never overflow the shell);
 * without one it sets nothing and the component's own CSS default
 * (16rem) styles the shell. The layout seeds both defaults from the prefs
 * cookie (readPreferences, lib/preferences-server.ts) for the first
 * paint (no flash); the resize handle mutates the width variable in
 * place and persists on release, and every desktop fold toggle persists
 * through updatePreferences.
 */
export function ShellSidebarProvider({
  children,
  initialFolded,
  initialWidth,
}: {
  children: ReactNode;
  initialFolded: boolean;
  initialWidth?: number | undefined;
}) {
  const [open, setOpen] = useState(!initialFolded);
  const handleOpenChange = (open: boolean): void => {
    setOpen(open);
    void updatePreferences({ layoutFolded: !open });
  };
  const style =
    initialWidth === undefined
      ? undefined
      : ({
          "--sidebar-width":
            "max(min(" +
            initialWidth +
            "px,calc(100vw - var(--sidebar-center-min))),var(--sidebar-min-width))",
        } as CSSProperties);
  return (
    <SidebarProvider open={open} onOpenChange={handleOpenChange} style={style}>
      {children}
    </SidebarProvider>
  );
}

"use client";

import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { updatePreferences } from "../lib/preferences";

/**
 * The shell's own SidebarProvider: controlled, so the fold state rides the
 * preferences channel (lib/preferences.ts) - the Sidebar itself only
 * persists to its stock sidebar_state cookie when uncontrolled, which the
 * shell never reads. The layout seeds the initial fold from the prefs
 * cookie, so the first HTML paint renders the stored state (no flash);
 * every desktop toggle persists back through updatePreferences. The width
 * style (--sidebar-width) passes through untouched.
 */
export function ShellSidebarProvider({
  children,
  initialFolded,
  style,
}: {
  children: ReactNode;
  initialFolded: boolean;
  style?: CSSProperties | undefined;
}) {
  const [open, setOpen] = useState(!initialFolded);
  const handleOpenChange = (open: boolean): void => {
    setOpen(open);
    updatePreferences({ layout: { folded: !open } });
  };
  return (
    <SidebarProvider open={open} onOpenChange={handleOpenChange} style={style}>
      {children}
    </SidebarProvider>
  );
}

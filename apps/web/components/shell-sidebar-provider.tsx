import type { ReactNode } from "react";
import { readPreferences } from "../lib/preferences-server";
import { ShellSidebarClient } from "./shell-sidebar-client";

/**
 * The shell's SidebarProvider (server side): reads the preferences from
 * the request cookie store and seeds the controlled client provider, so
 * the first HTML paint renders the stored fold and width (no flash). The
 * layout just composes the shell; all preference logic lives here and in
 * shell-sidebar-client.tsx.
 */
export async function ShellSidebarProvider({ children }: { children: ReactNode }) {
  const prefs = await readPreferences();
  return (
    <ShellSidebarClient
      initialFolded={prefs?.layout.folded ?? false}
      initialWidth={prefs?.layout.width}
    >
      {children}
    </ShellSidebarClient>
  );
}

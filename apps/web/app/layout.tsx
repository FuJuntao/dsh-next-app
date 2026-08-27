import type { Metadata } from "next";
import { Noto_Sans } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell, AppSidebar } from "../components/AppShell";
import { ShellSidebarProvider } from "../components/shell-sidebar-provider";
import { readPreferences } from "../lib/preferences-server";
import { fetchSessions } from "../lib/sessions";
import "./globals.css";

const notoSans = Noto_Sans({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "dsh-next-app",
  description: "Server-rendered replacement frontend for the DeepSeek Harness web surface",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const prefs = await readPreferences();
  // The live sessions list (ADR-0003): fetched through the bridge at
  // request time, so the first paint already carries the profile's real
  // sessions (the bridge-down state is a distinct render, never stale rows).
  // The stored view prefs ride along; arranging with them happens in the
  // shared pure model, server-side for this very paint (no flash).
  const sessions = await fetchSessions();
  // Built field-wise so absent cookie fields stay absent under
  // exactOptionalPropertyTypes (the same shape parsePreferences emits).
  const sessionViewPreferences = {
    ...(prefs?.sessionGroup !== undefined && { group: prefs.sessionGroup }),
  };
  return (
    <html lang="en" className={notoSans.variable}>
      <body>
        <TooltipProvider delay={0}>
          <ShellSidebarProvider
            initialFolded={prefs?.layoutFolded ?? false}
            initialWidth={prefs?.layoutWidth}
          >
            <AppSidebar sessions={sessions} sessionViewPreferences={sessionViewPreferences} />
            <AppShell>{children}</AppShell>
          </ShellSidebarProvider>
        </TooltipProvider>
      </body>
    </html>
  );
}

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
  const sessions = await fetchSessions();
  return (
    <html lang="en" className={notoSans.variable}>
      <body>
        <TooltipProvider delay={0}>
          <ShellSidebarProvider
            initialFolded={prefs?.layout.folded ?? false}
            initialWidth={prefs?.layout.width}
          >
            <AppSidebar sessions={sessions} />
            <AppShell>{children}</AppShell>
          </ShellSidebarProvider>
        </TooltipProvider>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell, AppSidebar } from "../components/AppShell";
import { ShellSidebarProvider } from "../components/shell-sidebar-provider";
import { readPreferences } from "../lib/preferences-server";
import "./globals.css";

const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "dsh-next-app",
  description: "Server-rendered replacement frontend for the DeepSeek Harness web surface",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The fold and the width both ride the preferences cookie
  // (lib/preferences.ts); the server reads it (lib/preferences-server.ts)
  // and passes the stored values as defaults to the shell's controlled
  // provider, so the first HTML paint renders the stored state directly
  // (no flash). An absent field simply leaves the shell on its
  // component/CSS default (nav open, --sidebar-width 16rem).
  const prefs = await readPreferences();
  return (
    <html lang="en" className={dmSans.variable}>
      <body>
        <TooltipProvider delay={0}>
          <ShellSidebarProvider
            initialFolded={prefs?.layout.folded ?? false}
            initialWidth={prefs?.layout.width}
          >
            <AppSidebar />
            <AppShell>{children}</AppShell>
          </ShellSidebarProvider>
        </TooltipProvider>
      </body>
    </html>
  );
}

import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { DM_Sans } from "next/font/google";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell, AppSidebar } from "../components/AppShell";
import { PREFERENCES_COOKIE, readPreferences } from "../lib/preferences";
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
  // The width rides the preferences cookie (lib/preferences.ts) through the
  // docs' CSS-variable channel: when a width preference exists the shell
  // declares --sidebar-width from it, floored and capped against the CSS
  // constraint variables in globals.css (so a hand-edited cookie can never
  // overflow the shell); without one it sets nothing and the component's
  // own CSS default (16rem) styles the shell. The provider is the stock,
  // uncontrolled one: the fold is transient UI state (the nav opens open
  // on every load), so nothing about it is read or persisted here.
  const cookieStore = await cookies();
  const prefs = readPreferences(cookieStore.get(PREFERENCES_COOKIE)?.value);
  const width = prefs?.layout.width;
  const widthStyle =
    width === undefined
      ? undefined
      : ({
          "--sidebar-width":
            "max(min(" +
            width +
            "px,calc(100vw - var(--sidebar-center-min))),var(--sidebar-min-width))",
        } as CSSProperties);
  return (
    <html lang="en" className={dmSans.variable}>
      <body>
        <TooltipProvider delay={0}>
          <SidebarProvider style={widthStyle}>
            <AppSidebar />
            <AppShell>{children}</AppShell>
          </SidebarProvider>
        </TooltipProvider>
      </body>
    </html>
  );
}

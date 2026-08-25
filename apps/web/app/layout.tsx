import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { DM_Sans } from "next/font/google";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell, AppSidebar } from "../components/AppShell";
import { CENTER_MIN, MIN_WIDTH, PREFERENCES_COOKIE, readPreferences } from "../lib/preferences";
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
  // The fold state rides the stock sidebar_state cookie the Sidebar writes
  // on every toggle; reading it here renders the stored state into the
  // first HTML so a reload paints it directly instead of flashing the
  // defaults. The sidebar width rides the preferences cookie
  // (lib/preferences.ts) through the docs' CSS-variable channel: the shell
  // declares --sidebar-width (the stored width, floored at the shell's
  // minimum and capped against the center column's minimum in CSS so a
  // hand-edited cookie can never overflow the shell) and the component
  // reads it everywhere it sizes itself.
  const cookieStore = await cookies();
  const folded = cookieStore.get("sidebar_state")?.value === "false";
  const width = Math.max(
    MIN_WIDTH,
    readPreferences(cookieStore.get(PREFERENCES_COOKIE)?.value).layout.width,
  );
  return (
    <html lang="en" className={dmSans.variable}>
      <body>
        <TooltipProvider delay={0}>
          <SidebarProvider
            defaultOpen={!folded}
            style={
              {
                "--sidebar-width": "min(" + width + "px, calc(100vw - " + CENTER_MIN + "px))",
              } as CSSProperties
            }
          >
            <AppSidebar />
            <AppShell>{children}</AppShell>
          </SidebarProvider>
        </TooltipProvider>
      </body>
    </html>
  );
}

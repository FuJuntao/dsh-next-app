import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell, AppSidebar } from "../components/AppShell";
import { ShellSidebarProvider } from "../components/shell-sidebar-provider";
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
  // The shell provider owns all preference logic: it reads the prefs
  // cookie server-side (no flash) and seeds the controlled client
  // provider, so a reload paints the stored fold and width directly.
  return (
    <html lang="en" className={dmSans.variable}>
      <body>
        <TooltipProvider delay={0}>
          <ShellSidebarProvider>
            <AppSidebar />
            <AppShell>{children}</AppShell>
          </ShellSidebarProvider>
        </TooltipProvider>
      </body>
    </html>
  );
}

import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { DM_Sans } from "next/font/google";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell, AppSidebar } from "../components/AppShell";
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
  // defaults. The sidebar width is the docs' CSS-variable channel: the
  // shell declares --sidebar-width (16.25rem, the pre-resize default) and
  // the component reads it everywhere it sizes itself.
  const cookieStore = await cookies();
  const folded = cookieStore.get("sidebar_state")?.value === "false";
  return (
    <html lang="en" className={dmSans.variable}>
      <body>
        <TooltipProvider delay={0}>
          <SidebarProvider
            defaultOpen={!folded}
            style={{ "--sidebar-width": "16.25rem" } as CSSProperties}
          >
            <AppSidebar />
            <AppShell>{children}</AppShell>
          </SidebarProvider>
        </TooltipProvider>
      </body>
    </html>
  );
}

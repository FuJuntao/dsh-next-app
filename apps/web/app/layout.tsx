import type { Metadata } from "next";
import { cookies } from "next/headers";
import { DM_Sans } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "../components/AppShell";
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
  // Render the stored preferences into the first HTML so a reload paints
  // them directly instead of flashing the defaults (lib/preferences.ts).
  const cookieStore = await cookies();
  const prefs = readPreferences(cookieStore.get(PREFERENCES_COOKIE)?.value);
  return (
    <html lang="en" className={dmSans.variable}>
      <body>
        <TooltipProvider delay={0}>
          <AppShell initialWidth={prefs.layout.width} initialFolded={prefs.layout.folded}>
            {children}
          </AppShell>
        </TooltipProvider>
      </body>
    </html>
  );
}

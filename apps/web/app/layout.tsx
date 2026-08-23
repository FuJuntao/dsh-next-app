import type { Metadata } from "next";
import { cookies } from "next/headers";
import "@radix-ui/themes/styles.css";
import { Theme } from "@radix-ui/themes";
import { AppShell } from "../components/AppShell";
import { PREFERENCES_COOKIE, readPreferences } from "../lib/preferences";
import "./globals.css";

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
    <html lang="en">
      <body>
        <Theme appearance="inherit">
          <AppShell initialWidth={prefs.layout.width} initialFolded={prefs.layout.folded}>
            {children}
          </AppShell>
        </Theme>
      </body>
    </html>
  );
}

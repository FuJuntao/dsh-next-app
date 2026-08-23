import type { Metadata } from "next";
import { cookies } from "next/headers";
import "@radix-ui/themes/styles.css";
import { Theme } from "@radix-ui/themes";
import { AppShell } from "../components/AppShell";
import "../components/shell.css";

export const metadata: Metadata = {
  title: "dsh-next-app",
  description: "Server-rendered replacement frontend for the DeepSeek Harness web surface",
};

/** The cookie name carrying the shell state (AppShell writes it). */
const SHELL_COOKIE = "dsh-next-app-shell";

/**
 * Parse the shell cookie (`<width>;<folded>`, e.g. `200;1`). The server
 * renders the stored sidebar width/folded state into the first HTML so a
 * reload paints the stored state directly - no flash of the defaults.
 * Malformed or absent cookies fall back to the app defaults.
 */
function parseShellCookie(raw: string | undefined): {
  initialWidth?: number;
  initialFolded?: boolean;
} {
  if (raw === undefined) return {};
  const parts = raw.split("|");
  const width = Number(parts[0]);
  const folded = parts[1] === "1";
  if (!Number.isFinite(width) || width <= 0) return {};
  return { initialWidth: width, initialFolded: folded };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const shell = parseShellCookie(cookieStore.get(SHELL_COOKIE)?.value);
  return (
    <html lang="en">
      <body>
        <Theme appearance="inherit">
          {/* Spread, not explicit undefined: exactOptionalPropertyTypes. */}
          <AppShell {...shell}>{children}</AppShell>
        </Theme>
      </body>
    </html>
  );
}

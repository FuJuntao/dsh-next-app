import type { Metadata } from "next";
import "@radix-ui/themes/styles.css";
import { Theme } from "@radix-ui/themes";
import { AppShell } from "../components/AppShell";
import "../components/shell.css";

export const metadata: Metadata = {
  title: "dsh-next-app",
  description: "Server-rendered replacement frontend for the DeepSeek Harness web surface",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <Theme appearance="inherit">
          <AppShell>{children}</AppShell>
        </Theme>
      </body>
    </html>
  );
}

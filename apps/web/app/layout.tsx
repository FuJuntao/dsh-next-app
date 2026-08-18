import type { Metadata } from "next";

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
      <body>{children}</body>
    </html>
  );
}

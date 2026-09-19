import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Settings",
  description: "Settings for the dsh surface",
};

export default function SettingsPage() {
  return (
    // The page owns its container: the centered column that scrolls itself
    // (the shell renders children bare into the pinned inset).
    <section className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col overflow-y-auto px-6 py-4">
      <h1>Settings</h1>
      <p>Placeholder: settings content lands with the settings story.</p>
    </section>
  );
}

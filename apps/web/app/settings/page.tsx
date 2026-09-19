import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Settings",
  description: "Settings for the dsh surface",
};

export default function SettingsPage() {
  return (
    // The reading insets live on the page - the shell's column carries none.
    <section className="px-6 py-4">
      <h1>Settings</h1>
      <p>Placeholder: settings content lands with the settings story.</p>
    </section>
  );
}

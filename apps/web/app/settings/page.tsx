import type { Metadata } from "next";
import { SettingsDialog } from "../../components/SettingsDialog";

export const metadata: Metadata = {
  title: "Settings",
  description: "Settings for the dsh surface",
};

export default function SettingsPage() {
  return (
    <section>
      <h1>Settings</h1>
      <p>Placeholder: settings content lands with the settings story.</p>
      <SettingsDialog openOnMount />
    </section>
  );
}

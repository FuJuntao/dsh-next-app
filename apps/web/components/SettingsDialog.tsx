"use client";

import { useState } from "react";
import { Dialog, Text } from "@radix-ui/themes";

/**
 * The settings surface (story #97): a Radix Dialog rendered by the /settings
 * route - settings has its own route, so the dialog only ever opens there
 * (the side nav button navigates to it). Content is a placeholder until
 * the settings story lands.
 */
export function SettingsDialog() {
  const [open, setOpen] = useState(true);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Content style={{ maxWidth: 480 }}>
        <Dialog.Title>Settings</Dialog.Title>
        <Dialog.Description size="2" mb="4">
          Placeholder: settings content lands with the settings story.
        </Dialog.Description>
        <Text size="2">
          Settings lives on its own route; the dialog is its surface until the settings story lands.
        </Text>
      </Dialog.Content>
    </Dialog.Root>
  );
}

"use client";

import { useState } from "react";
import { Dialog, IconButton, Text } from "@radix-ui/themes";
import { GearIcon } from "@radix-ui/react-icons";

/**
 * The settings surface (story #97): a Radix Dialog. Its trigger sits at the
 * bottom of the side nav on every page; the /settings route renders the
 * dialog already open (deep link). Content is a placeholder until the
 * settings story lands.
 */
export function SettingsDialog({ openOnMount = false }: { openOnMount?: boolean }) {
  const [open, setOpen] = useState(openOnMount);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      {!openOnMount && (
        <Dialog.Trigger>
          <IconButton aria-label="Settings" variant="ghost" color="gray" size="2">
            <GearIcon width="16" height="16" />
          </IconButton>
        </Dialog.Trigger>
      )}
      <Dialog.Content style={{ maxWidth: 480 }}>
        <Dialog.Title>Settings</Dialog.Title>
        <Dialog.Description size="2" mb="4">
          Placeholder: settings content lands with the settings story.
        </Dialog.Description>
        <Text size="2">
          The settings dialog is the shell's settings surface for now; the sidebar button opens it
          from any page and /settings deep-links it.
        </Text>
      </Dialog.Content>
    </Dialog.Root>
  );
}

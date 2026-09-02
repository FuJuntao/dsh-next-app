/**
 * The vendored slash-command list for the home composer's `/` autocomplete
 * (story #117 task #123).
 *
 * No commands RPC exists on the bridge carrier (the shipped client's
 * `command.list` is an in-process downlink the gateway does not serve), so
 * the list is vendored - names and descriptions copied verbatim from the
 * `commands.register(...)` descriptors of the pinned dsh version's command
 * packages, in that version's registration order. Leading-`/` messages
 * execute host-side regardless of this list (the sessions contract routes
 * them through the command registry); the list only powers completion, so
 * staleness shows up as a missing suggestion, never as a broken send.
 *
 * The e2e drift guard (#126) sends every name here to a real host and fails
 * if the host answers `unknown-command` for any of them - the mechanical
 * pin that keeps this file honest against the dsh version in the catalog.
 *
 * Pin: dsh 0.1.1-rc.2 (the workspace catalog version at vendoring time).
 */
export type VendoredSlashCommand = {
  /** Lowercase name WITHOUT the leading slash, as the registry spells it. */
  name: string;
  /** The registry's own description string. */
  description: string;
  /** The command's input hint when it declares one (placeholder grammar). */
  hint?: string;
};

export const VENDORED_SLASH_COMMANDS: readonly VendoredSlashCommand[] = [
  { name: "compact", description: "Compact older conversation history" },
  { name: "export", description: "Download this Session log as a ZIP archive" },
  {
    name: "feedback",
    description: "record feedback about this session",
    hint: "<text>",
  },
  {
    name: "goal",
    description: "set or view the goal for a long-running task",
    hint: "[<objective>|clear|edit <objective>|pause|resume]",
  },
  {
    name: "permission",
    description: "Switch the permission preset (sandbox mode + approval policy)",
    hint: "<preset>",
  },
  { name: "plan", description: "Enter or leave plan mode", hint: "[off|message]" },
];

/**
 * The composer's `/` menu shape: the slash-prefixed label the trigger
 * completes to, and the description carrying the declared input hint (the
 * menu renders one description line; the hint is part of what it asks for).
 * Stable identity: the typeahead's option list rebuilds on content changes,
 * not on every surface render.
 */
export const SLASH_MENU_ENTRIES: {
  label: string;
  description: string;
  kind: "command";
}[] = VENDORED_SLASH_COMMANDS.map((command) => ({
  label: "/" + command.name,
  description:
    command.hint === undefined ? command.description : `${command.description} ${command.hint}`,
  kind: "command" as const,
}));

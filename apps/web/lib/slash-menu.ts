/**
 * The one `/` menu rule both composers share (story #152 task #153 commit 1,
 * extracted from home's inline version): which rows lead - project skills
 * first, the vendored host commands after, a skill whose name shadows a
 * command winning (the project's word over the platform's) - what every row's
 * second line looks like (the host's own description through ONE clamp), and
 * what a door's verdict renders when the roster could not be read at all
 * (`slashMenuFrom`, AC 5 and AC 6 stated once for both surfaces).
 *
 * Order is inherited, never invented: skills keep the sequence they arrived
 * in - the host's root-rank order on the session page, the folder's own walk
 * order on home - and the vendored remainder keeps its registration order (see
 * slash-commands.ts). A sort here would be a second opinion on what the host
 * already ranked.
 *
 * The clamp lives here rather than in the data doors so the parity guard
 * (e2e/specs/slash-roster.spec.ts) can compare home's roster against the
 * host's `skill.list` rows line for line: both surfaces render this function's
 * output, so one assertion covers both. This module is pure by contract - no
 * runtime imports, no node APIs - which is what lets a client component and an
 * e2e spec read the same rule instead of restating it.
 */
import type { ComposerEntry, ComposerMenu } from "@/components/session-composer";
import { SLASH_MENU_ENTRIES } from "./slash-commands";

/** The menu's second line stays one honest sentence. */
const DESCRIPTION_MAX = 160;

/** One `/` menu row's source: the host's name and its own description text. */
export type SlashMenuSkill = { name: string; description: string };

/**
 * A roster door's verdict, in the shape both doors answer with: the rows
 * (possibly none), or the reason there is no roster to report.
 */
export type SlashMenuSource =
  | { ok: true; skills: readonly SlashMenuSkill[] }
  | { ok: false; reason: string };

/**
 * Clamp a description to the menu's single line: `DESCRIPTION_MAX` characters
 * total, the last one an ellipsis. Idempotent, so running an already-clamped
 * string through it changes nothing.
 */
export function clampSkillDescription(description: string): string {
  return description.length <= DESCRIPTION_MAX
    ? description
    : description.slice(0, DESCRIPTION_MAX - 1) + "…";
}

/**
 * Build the `/` menu's option list: `skills` first (in their own order, each
 * carrying the clamped description), then the vendored commands the skills do
 * not shadow.
 */
export function buildSlashMenu(skills: readonly SlashMenuSkill[]): ComposerEntry[] {
  const skillEntries: ComposerEntry[] = skills.map((skill) => ({
    key: "skill:" + skill.name,
    kind: "command" as const,
    label: "/" + skill.name,
    description: clampSkillDescription(skill.description),
  }));
  const shadowed = new Set(skillEntries.map((entry) => entry.label));
  return [...skillEntries, ...SLASH_MENU_ENTRIES.filter((entry) => !shadowed.has(entry.label))];
}

/**
 * What a door's verdict RENDERS, so AC 5 and AC 6 are stated once instead of
 * per surface: an answered roster builds the menu from its rows and says
 * nothing about itself; a refused one keeps the vendored floor (the menu
 * never goes empty, no send ever waits on a listing) and adds the door's own
 * hint line.
 *
 * The copy is a parameter because it names a different thing on each surface
 * - this repo's skills live in the folder home picked and in the session's
 * cwd, and only the door knows which word is honest.
 */
export function slashMenuFrom(source: SlashMenuSource, refusalHint: string): ComposerMenu {
  return source.ok
    ? { entries: buildSlashMenu(source.skills) }
    : { entries: buildSlashMenu([]), hint: refusalHint };
}

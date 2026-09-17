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
 * output, so one assertion covers both.
 *
 * Pure by contract, with NO import of its own - not even a type-only one from
 * the composer it feeds. That is what lets a client component and an e2e spec
 * read the same rule instead of restating it: the guard imports this module
 * over a relative path, and anything `@/`-aliased would resolve only inside
 * the app. The row and menu shapes below are therefore declared here as the
 * narrower facts they are - the composer's `ComposerEntry` and `ComposerMenu`
 * stay the caller's contract, and assignability is checked where the rows are
 * handed over, not asserted twice.
 */
import { SLASH_MENU_ENTRIES } from "./slash-commands";

/** The menu's second line stays one honest sentence. */
const DESCRIPTION_MAX = 160;

/** One `/` menu row's source: the host's name and its own description text. */
export type SlashMenuSkill = { name: string; description: string };

/** One built row, in the shape the composer's `/` source consumes. */
export type SlashMenuEntry = {
  /** Stable option key. Skill rows carry one because a project's `/plan` and
   * the registry's `/plan` must never share an option identity; the vendored
   * rows are keyed by their label, which is unique among them. */
  key?: string;
  kind: "command";
  label: string;
  description: string;
};

/** The `/` source as a composer takes it: the rows, plus the hint it owes. */
export type SlashMenu = { entries: SlashMenuEntry[]; hint?: string };

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
export function buildSlashMenu(skills: readonly SlashMenuSkill[]): SlashMenuEntry[] {
  const skillEntries: SlashMenuEntry[] = skills.map((skill) => ({
    key: "skill:" + skill.name,
    kind: "command",
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
export function slashMenuFrom(source: SlashMenuSource, refusalHint: string): SlashMenu {
  return source.ok
    ? { entries: buildSlashMenu(source.skills) }
    : { entries: buildSlashMenu([]), hint: refusalHint };
}

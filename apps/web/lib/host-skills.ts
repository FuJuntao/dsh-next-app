"use server";

/**
 * Project skills for the home composer's `/` autocomplete (story #117,
 * design packet flow step 4): the bridge's `skill.list` is
 * session-addressed and home has no session yet - but the app's server
 * process shares the host's filesystem (the same topology assumption
 * `host-browse` documents), so the chosen folder's project skills can be
 * read directly.
 *
 * The lookup mirrors the host's own canonicalization: from the chosen
 * folder walk UP to the deployment's default working folder, and the
 * first `.agents/skills/` directory found wins (a session created under
 * a subfolder resolves to the same project root). One skill per
 * subdirectory with a `SKILL.md`; its frontmatter's `name`/`description`
 * are the menu's label and second line. Containment is the shared fence
 * (host-path.ts) - the same line the browse door and the session's `cwd`
 * enforce - so a path outside the subtree is refused before any read.
 *
 * What gets listed is decided by the host, not by taste: `readSkill` below
 * restates the host's own discovery rules - the same `yaml` library it
 * parses frontmatter with, its required-fields and name grammar, and the
 * user-invocable filter its `skill.list` applies. Every one of those is a
 * parity promise (story #152 AC 4 and AC 7): parse with anything else and a
 * block-scalar description reaches the menu as a literal `>`; skip the
 * filter and home advertises a `/name` the host will not invoke.
 *
 * The scope is bounded on purpose and the menu must not oversell it: this
 * door reads the CHOSEN FOLDER's `.agents/skills` and nothing else - no
 * `.dsh/skills`, no user-level roots, no bundled entries, no flat Markdown.
 * `/sessions/<id>` is the full-truth surface; whatever home lists is a subset.
 *
 * This powers completion only - invocation is a plain `session.prompt`
 * whose leading `/name` the host recognizes at the pre-step boundary
 * (the skills contract), so a stale or missing entry here can never
 * break a send, only fail to suggest it.
 *
 * Descriptions leave here exactly as the file states them: the menu's
 * one-line clamp is the `/` rule both surfaces share, and it lives in
 * slash-menu.ts (story #152 task #153).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse } from "yaml";
import { fenceInsideHostRoot, getHostRoot } from "./host-path";

/** One project skill as the `/` menu consumes it. */
export type ProjectSkill = { name: string; description: string };

/**
 * The read's outcome: the roster (possibly empty), or the refusal that
 * explains why there is no roster. `ok: true` with no skills is an ANSWER -
 * this project has none; `ok: false` is the menu not being allowed to claim
 * anything. AC 6 (story #152) is exactly that distinction, so it travels.
 */
export type ProjectSkillsResult =
  | { ok: true; skills: ProjectSkill[] }
  | { ok: false; reason: string };

/**
 * List the project skills visible to a session created at `cwd`. A failure
 * (outside the subtree, the host default unreadable, the skills directory
 * unlistable) is REPORTED, not folded away: the menu still offers its
 * vendored commands, but it says the roster is missing rather than implying
 * the project has none.
 */
export async function fetchProjectSkills(cwd: string): Promise<ProjectSkillsResult> {
  const fenced = await fenceInsideHostRoot(cwd);
  if (!fenced.ok) return { ok: false, reason: fenced.reason };
  const root = await getHostRoot();
  if (root === null) {
    return { ok: false, reason: "cannot read the host default folder (bridge unavailable)" };
  }
  // The fence returns a canonical path, so the walk-up climbs only real
  // parents inside the subtree - no symlink can join it.
  for (let dir = fenced.path; ; dir = dirname(dir)) {
    const skillsDir = join(dir, ".agents", "skills");
    if (existsSync(skillsDir)) {
      const skills = readSkills(skillsDir);
      if (skills === null) return { ok: false, reason: `cannot list ${skillsDir}` };
      return { ok: true, skills };
    }
    if (dir === root || dirname(dir) === dir) break;
  }
  // No family anywhere in the subtree: a project with no skills, which is a
  // different fact from an unreadable one and gets no hint line.
  return { ok: true, skills: [] };
}

/**
 * The host's skill-name grammar (`SKILL_NAME` in @deepseek-ai/dsh-skill):
 * a name outside it is not a skill the host will resolve at the pre-step
 * boundary, so it must not be offered as a suggestion either.
 */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The camelCase invocation keys the host REJECTS outright
 * (`rejectLegacyInvocationKey`) - a file carrying one is ignored there, so
 * it is ignored here.
 */
const LEGACY_INVOCATION_KEYS = ["disableModelInvocation", "modelInvocable", "userInvocable"];

/**
 * Read every `SKILL.md` in one `.agents/skills` directory; null when the
 * directory itself cannot be listed - the one failure that is not an answer
 * about the project, and so the one that becomes a hint line.
 */
function readSkills(skillsDir: string): ProjectSkill[] | null {
  let names: string[];
  try {
    names = readdirSync(skillsDir).sort();
  } catch {
    return null;
  }
  const skills: ProjectSkill[] = [];
  for (const name of names) {
    try {
      if (!statSync(join(skillsDir, name)).isDirectory()) continue;
      const skill = readSkill(join(skillsDir, name, "SKILL.md"));
      if (skill !== null) skills.push(skill);
    } catch {
      // No readable SKILL.md: not an invocable skill here, skip it.
    }
  }
  return skills;
}

/**
 * One `SKILL.md` as the menu sees it, or `null` when the host would not
 * list it - which is the only question that matters here, because the
 * parity guard compares the two rosters and a row home invents fails it.
 * A dropped file is never an error: an unreadable, headless or
 * non-invocable skill is simply not a command.
 */
function readSkill(path: string): ProjectSkill | null {
  const block = frontmatterBlock(readFileSync(path, "utf8"));
  if (block === null) return null;
  let data: Record<string, unknown>;
  try {
    // The same parse the host runs, so `>` and `|` blocks, quoted strings,
    // folded text and bare multi-line continuations all yield the real
    // sentence - the shapes the first-colon splitter turned into ">" or
    // dropped outright (story #152 AC 4).
    const parsed: unknown = parse(block);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    data = parsed as Record<string, unknown>;
  } catch {
    return null; // invalid YAML: the host ignores the file, and so do we
  }
  const name = stringField(data, "name");
  if (name === undefined || !SKILL_NAME.test(name)) return null;
  const description = stringField(data, "description");
  if (description === undefined) return null;
  if (LEGACY_INVOCATION_KEYS.some((key) => Object.hasOwn(data, key))) return null;
  const userInvocable = booleanField(data, "user-invocable");
  const disableModelInvocation = booleanField(data, "disable-model-invocation");
  // The host VALIDATES both invocation flags before applying either: a value
  // it cannot coerce makes its `parseInvocationPolicy` throw, `parseSkillFile`
  // catches, and the whole file is ignored - so an unparsable flag is a
  // missing skill, not a row with a default. Only the RESULT differs per key:
  // `user-invocable: false` drops the row from skill.list, while
  // `disable-model-invocation` is not a filter at all - skill.list carries
  // those rows (modelInvocable: false) precisely because the command-only
  // skills - /story, /design, /review - are the ones a user types (story
  // #152, non-goals).
  if (userInvocable === null || disableModelInvocation === null) return null;
  if (userInvocable === false) return null;
  return { name, description };
}

/**
 * The YAML between an opening and a closing `---` fence, or null when the
 * file has none: the host's `parseFrontmatter` scan restated, including the
 * `\\r` tolerance and the verdict that an unclosed fence is not frontmatter
 * (the whole file is then ignored - the reason the old 4 KiB head slice had
 * to go: a fat header cut mid-file dropped a skill in silence).
 */
function frontmatterBlock(raw: string): string | null {
  const firstLineEnd = raw.indexOf("\n");
  if (firstLineEnd < 0) return null;
  if (raw.slice(0, firstLineEnd).replace(/\r$/, "") !== "---") return null;
  let lineStart = firstLineEnd + 1;
  while (lineStart <= raw.length) {
    const nextNewline = raw.indexOf("\n", lineStart);
    const lineEnd = nextNewline < 0 ? raw.length : nextNewline;
    if (raw.slice(lineStart, lineEnd).replace(/\r$/, "") === "---") {
      return raw.slice(firstLineEnd + 1, lineStart);
    }
    if (nextNewline < 0) return null;
    lineStart = nextNewline + 1;
  }
  return null;
}

/** The host's `stringField`: a non-string or an empty value is a missing field. */
function stringField(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * The host's `frontmatterBoolean`: YAML 1.2 core leaves `yes`/`no`/`on`/`off`
 * as strings, so the host coerces them itself. `undefined` = absent,
 * `null` = a value it refuses (which makes it ignore the whole file).
 */
function booleanField(data: Record<string, unknown>, key: string): boolean | null | undefined {
  if (!Object.hasOwn(data, key)) return undefined;
  const value = data[key];
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1") return true;
  if (value === 0 || value === "0") return false;
  if (typeof value === "string") {
    switch (value.toLowerCase()) {
      case "true":
      case "yes":
      case "on":
        return true;
      case "false":
      case "no":
      case "off":
        return false;
      default:
        return null;
    }
  }
  return null;
}

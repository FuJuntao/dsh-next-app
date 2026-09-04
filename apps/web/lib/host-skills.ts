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
 * This powers completion only - invocation is a plain `session.prompt`
 * whose leading `/name` the host recognizes at the pre-step boundary
 * (the skills contract), so a stale or missing entry here can never
 * break a send, only fail to suggest it.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fenceInsideHostRoot, getHostRoot } from "./host-path";

/** One project skill as the `/` menu consumes it. */
export type ProjectSkill = { name: string; description: string };

/**
 * List the project skills visible to a session created at `cwd`. Any
 * failure (outside the subtree, unreadable, bridge down) folds to an
 * empty roster - the `/` menu keeps its vendored commands and says
 * nothing about the miss.
 */
export async function fetchProjectSkills(cwd: string): Promise<ProjectSkill[]> {
  const fenced = await fenceInsideHostRoot(cwd);
  if (!fenced.ok) return [];
  const root = await getHostRoot();
  if (root === null) return [];
  // The fence returns a canonical path, so the walk-up climbs only real
  // parents inside the subtree - no symlink can join it.
  for (let dir = fenced.path; ; dir = dirname(dir)) {
    const skillsDir = join(dir, ".agents", "skills");
    if (existsSync(skillsDir)) return readSkills(skillsDir);
    if (dir === root || dirname(dir) === dir) break;
  }
  return [];
}

/** The menu's second line stays one honest sentence. */
const DESCRIPTION_MAX = 160;

function readSkills(skillsDir: string): ProjectSkill[] {
  let names: string[];
  try {
    names = readdirSync(skillsDir).sort();
  } catch {
    return [];
  }
  const skills: ProjectSkill[] = [];
  for (const name of names) {
    try {
      if (!statSync(join(skillsDir, name)).isDirectory()) continue;
      const head = readFileSync(join(skillsDir, name, "SKILL.md"), "utf8").slice(0, 4096);
      const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(head);
      if (front === null || front[1] === undefined) continue;
      const fields = new Map<string, string>();
      for (const line of front[1].split(/\r?\n/)) {
        const colon = line.indexOf(":");
        if (colon <= 0) continue;
        fields.set(
          line.slice(0, colon).trim(),
          line
            .slice(colon + 1)
            .trim()
            .replace(/^["'](.*)["']$/u, "$1"),
        );
      }
      const description = fields.get("description");
      if (description === undefined || description === "") continue;
      skills.push({
        name: fields.get("name") ?? name,
        description:
          description.length <= DESCRIPTION_MAX
            ? description
            : description.slice(0, DESCRIPTION_MAX - 1) + "…",
      });
    } catch {
      // No readable SKILL.md: not an invocable skill here, skip it.
    }
  }
  return skills;
}

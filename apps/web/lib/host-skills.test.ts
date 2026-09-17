/**
 * The frontmatter read (story #152 task #153 commit 3): the shapes a real
 * `SKILL.md` description arrives in, and the host's own list rules restated.
 *
 * The bug this pins is #152's own measurement - a third of the skills in the
 * deployment rendered a literal `>` in the menu, because the old reader split
 * each line on its first colon and never parsed YAML at all. Two shapes are
 * worse than a wrong line: a bare `description:` continued on the following
 * lines yielded `""` and the skill was DROPPED, and a nested colon
 * (`description: "Fix: …"`) yielded a truncated fragment. Both are here.
 *
 * The rules are asserted in the same breath because the parity guard (AC 7)
 * compares home's roster against the host's `skill.list`: a row home invents
 * fails that guard - so what counts as "a skill" is not this file's opinion,
 * it is the host's, restated. The bridge stays mocked; the real filesystem
 * under /tmp gives the fence its teeth.
 */
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { buildSlashMenu } from "./slash-menu";

const base = realpathSync(mkdtempSync(join(tmpdir(), "host-skills-test-")));
const root = join(base, "workspace");
const outside = join(base, "outside");
const skillsDir = join(root, ".agents", "skills");

/** Write one fixture skill; `front` is the YAML between the `---` fences. */
function skill(dir: string, front: string): void {
  const at = join(skillsDir, dir);
  mkdirSync(at, { recursive: true });
  writeFileSync(join(at, "SKILL.md"), `---\n${front}\n---\nBody.\n`);
}

/** A SKILL.md this writer will not produce - for the malformed-file cases. */
function rawSkill(dir: string, text: string): void {
  const at = join(skillsDir, dir);
  mkdirSync(at, { recursive: true });
  writeFileSync(join(at, "SKILL.md"), text);
}

/** The description shapes the old first-colon splitter got wrong. */
skill("folded", "name: folded\ndescription: >\n  Deploy the stack\n  and tail the logs");
skill("literal", "name: literal\ndescription: |\n  line one\n  line two");
skill("quoted", 'name: quoted\ndescription: "Fix: the roster"');
skill(
  "plain-continuation",
  "name: plain-continuation\ndescription: Deploy the stack\n  and tail the logs",
);
// The drop: `description:` with no value on its own line read as "" and the
// skill vanished from the menu entirely.
skill(
  "bare-continuation",
  "name: bare-continuation\ndescription:\n  Deploy the stack\n  and tail the logs",
);
skill("nested-colon", "name: nested-colon\ndescription: >\n  Use when: the user asks for /deploy");
// Long enough that the door must NOT clamp here - slash-menu owns the clamp.
skill("verbose", "name: verbose\ndescription: " + "w".repeat(400));

/** The shapes that are not skills, and why. */
rawSkill("no-frontmatter", "just a body, no fence at all\n");
rawSkill("unclosed-fence", "---\nname: unclosed-fence\ndescription: never closes\nBody.\n");
skill("invalid-yaml", "name: invalid-yaml\ndescription: Use when: compact mapping");
skill("nameless", "description: has a description but no name field");
skill("bad-name", "name: Snake_Case\ndescription: not the host's name grammar");
skill("empty-description", "name: empty-description\ndescription:");
skill("user-only-false", "name: user-only-false\ndescription: hidden\nuser-invocable: false");
skill("user-only-no", "name: user-only-no\ndescription: hidden\nuser-invocable: no");
skill("legacy-key", "name: legacy-key\ndescription: camelCase\nuserInvocable: false");
skill(
  "unparsable-flag",
  "name: unparsable-flag\ndescription: not a boolean\nuser-invocable: maybe",
);
/** The shapes that ARE skills whatever their other flags say. */
skill(
  "command-only",
  "name: command-only\ndescription: Invoked by command only.\ndisable-model-invocation: true",
);
skill("user-yes", "name: user-yes\ndescription: still a user command\nuser-invocable: yes");

// A flat Markdown skill is not this door's scope (story #152 non-goal).
writeFileSync(join(skillsDir, "flat-skill.md"), "---\nname: flat-skill\ndescription: flat\n---\n");
mkdirSync(outside, { recursive: true });

const fake = vi.hoisted(() => ({ host: { describe: vi.fn() } }));

vi.mock("./bridge", () => ({
  getActionBridgeClient: () => fake,
}));

const { fetchProjectSkills } = await import("./host-skills");

/** The host root every other case reads through. */
function describeRoot(): Promise<unknown> {
  return Promise.resolve({
    result: {
      ok: true,
      value: {
        cwd: root,
        version: "test",
        attachedSessions: 0,
        home: "/home/tester",
        canOpenPath: false,
      },
    },
  });
}

beforeAll(() => {
  fake.host.describe.mockImplementation(describeRoot);
});

/** The read's roster, keyed by name: throws the assertion on a refusal. */
async function roster(cwd: string = root): Promise<Map<string, string>> {
  const result = await fetchProjectSkills(cwd);
  if (!result.ok) throw new Error("refused: " + result.reason);
  return new Map(result.skills.map((one) => [one.name, one.description]));
}

describe("fetchProjectSkills - the description shapes", () => {
  it("reads a folded block scalar as its sentence, not as '>'", async () => {
    // The measured bug: the menu showed a literal `>` for every one of these.
    expect((await roster()).get("folded")).toBe("Deploy the stack and tail the logs\n");
  });

  it("reads a literal block scalar line by line", async () => {
    expect((await roster()).get("literal")).toBe("line one\nline two\n");
  });

  it("keeps the quotes off a quoted scalar and its colon intact", async () => {
    // The old reader split on the FIRST colon: this arrived as `"Fix`.
    expect((await roster()).get("quoted")).toBe("Fix: the roster");
  });

  it("folds a plain scalar continued on the next line", async () => {
    expect((await roster()).get("plain-continuation")).toBe("Deploy the stack and tail the logs");
  });

  it("keeps the skill whose description is a bare continuation", async () => {
    // This one used to be DROPPED: `description:` alone reads as "".
    expect((await roster()).get("bare-continuation")).toBe("Deploy the stack and tail the logs");
  });

  it("keeps a nested colon inside a block scalar", async () => {
    expect((await roster()).get("nested-colon")).toBe("Use when: the user asks for /deploy\n");
  });

  it("leaves the clamp to the menu: long text arrives whole", async () => {
    const verbose = (await roster()).get("verbose") ?? "";
    expect(verbose).toHaveLength(400);
    const [row] = buildSlashMenu([{ name: "verbose", description: verbose }]);
    expect(row?.description).toBe("w".repeat(159) + "…");
  });
});

describe("fetchProjectSkills - what the host would not list", () => {
  it("drops the files the host ignores", async () => {
    const found = await roster();
    // No frontmatter at all, and a fence that never closes: not frontmatter.
    expect(found.has("no-frontmatter")).toBe(false);
    expect(found.has("unclosed-fence")).toBe(false);
    // Invalid YAML: the host logs a warning and skips the file.
    expect(found.has("invalid-yaml")).toBe(false);
    // A non-string or empty description is a MISSING one over there.
    expect(found.has("empty-description")).toBe(false);
  });

  it("requires the name field - the directory name is not the name", async () => {
    // The old reader fell back to the directory name; the host refuses the
    // file outright, so a fallback here invents a row the guard rejects.
    const found = await roster();
    expect(found.has("nameless")).toBe(false);
    expect(found.has("bad-name")).toBe(false);
    expect(found.has("Snake_Case")).toBe(false);
  });

  it("drops what skill.list filters: user-invocable false, in any spelling", async () => {
    const found = await roster();
    expect(found.has("user-only-false")).toBe(false);
    // YAML 1.2 core reads `no` as a string; the host coerces it, so we do too.
    expect(found.has("user-only-no")).toBe(false);
    // A flag the host cannot coerce makes it ignore the whole file...
    expect(found.has("unparsable-flag")).toBe(false);
    // ...as does the camelCase spelling it rejects on sight.
    expect(found.has("legacy-key")).toBe(false);
  });

  it("keeps the command-only skills - those are the ones a user types", async () => {
    const found = await roster();
    expect(found.get("command-only")).toBe("Invoked by command only.");
    expect(found.get("user-yes")).toBe("still a user command");
  });

  it("lists exactly the family's subdirectories, in name order", async () => {
    const read = await fetchProjectSkills(root);
    if (!read.ok) throw new Error("refused: " + read.reason);
    const skills = read.skills;
    expect(skills.map((one) => one.name)).toEqual([
      "bare-continuation",
      "command-only",
      "folded",
      "literal",
      "nested-colon",
      "plain-continuation",
      "quoted",
      "user-yes",
      "verbose",
    ]);
  });
});

describe("fetchProjectSkills - the lookup", () => {
  it("climbs to the nearest ancestor's .agents/skills", async () => {
    const sub = join(root, "apps", "web");
    mkdirSync(sub, { recursive: true });
    expect([...(await roster(sub)).keys()]).toContain("folded");
  });

  it("prefers the closer family over the one above it", async () => {
    const nested = join(root, "projects", "solo");
    mkdirSync(join(nested, ".agents", "skills", "solo-skill"), { recursive: true });
    writeFileSync(
      join(nested, ".agents", "skills", "solo-skill", "SKILL.md"),
      "---\nname: solo-skill\ndescription: >\n  only here\n---\n",
    );
    const found = await roster(nested);
    expect(found.get("solo-skill")).toBe("only here\n");
    expect(found.has("folded")).toBe(false);
  });

  it("answers empty - ok, not a refusal - for a family with nothing in it", async () => {
    // AC 6's "genuinely empty" half, which is the half that gets NO hint
    // line: the walk stopped at a real skills directory and it is empty.
    const bare = join(root, "projects", "quiet");
    mkdirSync(join(bare, ".agents", "skills"), { recursive: true });
    expect(await fetchProjectSkills(bare)).toEqual({ ok: true, skills: [] });
  });

  it("answers empty when the climb reaches the default folder with no family", async () => {
    // The other branch of the walk: nothing found on the way up, so the
    // roster is genuinely empty - and still an ANSWER, not a refusal. This
    // needs a host root with no family of its own, and host-path caches the
    // root per module instance, so the case runs against a fresh import with
    // describe pointed at a second tree; the file's other cases keep reading
    // through the binding above, whose cache still names `root`.
    const familyless = join(base, "familyless");
    mkdirSync(join(familyless, "projects", "plain"), { recursive: true });
    fake.host.describe.mockImplementation(() =>
      Promise.resolve({
        result: {
          ok: true,
          value: {
            cwd: familyless,
            version: "test",
            attachedSessions: 0,
            home: "/home/tester",
            canOpenPath: false,
          },
        },
      }),
    );
    vi.resetModules();
    const fresh = await import("./host-skills");
    expect(await fresh.fetchProjectSkills(join(familyless, "projects", "plain"))).toEqual({
      ok: true,
      skills: [],
    });
    fake.host.describe.mockImplementation(describeRoot);
  });

  it("refuses a folder outside the host's default subtree, naming the reason", async () => {
    mkdirSync(join(outside, ".agents", "skills", "secret-skill"), { recursive: true });
    writeFileSync(
      join(outside, ".agents", "skills", "secret-skill", "SKILL.md"),
      "---\nname: secret-skill\ndescription: never listed\n---\n",
    );
    const result = await fetchProjectSkills(outside);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    // The fence's own words travel: this is what the server log shows and
    // what tells an operator the pick was refused, not missing.
    expect(result.reason).toContain("outside the default working folder");
  });

  it("refuses a skills directory it cannot list", async () => {
    // `.agents/skills` is a FILE here: existsSync passes, readdir throws.
    // The roster is unknown, which is a refusal - not an empty project.
    const broken = join(root, "projects", "broken");
    mkdirSync(join(broken, ".agents"), { recursive: true });
    writeFileSync(join(broken, ".agents", "skills"), "not a directory\n");
    const result = await fetchProjectSkills(broken);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.reason).toContain("cannot list");
  });
});
